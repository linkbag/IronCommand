# Work Log: claude-ic-verify-rhizome-gameplay
## Task: ic-verify-rhizome-gameplay (IronCommand)
## Branch: feat/ic-verify-rhizome-gameplay
---

### [Step 1] Audit AI.ts ↔ Rhizome.ts wiring

**Files read:** src/combat/AI.ts, src/combat/Rhizome.ts

**What:** Traced every Rhizome method to see if AI.ts calls it.

**Findings — already wired:**
- `rhizome.update(delta, gameState)` — called every frame in `AI.update()` (line 373)
- `rhizome.getOrganPriority(gameState)` — called in `followTechTree()` (line 821)
- `rhizome.getDensityState(u.id)` — called in `retreatDamagedUnits()` for 'isolated' → retreat (line 2020)
- `rhizome.isOverdriveActive()` — used in `retreatDamagedUnits()` and `considerAttacking()` to suppress retreat and halve attack window
- `rhizome.notifyEnemySwCooldown()` — called in `tickSuperweapons()` (line 3160)

**Findings — dead wiring (computed but never read):**
1. `rhizome.meetsSpacingRule()` — Rule-of-3 never called from building placement functions
2. `rhizome.getPotentialFieldBias()` — potential field computed but never applied to attack movement
3. `getDensityState()` 'pressure' state — computed but never acted upon (only 'isolated' handled)

### [Step 2] Fix meetsSpacingRule in building placement

**Files changed:** src/combat/AI.ts

**What:** Added `meetsSpacingRule` check inside:
- `findBuildingPlacement()` general spiral loop — skip candidate tiles too close to existing same-type buildings (lines ~2689-2697)
- `findDefensePlacement()` — skip defense placements too close to same-type turrets (lines ~2773-2781)

**Why:** Without this, smart_hard AI clusters all turrets together, violating the Rule-of-3 design. A single bombardment could eliminate all defenses of one type.

**Decisions:** Only gates placement (allows fallback to next candidate), doesn't break the loop entirely — so if no spread position is available, placement still eventually finds one.

### [Step 3] Wire getPotentialFieldBias into issueFormationApproach

**Files changed:** src/combat/AI.ts

**What:**
- Added `private cachedState: GameState | null` field (initialized null in constructor)
- Set `this.cachedState = gameState` at start of `update()`
- In `issueFormationApproach()`, after computing each unit's approach waypoint, apply bias: `approach.x += bias.dx * 2 * TILE_SIZE` and same for y

**Why:** Potential field was computed by Rhizome every frame but never read. Without this, turret-avoidance and harvester-escort attraction have no effect on unit routing. 2 TILE_SIZE bias strength keeps it subtle (navigation hint, not full steering override).

**Decisions:** Used `cachedState` pattern rather than threading gameState through `updatePendingWave` call chain. This is minimal and avoids changing function signatures throughout the call chain.

### [Step 4] Wire pressure density state to overspill in retreatDamagedUnits

**Files changed:** src/combat/AI.ts

**What:** In `retreatDamagedUnits()`, after handling 'isolated' → retreat, added handling for 'pressure' density state: `continue` (skip HP-based retreat check, flood forward).

**Why:** 'pressure' state (many enemies but also many allies) should trigger aggressive overspill. Previously the state was computed by Rhizome but completely ignored — units in pressure would still retreat at low HP like any hard-difficulty unit.

**Decisions:** Simple `continue` is correct here. The unit keeps its current order (usually attackMove) rather than being forced to retreat. No need to issue a new aggressive order — the existing attack group logic handles combat.

### [Step 5] Verify: tsc + vitest

- `npx tsc --noEmit` → clean (0 errors)
- `npx vitest run` → 62 tests pass (29 Rhizome tests, 5 AIGoals, 21 spawn, 4 ore recovery, 3 map balance)

## Summary
- **Total files changed:** 1 (src/combat/AI.ts, +36 lines)
- **Key changes:**
  - `findBuildingPlacement()`: added `meetsSpacingRule` check in spiral search loop
  - `findDefensePlacement()`: added `meetsSpacingRule` check in lateral offset loop
  - `AI` class: added `private cachedState: GameState | null` field
  - `update()`: `this.cachedState = gameState` at top
  - `issueFormationApproach()`: applies `getPotentialFieldBias` to each unit's approach waypoint (2×TILE_SIZE strength)
  - `retreatDamagedUnits()`: handles `'pressure'` density state via `continue` (overspill, skip HP-retreat)
- **Build status:** tsc clean, vitest 62/62 pass
- **Known issues:** None. Overdrive turret suppression was already implemented correctly in Rhizome (zeroed, not just reduced) — no change needed there.
- **Integration notes:**
  - The `cachedState` field is only used when `this.rhizome` is non-null, so it has zero effect on easy/medium/hard difficulties.
  - `meetsSpacingRule` iterates the building list — O(n) per candidate tile. With RULE_OF_3_TILES=3 and sparse bases this is fast, but worth noting if base sizes grow very large.
  - PR: https://github.com/linkbag/IronCommand/pull/60

### Review Round 1
- Verdict: Review passed — reviewer exited cleanly (auto-pass: clean exit, no issues indicated)
