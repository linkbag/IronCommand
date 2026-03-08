# RA2/RTS AI Behavior Benchmark and Upgrade Blueprint

Date: March 8, 2026
Scope: IronCommand skirmish AI (`src/combat/AI.ts`) benchmarked against classic RA2-style RTS AI behavior patterns.

## Benchmark Method

The benchmark used a behavior-axis comparison (1-5 scale) across strategic layers that matter most for RTS competence:

1. Economic pressure and expansion timing
2. Doctrine-driven target selection
3. Attack cadence and opportunism
4. Defensive force allocation
5. Scouting quality and information usage
6. Army composition robustness
7. Tactical micro and retreat discipline
8. Late-game strategic closure

## Baseline Comparison (Before This Run)

| Axis | RA2-style expectation | IronCommand baseline | Score |
|---|---|---|---|
| Economy pressure | Early harass + refinery denial + map mining pressure | Strong (harvester/refinery pressure already present) | 4/5 |
| Target doctrine | Dynamic shifts: power snipes, eco raids, production breaks, base collapse | Mostly static scoring with weak doctrine switching | 2/5 |
| Attack cadence | Timed waves plus opportunistic punish windows | Strong timed waves, weak opportunistic acceleration | 3/5 |
| Defense allocation | Local response groups, preserve offensive momentum | Over-commits broad army response to base threats | 2/5 |
| Scouting | Intentional reconnaissance of key enemy assets and map resources | Mostly random corner scouting | 1/5 |
| Army composition | Preserve core counters in each push (AA/siege/frontline) | Good pool weighting, but pushes can still miss core capabilities | 3/5 |
| Tactical micro | Focus fire, kiting, retreat thresholds | Strong | 4/5 |
| Endgame closure | Shift to kill-shot doctrine when ahead | Partial, not explicit | 2/5 |

## Priority Blueprint

### P0 (implemented in this run)

1. Doctrine engine
- Added `AIStrategicDoctrine` (`economy`, `power`, `production`, `collapse`) with `EnemyMacroIntel` refresh each tick.
- AI now shifts strategic objective from enemy macro state + force ratio, instead of relying on static target scoring.

2. Opportunistic attack windows
- Added opportunistic launch gating (`shouldLaunchOpportunisticAttack`) so AI can punish low-power/weak enemy windows before the normal timer.
- Wave sizing now supports burst-mode attacks.

3. Reserve-aware base defense allocation
- Replaced all-army defense pull with defender selection logic that keeps a home reserve and avoids stripping committed attack groups unless near the threat.

4. Doctrine-weighted targeting and harassment
- Attack scoring now includes doctrine bonuses (`getDoctrineScoreBonus`).
- Harass target logic now pivots by doctrine (economy, power, production/collapse).

5. Wave composition sanity checks
- Added post-selection composition stabilization to ensure critical capabilities when needed: anti-air, siege, and frontline presence.

6. Scouting intent upgrade
- Replaced random-corner scouting with prioritized target sets: enemy CY/refineries/production, ore anchors, center, and fallback corners.
- Added revisit memory + danger-aware scoring to avoid repeated low-value scout paths.

### P1 (recommended next)

1. Fog-of-war-constrained AI perception mode
- Current AI effectively has global entity awareness; add optional imperfect-information mode to simulate human scouting constraints.

2. Cross-wave campaign memory
- Persist enemy weak points (e.g., repeatedly low power, exposed refinery lane) and bias the next 2-3 wave paths.

3. Explicit staging deception
- Add fake pressure on secondary fronts before main commitment for hard difficulty.

### P2 (recommended later)

1. Matchup playbooks by faction archetype
- Distinct doctrine priors for eco-boom, air-control, turtle-break, and rush-defense archetypes.

2. Macro simulation benchmark harness
- Offline scripted scenario runner with KPI outputs:
  - time-to-first-pressure
  - refinery-kill rate
  - power-denial conversion
  - attack success ratio
  - army preservation ratio

## Files Changed in This Upgrade

- `src/combat/AI.ts`
- `docs/ai/2026-03-08-ra2-rts-ai-benchmark-upgrade-blueprint.md`

## Expected Strategic Outcome

Compared to baseline behavior, AI should now:

1. Transition objectives more like a classic RTS opponent (eco -> power/production -> collapse).
2. Convert temporary enemy weakness into immediate pressure (not only scheduled waves).
3. Defend with tighter local force allocation while preserving offensive initiative.
4. Scout high-value areas with memory, not random corners.
5. Avoid sending strategically brittle pushes that lack required counters.
