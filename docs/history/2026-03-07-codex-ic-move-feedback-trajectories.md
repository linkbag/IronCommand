# Work Log: codex-ic-move-feedback-trajectories
## Task: ic-move-feedback-trajectories (IronCommand)
## Branch: feat/ic-move-feedback-trajectories
---

### [Step 1] Locate move-order and overlay integration points
- **Files changed:** none
- **What:** Inspected `src/scenes/GameScene.ts` and `src/scenes/HUDScene.ts` to find where move commands are issued and where screen-space overlays are rendered.
- **Why:** Needed exact hooks for adding trajectory visuals without conflicting with rally/selection overlays.
- **Decisions:** Implement in `GameScene` only, using existing overlay render flow (`drawRallyOverlay` in update loop) and both move command paths (`handleLeftClick`, `issueOrder`).
- **Issues found:** Move orders can be triggered from multiple paths (main click handling and HUD/minimap event), so helper method is required to avoid drift.

### [Step 2] Implement transient move-trajectory overlay in GameScene
- **Files changed:** src/scenes/GameScene.ts
- **What:** Added `moveTrajectoryOverlay` + `moveTrajectoryLines` state, line lifetime constants, and two helpers: `queueMoveTrajectoryLines()` and `drawMoveTrajectoryOverlay()`.
- **Why:** Needed a dedicated, temporary visualization layer for move feedback that fades within ~1.4s and does not interfere with persistent rally overlays.
- **Decisions:**
  - Render as a single graphics overlay (screen-space, depth 191) rather than per-line objects/tweens for better performance.
  - Cap active lines at 64 (`MOVE_TRAJECTORY_MAX_LINES`) to keep rendering bounded during heavy multi-select command spam.
  - Reuse per-frame camera-adjusted drawing in `GameScene` update loop for clean integration with existing overlay ordering.
- **Issues found:** None; overlay ordering chosen to sit above rally lines (depth 190) and below selection rectangle (depth 200).

### [Step 3] Hook move command paths and validate behavior assumptions
- **Files changed:** src/scenes/GameScene.ts
- **What:** Wired trajectory enqueueing in two move-order paths:
  - `handleLeftClick()` after movement orders are issued to selected units.
  - `wireHUDEvents()` `issueOrder` handler when `type === 'move'` (covers minimap right-click move).
- **Why:** Move commands are issued from both world click and HUD/minimap event path; both must trigger consistent feedback.
- **Decisions:**
  - Use central issued target for feedback lines in formation move case (lines converge on command point), while actual unit orders still include formation offsets.
  - Do not trigger for non-move orders (`harvest`, `attack`, `guard`, `stop`) to keep signal clear.
- **Issues found:** None.

### [Step 4] Type/build verification
- **Files changed:** none
- **What:** Ran `npm run build` (`tsc --noEmit && vite build`).
- **Why:** Confirmed typecheck cleanliness and integration safety.
- **Decisions:** Treat build pass as acceptance for “Typecheck clean” requirement.
- **Issues found:** Existing Vite chunk-size warning only (non-blocking, unchanged by this task).

### [Step 5] Capture UI screenshot artifact for PR
- **Files changed:** docs/screenshots/ic-move-feedback-trajectories.png
- **What:** Ran local dev server and captured a 1600x900 headless screenshot using Playwright.
- **Why:** Task includes a UI change; PR should include a screenshot.
- **Decisions:** Stored screenshot in-repo under `docs/screenshots/` so it can be referenced directly from PR markdown.
- **Issues found:** Captured screen shows main menu state; gameplay trajectory effect itself is not visible in this static capture.

## Summary
- **Total files changed:** 2
- **Key changes:**
  - Added transient move trajectory rendering to `src/scenes/GameScene.ts` via `queueMoveTrajectoryLines()` + `drawMoveTrajectoryOverlay()`.
  - Integrated trajectory enqueueing into both player world-click move flow (`handleLeftClick`) and HUD/minimap move flow (`issueOrder` event).
  - Added overlay lifecycle/reset handling in `init()` and layered render setup in `create()`.
  - Added PR screenshot asset at `docs/screenshots/ic-move-feedback-trajectories.png`.
- **Build status:** pass (`npm run build`)
- **Known issues:** Screenshot is captured from menu scene; move-trajectory effect itself requires in-match interaction and is not visible in static menu capture.
- **Integration notes:**
  - Commit: `cc017b0` on branch `feat/ic-move-feedback-trajectories`.
  - Branch pushed to `origin/feat/ic-move-feedback-trajectories`.
  - PR opened: https://github.com/linkbag/IronCommand/pull/19

### Review+Fix Round 1
- **Reviewer:** codex-ic-move-feedback-trajectories-review-1
- **Timestamp:** 2026-03-07 22:36:46
- **Files reviewed:** src/scenes/GameScene.ts
- **Issues found:** None. Code is correct:
  - `cartToScreen` and `Position` are both properly imported (lines 17, 19)
  - `movedUnitIds` in the `issueOrder` handler is scoped inside the event callback (fresh per call, no sharing)
  - Coordinate conversion pattern (cartToScreen → subtract camX/camY) matches the existing rallyOverlay pattern exactly
  - Line cap logic correctly limits both new lines per call (newLines.length cap) and total (splice trim)
  - `drawMoveTrajectoryOverlay` correctly replaces `this.moveTrajectoryLines` with the filtered activeLines each frame — clean expiry without a separate timer
  - `init()` cleanup and `create()` setup are symmetric and correct
  - Alpha range (0.08–0.30) is subtle but intentional for non-distracting feedback
  - Typecheck: clean (npx tsc --noEmit — no errors)
- **Fixes applied:** None needed
- **Build status:** Typecheck pass (tsc --noEmit)
- **Remaining concerns:** Minor GC: `drawMoveTrajectoryOverlay` allocates a new array each frame when lines are active, but at ≤64 elements this is negligible. No action needed.
