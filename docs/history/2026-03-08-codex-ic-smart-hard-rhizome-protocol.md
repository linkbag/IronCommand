# codex-ic-smart-hard-rhizome-protocol — 2026-03-08

## Summary
- Added a new AI difficulty tier: `smart_hard`.
- Implemented a blended rule-based + emergent control layer on top of existing hard AI:
  - Metabolic organ loop with strict ordering: `power -> refinery -> production -> expansion`.
  - Rule-of-3 base spacing bias for organ placement (with logged fallback when map constraints block strict spacing).
  - Cellular NC-state updates every ~2s (`isolated_retreat`, `stable_standard`, `pressure_overspill`).
  - Potential-field rerouting with weighted attraction/repulsion over miners, power, repair allies, turret/tesla threats, and fog.
  - Overdrive mode (enemy superweapon ETA < 60s or base damage >= 30% in 60s) that suppresses retreat + repulsion and floods attack orders.

## Instrumentation + Tuning
- New tunables live in [`src/combat/smartHard.ts`](../../src/combat/smartHard.ts):
  - `SMART_HARD_TUNING` (cell cadence, NC thresholds, overdrive thresholds, potential-field weights, rule-of-3 spacing).
- Runtime telemetry from `AI.ts` emits periodic Smart Hard stats:
  - `overdriveTriggers`
  - `cellularTransitions`
  - `potentialReroutes`
  - `metabolicActions`
  - `ruleOfThreeFallbacks`

## Deterministic Tests
- Added [`tests/smartHard.test.ts`](../../tests/smartHard.test.ts) (Vitest) covering:
  - NC coefficient + state classification logic.
  - Overdrive trigger thresholds.
  - Potential-field scoring and repulsion suppression in overdrive.
  - Rule-of-3 spacing check behavior.

## Tradeoffs vs Raw RA2 Behavior
- Preserved RA2-style macro flow (tech climb, mixed waves, economy expansion), but intentionally diverged in these areas:
  - Added explicit organ-health gating and periodic cellular state checks (RA2 stock AI is less explicit/stateful here).
  - Added potential-field routing to reduce straight-line suicides into static defenses (RA2 pathing/AI often commits directly).
  - Added reactive overdrive flood mode tied to strategic pressure triggers rather than fixed scripted aggression windows.
- Resulting behavior is less “script-wave deterministic” and more pressure-reactive, while still using RA2-like production/economy cadence as the base.
