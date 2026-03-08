# Work Log: codex-ic-move-feedback-v2
## Task: ic-move-feedback-v2 (IronCommand)
## Branch: feat/ic-move-feedback-v2
---

### [Step 1] Initialized mandatory work log
- **Files changed:** /tmp/worklog-codex-ic-move-feedback-v2.md
- **What:** Created the session work log with task and branch metadata header.
- **Why:** Required by pipeline instructions so downstream reviewers/integrators can track exact changes.
- **Decisions:** Used the exact initialization template provided by the user.
- **Issues found:** None.

### [Step 2] Implemented move command feedback overlay pipeline in GameScene
- **Files changed:** src/scenes/GameScene.ts
- **What:** Added transient move-feedback systems: `moveTrajectoryOverlay`, `moveTrajectoryLines`, `moveOrderMarker`, and helpers (`triggerMoveFeedback`, `queueMoveTrajectoryLines`, `drawMoveTrajectoryOverlay`, `drawSegmentedMoveRing`, `drawMoveCrosshair`, `showMoveOrderMarker`). Hooked feedback trigger into both move issuance paths (`handleLeftClick` and HUD/minimap `issueOrder` when `type === 'move'`).
- **Why:** Needed visible, immediate move-order confirmation at destination plus planned path preview from selected moving units, without interfering with rally overlay rendering.
- **Decisions:**
  - Rendered both trajectory lines and destination marker on a single persistent graphics overlay at depth 191 (above rally depth 190, below selection depth 200).
  - Replaced transient marker gameobject+tween allocation with state-driven per-frame drawing to avoid object churn and leak risk.
  - Added dedupe guard (`MOVE_FEEDBACK_DEDUPE_MS`, signature by rounded target + sorted moved unit IDs) to prevent accidental double-triggering.
  - Capped queued trajectory lines (`MOVE_TRAJECTORY_MAX_LINES = 64`) and pruned expired lines every frame for bounded memory.
- **Issues found:** Cherry-pick conflict from prior historical move-feedback commits; resolved manually and unified logic into one feedback trigger path.

### [Step 3] Verified typecheck/build and reviewed staged artifact set
- **Files changed:** none (validation step)
- **What:** Ran `npm run build` (`tsc --noEmit && vite build`) and confirmed successful typecheck/build. Kept screenshot artifact `docs/screenshots/ic-move-feedback-trajectories.png` staged for PR screenshot linkage.
- **Why:** Task requires typecheck cleanliness and UI-change PR screenshot inclusion.
- **Decisions:** Accepted existing non-blocking Vite chunk-size warning as pre-existing and unrelated to this change.
- **Issues found:** None blocking; build completed successfully.

## Summary
- **Total files changed:** 2
- **Key changes:**
  - Added move feedback overlay state/rendering in `src/scenes/GameScene.ts` (destination marker + temporary trajectory lines).
  - Wired feedback to both move command paths: direct world-click `handleLeftClick()` and HUD/minimap `issueOrder` (`type: move`).
  - Added dedupe guard to prevent duplicate marker/trajectory triggering from repeated equivalent move events.
  - Added bounded lifetime/size controls (`MOVE_TRAJECTORY_DURATION_MS`, `MOVE_TRAJECTORY_MAX_LINES`, marker expiry) to avoid unbounded memory growth.
  - Added screenshot artifact `docs/screenshots/ic-move-feedback-trajectories.png` and linked it in PR #24 description.
- **Build status:** pass (`npm run build`)
- **Known issues:** Existing Vite chunk-size warning remains unchanged; no new type/build issues introduced.
- **Integration notes:**
  - Commit: `da5f188`
  - Branch pushed: `origin/feat/ic-move-feedback-v2`
  - PR opened: https://github.com/linkbag/IronCommand/pull/24
  - PR body updated via REST API (`gh api`) because `gh pr edit` GraphQL path errored on deprecated projectCards field.

### Review+Fix Round 1
- **Reviewer:** codex-ic-move-feedback-v2-review-1
- **Timestamp:** 2026-03-08 04:04:17
- **Files reviewed:** src/scenes/GameScene.ts, src/engine/GameMap.ts (worldWidth/worldHeight), src/engine/IsoUtils.ts (cartToScreen), node_modules/phaser/types/phaser.d.ts (Phaser.Math.Easing.Cubic.Out)
- **Issues found:** None blocking. Minor observations: (1) `drawMoveTrajectoryOverlay` allocates a new `activeLines` array every frame while lines are active (up to 1400ms / ~84 frames, up to 64 lines). This is GC churn but low impact given short duration and existing per-frame allocations in `cartToScreen`. (2) Multiple units moving to the same target cause redundant `fillCircle` draws at the endpoint — purely cosmetic redundancy. (3) `rallyOverlay` (pre-existing) uses `!` assertion and is `destroy()`-ed in `init()` without being set to undefined — `moveTrajectoryOverlay` correctly uses `?` and is set to `undefined` after destruction. All new code is sound.
- **Fixes applied:** None needed — all identified items are pre-existing patterns or non-critical. TypeScript passes cleanly with zero errors.
- **Build status:** npx tsc --noEmit — PASS
- **Remaining concerns:** The per-frame `activeLines` array allocation in `drawMoveTrajectoryOverlay` could be converted to in-place splice (filter-in-place) for cleanliness, but is not a correctness issue and not worth a mandatory fix at this stage.
