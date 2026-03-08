# Work Log: codex-ic-map-continent-allvisible-ore-regen
## Task: ic-map-continent-allvisible-ore-regen (IronCommand)
## Branch: feat/ic-map-continent-allvisible-ore-regen
---

### [Step 1] Initialize session log and baseline repository scan
- **Files changed:** /tmp/worklog-codex-ic-map-continent-allvisible-ore-regen.md
- **What:** Initialized mandatory work log, confirmed current branch state, and listed repository files.
- **Why:** Needed traceability and fast discovery of map/fog/economy implementation files before edits.
- **Decisions:** Used ripgrep-driven scan to target `GameMap.ts`, `SetupScene.ts`, `GameScene.ts`, and shared type constants.
- **Issues found:** None.

### [Step 2] Analyze existing feature coverage and identify deltas
- **Files changed:** /tmp/worklog-codex-ic-map-continent-allvisible-ore-regen.md
- **What:** Inspected current continent generation logic, setup visibility options, fog activation flow, and ore regen constants.
- **Why:** Needed to determine which requested features already existed partially and which required implementation/rework.
- **Decisions:** Reuse proven continent-landmass changes from prior branch commits (`970b07e`, `2ffdb1d`) and add the remaining all-visible option clarity + ore-regen rebalance + tests.
- **Issues found:** Continental maps still carve guaranteed river/lakes and use aggressive water spread; ore regen still set to 10 units/tick (10% of harvest load).

### [Step 3] Apply continent-landmass generation fixes
- **Files changed:** src/engine/GameMap.ts
- **What:** Cherry-picked previously reviewed commits (`970b07e`, `2ffdb1d`) that rebalance continental topology toward connected landmass: higher water threshold, coast-biased water score, removal of guaranteed rivers/lakes, continent-specific ocean component retention, and channel trimming; also included the river-width bugfix.
- **Why:** Requested continent maps should be less watery and more continuous; prior branch already contained validated focused changes for this behavior.
- **Decisions:** Reused proven patchset to minimize regression risk and avoid re-deriving complex terrain tuning.
- **Issues found:** None during cherry-pick.

### [Step 4] Add explicit pre-game all-visible visibility mode wiring
- **Files changed:** src/scenes/skirmishConfig.ts, src/scenes/SetupScene.ts, src/scenes/GameScene.ts
- **What:** Introduced shared skirmish config module with `mapVisibility` enum (`'fog' | 'allVisible'`), visibility options, default-config helper, and `isMapRevealEnabled()`; updated setup UI to use explicit visibility mode and GameScene to consume it with legacy `revealMap` fallback compatibility.
- **Why:** Requested a pre-game all-visible option that is explicit and reliable at game-start fog initialization.
- **Decisions:** Kept `revealMap` optional in config for backward compatibility with existing payloads while migrating logic to the clearer `mapVisibility` field.
- **Issues found:** None.

### [Step 5] Rebalance ore recovery to 2% of mining rate
- **Files changed:** src/types/index.ts, src/engine/GameMap.ts
- **What:** Changed `ORE_REGEN_RATE` from `10` to `2` and updated regen commentary/logic so ore tiles recover at the exact base tick rate without adjacency multiplier inflation.
- **Why:** User requested mine recovery at 2% of ore miner extraction rate (`ORE_HARVEST_RATE = 100`).
- **Decisions:** Removed the depleted-ore adjacency bonus application in regen amount computation to keep rate interpretation strict and deterministic.
- **Issues found:** None.

### [Step 6] Add automated tests and balance notes
- **Files changed:** package.json, package-lock.json, tests/game-balance-and-map.test.ts, docs/history/2026-03-08-codex-ic-map-allvisible-ore-balance.md
- **What:** Added Vitest test runner and tests validating continental map topology metrics across fixed seeds, map-visibility enablement logic, and ore regen ratio; added persistent balance notes documenting the tuning and expected gameplay impact.
- **Why:** Requested tests and balance notes alongside gameplay/system changes.
- **Decisions:** Mocked `phaser` in tests so procedural map generation can be validated in Node test runtime without browser APIs.
- **Issues found:** Initial test used non-existent width/height in preview payload; corrected to use known map size.

