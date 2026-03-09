# Project Rhizome — Smart Hard AI Protocol

## Overview

**Project Rhizome** is the substrate powering the **Smart Hard** difficulty tier
in Iron Command. It replaces the hand-crafted heuristics of the Hard AI with a
four-layer organic model that reads battlefield state and produces contextually
adaptive decisions.

```
Hard AI                 Smart Hard (Rhizome)
──────────────────────  ───────────────────────────────────────────────
Fixed attack timer      Metabolic loop  — organ-health build priority
HP threshold retreats   Cellular logic  — NC density state per unit
Greedy pathfinding      Potential fields — weighted attraction/repulsion
No state escalation     Overdrive mode  — flood behaviour under threat
```

---

## Architecture

### Module

```
src/combat/Rhizome.ts   — Rhizome class + RHIZOME_PARAMS constants
src/combat/AI.ts        — AI class; instantiates Rhizome for smart_hard
src/combat/Rhizome.test.ts — Vitest unit tests
```

### Integration Points

| Location | Integration |
|---|---|
| `AI.constructor` | `new Rhizome(playerId, em, economy)` when `difficulty === 'smart_hard'` |
| `AI.update` | `this.rhizome?.update(delta, gameState)` every frame |
| `AI.followTechTree` | Rhizome organ priority drives build order override |
| `AI.retreatDamagedUnits` | Overdrive suppresses retreat; isolated units retreat early |
| `AI.considerAttacking` | Overdrive halves the attack cooldown window |
| `AI.tickSuperweapons` | Enemy active SW passed to `rhizome.notifyEnemySwCooldown()` |

---

## Layer 1 — Metabolic Loop

### Organ-Health Build Priority

```
power → refinery → production → expansion
```

Before each build decision the AI asks `rhizome.getOrganPriority()`.
Whichever organ category is deficient becomes the immediate build target.

| Priority | Trigger condition |
|---|---|
| `power` | Power generation / (generation + consumption) < `POWER_RATIO_THRESHOLD` (0.15) |
| `refinery` | Active ore refineries < `REFINERY_COUNT_TARGET` (2) |
| `production` | Active production buildings < `PRODUCTION_COUNT_TARGET` (2) |
| `expansion` | All above satisfied — tech up, expand territory |

### Rule-of-3 Spacing

When the AI places a building it queries `rhizome.meetsSpacingRule(defId, x, y)`.
The method returns `false` if any existing building of the same type is closer
than `RULE_OF_3_TILES` (3 tiles = 96 px).

**Effect:** The AI's base spreads out. A single artillery volley cannot destroy
two barracks or two war factories simultaneously.

---

## Layer 2 — Cellular Unit Logic (NC Density)

Every `NC_DENSITY_INTERVAL_MS` (2 000 ms) Rhizome evaluates a **density state**
for each AI unit by sampling units within `NC_DENSITY_RADIUS` (8 tiles):

| State | Condition | AI response |
|---|---|---|
| `isolated` | Allies in radius < `ISOLATED_ALLY_THRESHOLD` (2) | Retreat to base |
| `stable` | Not isolated, enemies ≤ allies × `PRESSURE_ENEMY_RATIO` | Standard orders |
| `pressure` | Enemies > allies × 1.5 | Continue/overspill — push through |

> **Overdrive override:** when overdrive is active, `isolated` is promoted to
> `stable` — units never retreat regardless of local support.

The cache is consulted from `retreatDamagedUnits()` before the normal HP-based
retreat threshold so even healthy isolated units fall back.

---

## Layer 3 — Potential-Field Navigation

`rhizome.getPotentialFieldBias(ux, uy, gameState)` returns a normalized `{dx, dy}`
vector that the AI can add to movement decisions.

### Field Sources

| Source | Weight | Reason |
|---|---|---|
| Friendly harvester/miner | +50 | Combat units escort income |
| Friendly power plant | +30 | Army stays near infrastructure |
| Friendly infantry (no attack) | +20 | Medic/support cohesion |
| Enemy defense turret | −80 | Avoid fixed defenses |
| Fog-of-war hidden tiles | +5 | Opportunistic scouting |

All field strengths use **linear falloff** from zero at `FIELD_INFLUENCE_RADIUS`
(10 tiles) to full weight at source.

### Overdrive Effect

In overdrive mode all **repulsion** forces are zeroed. Enemy turrets no longer
push units away — the AI floods forward regardless of defensive coverage.

---

## Layer 4 — Overdrive Mode

Overdrive is an escalation state triggered by existential threats:

### Trigger Conditions

| Condition | Threshold |
|---|---|
| Enemy superweapon active | Remaining cooldown < `OVERDRIVE_SW_COOLDOWN_THRESHOLD_MS` (60 s) |
| Base damage rate | Friendly buildings lose > `OVERDRIVE_BASE_DAMAGE_THRESHOLD` (30%) of total base max-HP within a 60 s rolling window |

### Effects When Active

- All unit retreat logic is bypassed (no HP retreats, no isolated retreats)
- Turret repulsion in potential fields is zeroed
- Attack cooldown window is halved (`nextAttackWindowMs × 0.5`)
- NC density: isolated units are not ordered to retreat

### Sustain

Overdrive remains active for `OVERDRIVE_SUSTAIN_MS` (30 s) after trigger
conditions clear, preventing rapid cycling.

---

## Difficulty Parameters (Smart Hard vs Hard)

| Parameter | Hard | Smart Hard |
|---|---|---|
| Tick interval | 1 200 ms | 800 ms |
| First attack | 120 s | 90 s |
| Attack interval | 40–70 s | 25–50 s (halved in overdrive) |
| Wave size | 8–20 | 10–25 |
| Harassment interval | 25 s | 15 s |
| Max army | 50 | 65 |
| Defense target | 3 turrets | 4 turrets (Rule-of-3 spread) |
| Defender response radius | 40 tiles | 55 tiles |
| Rebuild recovery | 40 s | 25 s |
| AI income multiplier | 1.25× | 1.35× |
| Build speed | 1.3× | 1.4× |

---

## Tuning Constants

All tuning constants live in `RHIZOME_PARAMS` (exported from `Rhizome.ts`)
and are `as const` — import them in tests and balance spreadsheets.

```typescript
import { RHIZOME_PARAMS } from '../combat/Rhizome'

// Example: tighten pressure threshold for more aggressive overspill
// RHIZOME_PARAMS.PRESSURE_ENEMY_RATIO = 1.2  // cannot — it's const
// Change the value in Rhizome.ts instead, tests will catch regressions
```

---

## Running Tests

```bash
npx vitest run src/combat/Rhizome.test.ts
```

Tests cover:
- `RHIZOME_PARAMS` constant values (regression guard)
- `getOrganPriority` for each priority level
- `meetsSpacingRule` edge cases
- NC density state transitions
- Potential-field direction and normalization
- Overdrive triggers (SW cooldown, base damage) and sustain

---

## Design Notes

### Why "Rhizome"?

A rhizome is a root network without a central node — it spreads, adapts, and
regenerates from any point. The AI substrate mirrors this: no single choke point
controls the AI. Destroy the production buildings and organ priority rebuilds
them. Kill a wave and density logic regroups survivors. Trigger overdrive and
the whole network floods forward.

### Why not embed this in AI.ts?

Keeping Rhizome as a separate module means:
1. It can be unit-tested in isolation (no Phaser, no game scene)
2. The four layers have clear interfaces and can be tuned independently
3. Future difficulty tiers (e.g. `brutal`) can extend or replace individual layers
