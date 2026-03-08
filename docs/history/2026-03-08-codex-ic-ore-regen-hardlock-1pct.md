# Work Log: codex-ic-ore-regen-hardlock-1pct
## Task: ic-ore-regen-hardlock-1pct (IronCommand)
## Branch: feat/ic-ore-regen-hardlock-1pct
---

### [Step 1] Initialized mandated work log and scoped ore recovery implementation points
- **Files changed:** /tmp/worklog-codex-ic-ore-regen-hardlock-1pct.md
- **What:** Created work log header and scanned repository for ore mining/recovery constants and regeneration logic.
- **Why:** Needed exact code paths before applying a hard 1% lock and preventing hidden overrides.
- **Decisions:** Focused on `src/types/index.ts`, `src/entities/Unit.ts`, and `src/engine/GameMap.ts` as the authoritative mining/recovery paths.
- **Issues found:** Existing recovery is duplicated (`regenerateDepletedOre` + `regenerateExistingOre`) and one path applies an adjacency multiplier with floor rounding.

### [Step 2] Hard-locked ore recovery rate to 1% of mining speed and removed drift paths
- **Files changed:** src/types/index.ts, src/engine/GameMap.ts
- **What:** Added `ORE_RECOVERY_RATIO = 0.01` and derived `ORE_REGEN_RATE` from `ORE_HARVEST_RATE`. Removed alternate recovery path (`regenerateDepletedOre`), adjacency bonus override, and floor rounding so ore recovery uses a single exact rate path.
- **Why:** Previous logic could drift above configured recovery due to duplicated regeneration loops and local multipliers.
- **Decisions:** Kept existing recovery tick interval (6s) and locked per-tick amount to the global 1% policy to minimize gameplay side-effects while enforcing invariant.
- **Issues found:** `GameMap` had overlapping recovery mechanics that both touched partially depleted ore tiles.

### [Step 3] Added invariant test coverage and test runner
- **Files changed:** package.json, package-lock.json, src/economy/oreRecoveryInvariant.test.ts
- **What:** Installed `tsx`, added `npm test` script, and created tests that assert recovery ratio is exactly 1% of mining speed and that `GameMap` no longer contains local recovery multipliers/override recovery methods.
- **Why:** User requested explicit invariant enforcement and anti-drift auditing; tests now fail if someone reintroduces alternate regen logic.
- **Decisions:** Used Node built-in test runner via `tsx --test` to keep setup minimal in a project without an existing test framework.
- **Issues found:** Repository had no test script/harness prior to this change.

### [Step 4] Verified invariant and build health
- **Files changed:** /tmp/worklog-codex-ic-ore-regen-hardlock-1pct.md
- **What:** Ran `npm test`, `npx tsc --noEmit`, and `npm run build`.
- **Why:** Confirmed new invariants pass and no regressions in type-check/build pipeline.
- **Decisions:** Included full production build validation in addition to unit/invariant tests.
- **Issues found:** Vite reported large chunk warning (pre-existing optimization warning, not introduced by this change).

### [Step 5] Committed, pushed, and opened PR
- **Files changed:** repository git metadata (commit/branch/PR), /tmp/worklog-codex-ic-ore-regen-hardlock-1pct.md
- **What:** Created commit `11a1867`, pushed branch `feat/ic-ore-regen-hardlock-1pct`, opened PR https://github.com/linkbag/IronCommand/pull/43.
- **Why:** Completed delivery workflow required by task instructions.
- **Decisions:** Used PR auto-fill with commit context because change scope is isolated and commit message is descriptive.
- **Issues found:** None.

## Summary
- **Total files changed:** 5
- **Key changes:**
  - Added `ORE_RECOVERY_RATIO = 0.01` and derived `ORE_REGEN_RATE` from `ORE_HARVEST_RATE` in `src/types/index.ts`.
  - Removed alternate/deviating ore regeneration logic in `src/engine/GameMap.ts` (`regenerateDepletedOre`, adjacency bonus, floor rounding, separate spread timer).
  - Kept a single ore recovery path (`regenerateExistingOre`) that applies only `ORE_REGEN_RATE`.
  - Added invariant tests in `src/economy/oreRecoveryInvariant.test.ts` to enforce 1% ratio and audit `GameMap` for local override drift.
  - Added test runner support via `tsx` and `npm test` script in `package.json`.
- **Build status:** pass (`npm test`, `npx tsc --noEmit`, `npm run build`)
- **Known issues:** No new issues from this change. Existing Vite chunk-size warning remains.
- **Integration notes:** Invariant test includes source-audit assertions; if recovery logic is intentionally reworked later, update tests in `src/economy/oreRecoveryInvariant.test.ts` alongside code changes.

### Review+Fix Round 1
- **Reviewer:** codex-ic-ore-regen-hardlock-1pct-review-1
- **Timestamp:** 2026-03-08 14:07:43
- **Files reviewed:** src/types/index.ts, src/engine/GameMap.ts, src/economy/oreRecoveryInvariant.test.ts, package.json
- **Issues found:** None. Logic is correct:
  - Fully depleted tiles become GRASS and are removed from oreTiles (no regen — matches RA2 behavior).
  - Partially depleted tiles remain in oreTiles and receive exactly 1 ore unit per 6s tick (ORE_REGEN_RATE = 100 * 0.01 = 1).
  - No dangling references to removed code (depletedOreTiles, oreSpreadTimerMs, regenerateDepletedOre, hasAdjacentOre, key()).
  - Old double-regen path (tile in both oreTiles + depletedOreTiles) correctly eliminated.
  - ORE_RECOVERY_RATIO properly exported and used in test.
  - Test pattern match for single regen application is robust.
- **Fixes applied:** None needed.
- **Build status:** tsc --noEmit → pass (exit 0); npm test → pass (2/2 invariants).
- **Remaining concerns:** None. The test is intentionally brittle (source-code string audit) which is correct for an anti-drift invariant.
