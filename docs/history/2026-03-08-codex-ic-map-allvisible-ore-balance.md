# Balance Notes: Continent Landmass + All-Visible Option + Ore Regen

## Map generation tuning (continental)
- Continental generation now biases water toward outer coast bands and suppresses interior water.
- Guaranteed continent rivers/lakes were removed (rare river carve remains), reducing island-like breakup.
- A continent-only cleanup keeps one edge-connected ocean component and fills disconnected inland water components.
- Added channel trimming to prevent narrow fjord cuts from over-fragmenting the main landmass.

### Automated guardrails (tests)
- Fixed-seed continental test now asserts:
  - water ratio < `0.42`
  - largest connected landmass ratio > `0.93`
  - inland water ratio < `0.025`

## Pre-game all-visible map option
- Setup config now uses explicit `mapVisibility: 'fog' | 'allVisible'`.
- GameScene fog bootstrap reads this option via a shared helper (`isMapRevealEnabled`) and still supports legacy `revealMap` payloads.

## Ore recovery rebalance
- `ORE_HARVEST_RATE`: `100` ore per harvest load (unchanged).
- `ORE_REGEN_RATE`: changed from `10` to `2` ore per regen tick.
- Regen tick interval remains `6000ms`, so per-tile passive recovery is now `20 ore/min` (was `100 ore/min`).
- This sets baseline recovery to exactly `2%` of miner extraction per tick and materially reduces passive infinite-economy pressure.
