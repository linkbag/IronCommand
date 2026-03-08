# Work Log: codex-ic-mcv-deploy-undeploy
## Task: ic-mcv-deploy-undeploy (IronCommand)
## Branch: feat/ic-mcv-deploy-undeploy
---

### [Step 1] Baseline audit of MCV/conyard flow
- **Files changed:** none
- **What:** Inspected `src/scenes/GameScene.ts`, `src/scenes/HUDScene.ts`, `src/economy/Production.ts`, `src/entities/EntityManager.ts` and related defs to map existing MCV deploy/undeploy behavior.
- **Why:** Needed to determine whether feature existed partially and identify missing behavior for a robust deploy/undeploy loop.
- **Decisions:** Keep existing transform mechanism (`despawnEntity` + create counterpart) and focus edits on command clarity and state-transition correctness.
- **Issues found:** UI label ambiguity (`D UNPACK` on construction yard despite action being pack-up) and construction/build flow can continue or remain placeable while no active construction yard exists.

### [Step 2] Implemented deploy/pack UI clarity and conyard transition guards
- **Files changed:** `src/scenes/HUDScene.ts`, `src/scenes/GameScene.ts`
- **What:**
  - Updated action command labeling to use explicit `D DEPLOY` / `D PACK` and added `D BUSY` state when pack-up is blocked by active construction workflow.
  - Added `HUDScene.isConstructionWorkflowActive()` and conyard-state helpers to detect active building construction, pending placements, and placement mode.
  - Paused building/defense production progress when no active `construction_yard` exists.
  - Blocked building placement clicks if no active `construction_yard` exists.
  - Added GameScene guard to block `construction_yard -> MCV` pack-up while construction workflow is active.
  - Tightened placement validation (`canPlaceBuilding` + `placeBuilding`) to require active conyard for non-conyard building placements.
- **Why:** Ensure deploy/undeploy loop behaves as a coherent state transition, prevents illegal building flow while packed, and gives players clear command feedback.
- **Decisions:** Chose non-destructive pause/guard behavior for construction flow instead of force-cancelling progress to avoid unexpected credit/state loss.
- **Issues found:** Existing implementation allowed ambiguous command wording and allowed construction-related flow to continue or be placeable without active conyard in some cases.

### [Step 3] Validation build
- **Files changed:** none
- **What:** Ran `npm run build` (TypeScript check + Vite production build).
- **Why:** Verify compile/runtime packaging integrity after deploy/pack and HUD state-flow changes.
- **Decisions:** Kept warning-only chunk-size output unchanged; no bundling strategy changes in this task.
- **Issues found:** None blocking. Build passed.

## Summary
- **Total files changed:** 2
- **Key changes:**
  - Clarified deploy command UX in HUD action button (`D DEPLOY`, `D PACK`, `D BUSY`) and selected-info guidance for conyard pack constraints.
  - Added construction workflow state detection in HUD (`isConstructionWorkflowActive`) to represent active build/placement state explicitly.
  - Enforced conyard-dependent construction transitions: building/defense progress pauses without active conyard; building placement is blocked without active conyard.
  - Added GameScene guard to block conyard pack-up while construction workflow is active, with HUD/EVA warning feedback.
  - Hardened placement validation in both registry `canPlaceBuilding` and `placeBuilding` handler to require active conyard for non-conyard building placements.
- **Build status:** pass (`npm run build`)
- **Known issues:** No functional blockers identified in this scope.
- **Integration notes:**
  - Existing MCV<->Construction Yard transform path remains `create counterpart + despawnEntity` (non-destruction transition), now with stricter construction-state gating.
  - UI screenshot asset available at `docs/screenshots/mcv-deploy-undeploy.png` for PR description.

### [Step 4] SCM + PR update
- **Files changed:** none (repository content already committed)
- **What:** Committed gameplay/UI changes, pushed `feat/ic-mcv-deploy-undeploy`, and updated existing PR #30 title/body with validation notes and screenshot reference.
- **Why:** Complete delivery pipeline for reviewer/integrator handoff.
- **Decisions:** Existing PR for branch was reused (updated via GitHub API due `gh pr edit` GraphQL compatibility issue in local CLI).
- **Issues found:** `gh pr edit` failed due deprecated Projects(classic) GraphQL field; worked around with `gh api ... pulls/30 --method PATCH`.

## Summary
- **Total files changed:** 2
- **Key changes:**
  - Added explicit MCV/conyard deploy command UX (`DEPLOY`, `PACK`, `BUSY`) in HUD command panel and selected-info panel.
  - Added conyard-aware construction state handling so building/defense production and placement require active construction yard.
  - Added undeploy guard in GameScene to block packing while construction workflow is active.
  - Added conyard requirement checks in placement validator and place-building event path.
- **Build status:** pass (`npm run build`)
- **Known issues:** None blocking in implemented scope.
- **Integration notes:**
  - Commit: `854a349`
  - Branch pushed: `origin/feat/ic-mcv-deploy-undeploy`
  - PR updated: https://github.com/linkbag/IronCommand/pull/30 (includes screenshot reference `docs/screenshots/mcv-deploy-undeploy.png`)

### Review+Fix Round 1
- **Reviewer:** codex-ic-mcv-deploy-undeploy-review-1
- **Timestamp:** 2026-03-08 05:04:14
- **Files reviewed:** src/scenes/GameScene.ts, src/scenes/HUDScene.ts, src/entities/EntityManager.ts, src/engine/GameMap.ts, src/entities/Building.ts, src/entities/Unit.ts
- **Issues found:** One minor redundancy: `setBuildingTileOccupancy(building, true)` is invoked twice during `deployMCV` and `placeBuilding` — once through the `building_placed` event listener and once directly in the calling method. Since `setOccupied` is idempotent (overwrite same value) this has no functional impact.
- **Fixes applied:** None needed — all issues were non-functional. TypeScript (`npx tsc --noEmit`) passes cleanly with zero errors.
- **Build status:** pass
- **Remaining concerns:** The double tile-occupancy call pattern is harmless now but could mask future bugs if `setBuildingTileOccupancy` ever gains side effects. Consider removing the direct call in `placeBuilding` and `deployMCV` (after `createBuilding`) since the `building_placed` event listener already handles it — but this is an optional clean-up, not a blocker.