### [Step 7] Validate build and test suite
- **Files changed:** /tmp/worklog-codex-ic-map-continent-allvisible-ore-regen.md
- **What:** Ran `npm test` and `npm run build` after all edits.
- **Why:** Ensure behavior changes are covered by tests and project remains type-safe/buildable.
- **Decisions:** Used project scripts as authoritative validation gates.
- **Issues found:** Build emits existing Vite chunk-size warning only; no new failures.

### [Step 8] Commit, push, and open PR
- **Files changed:** repository tracked files + /tmp/worklog-codex-ic-map-continent-allvisible-ore-regen.md
- **What:** Committed branch changes (`ec3c85c`, `53f6dac`, `6fdef6c`), pushed branch `feat/ic-map-continent-allvisible-ore-regen`, and opened PR #36 (`https://github.com/linkbag/IronCommand/pull/36`).
- **Why:** Complete delivery workflow requested by user.
- **Decisions:** Preserved prior validated continent-landmass commits and layered requested all-visible config + ore rebalance + tests as an additive commit.
- **Issues found:** None.

## Summary
- **Total files changed:** 9
- **Key changes:**
  - Applied continent-generation rebalance to produce less water and stronger contiguous landmass behavior (coast bias + ocean component enforcement + channel trimming).
  - Added explicit pre-game visibility mode (`mapVisibility`) with shared config helper and legacy `revealMap` compatibility.
  - Rebalanced ore recovery from `10` to `2` units/tick (2% of miner extraction load) and removed adjacency multiplier inflation in depleted-ore regen.
  - Added automated Vitest coverage for continental topology metrics, reveal-option behavior, and ore regen ratio.
  - Added persistent balance notes document: `docs/history/2026-03-08-codex-ic-map-allvisible-ore-balance.md`.
- **Build status:** pass (`npm test`, `npm run build`)
- **Known issues:** Existing Vite bundle-size warning persists (pre-existing).
- **Integration notes:**
  - `SkirmishConfig` moved to `src/scenes/skirmishConfig.ts`; `SetupScene` re-exports the type for compatibility.
  - `GameScene` now interprets reveal mode via `isMapRevealEnabled()` and still honors legacy `revealMap` payloads.
  - PR: https://github.com/linkbag/IronCommand/pull/36

### Review+Fix Round 1
- **Reviewer:** codex-ic-map-continent-allvisible-ore-regen-review-1
- **Timestamp:** 2026-03-08 10:34:02
- **Files reviewed:**
  - src/engine/GameMap.ts
  - src/scenes/skirmishConfig.ts
  - src/scenes/SetupScene.ts
  - src/scenes/GameScene.ts
  - src/types/index.ts
  - tests/game-balance-and-map.test.ts
  - docs/history/2026-03-08-codex-ic-map-allvisible-ore-balance.md
  - package.json
- **Issues found:** None. All TypeScript compiles clean (npx tsc --noEmit = 0 errors). All 3 vitest tests pass. Logic is sound:
  - `mapVisibility` enum is properly typed and exported from skirmishConfig.ts; SetupScene and GameScene import from the new module.
  - Legacy `revealMap` fallback in GameScene.init() correctly handles undefined (only fires when mapVisibility is absent).
  - SetupScene.launchMission() writes back revealMap for full compatibility.
  - isMapRevealEnabled() handles both mapVisibility=allVisible and legacy revealMap=true correctly.
  - carveMeanderingRiver now uses halfWidth=1 (was 0) on continental maps, fixing a zero-width river bug from the prior review round.
  - Ore regen removes adjacentBonus multiplier and uses flat ORE_REGEN_RATE=2, consistent with the balance rationale.
  - depletedOreTiles logic: fully depleted tiles (terrain→GRASS) are never added; partially depleted entries have defensive oreAmount<=0 guard in regen loop.
  - `as unknown as Map<...>` cast in SetupScene.createRadioGroup call is a minor style issue but not a bug; TypeScript accepts it and tests pass.
- **Fixes applied:** None needed
- **Build status:** pass (tsc --noEmit: 0 errors, npm test: 3/3 pass)
- **Remaining concerns:** The `as unknown as Map<string | number | boolean, ...>` double cast in SetupScene line 344 is inelegant — createRadioGroup could accept a generic type parameter to avoid it — but it is not a runtime risk. No blockers for merge.
