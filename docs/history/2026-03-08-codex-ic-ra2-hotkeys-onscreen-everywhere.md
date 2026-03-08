# Work Log: codex-ic-ra2-hotkeys-onscreen-everywhere
## Task: ic-ra2-hotkeys-onscreen-everywhere (IronCommand)
## Branch: feat/ic-ra2-hotkeys-onscreen-everywhere
---

### [Step 1] Locate selection and shortcut control points
- **Files changed:** /tmp/worklog-codex-ic-ra2-hotkeys-onscreen-everywhere.md
- **What:** Inspected `src/scenes/GameScene.ts`, `src/scenes/HUDScene.ts`, and `src/engine/Selection.ts` to identify where click selection, drag selection, and keyboard hotkeys are actually handled.
- **Why:** Needed to implement T/P behavior in the active input path (GameScene) and avoid conflicts with existing HUD build hotkeys.
- **Decisions:** Chose to implement in `GameScene` (primary runtime selection system) and add a small guard in `HUDScene` for `T` to preserve existing build hotkey UX without accidental build queueing.
- **Issues found:** `P` is currently bound to pause in `GameScene`; `T` is currently used by HUD build-grid hotkeys, so direct additions would conflict without coordination.

### [Step 2] Implement RA2 selection hotkeys and map-wide type selection
- **Files changed:** src/scenes/GameScene.ts, src/scenes/HUDScene.ts, /tmp/worklog-codex-ic-ra2-hotkeys-onscreen-everywhere.md
- **What:** Added `GameScene` selection helpers for on-screen and map-wide own-unit queries, wired `T` to same-type selection (double-tap `T` = map-wide), wired `P` to select all own units currently on-screen, and changed double-clicking an own unit to select that type map-wide. Added timestamp/type tracking for double-tap and double-click detection.
- **Why:** Needed Red Alert-style selection behavior while preserving current selection state sync and visual updates.
- **Decisions:** Reused existing selection synchronization (`syncSelectionState`) and selection visuals; switched pause hotkey binding from `P` to `PauseBreak` while keeping `ESC` pause toggle intact.
- **Issues found:** HUD build-grid still listens for `T` as a build hotkey, which conflicted with gameplay selection.

### [Step 3] Preserve shortcut UX compatibility and validate build
- **Files changed:** src/scenes/HUDScene.ts, /tmp/worklog-codex-ic-ra2-hotkeys-onscreen-everywhere.md
- **What:** Added `HUDScene.hasOwnUnitSelected()` and guarded build-hotkey handling so `T` is ignored by build queue hotkeys when own units are selected (allowing gameplay type-selection hotkey to take precedence). Updated build-hotkey comment to match actual key set.
- **Why:** Prevents accidental production queue actions when using the new `T` selection hotkey.
- **Decisions:** Scoped guard only to `T` and only when own units are selected, preserving existing build-hotkey behavior in non-selection contexts.
- **Issues found:** `npm run -s tsc -- --noEmit` failed because no `tsc` script exists; validated with `npx tsc --noEmit` instead and `npm run -s build`.

### [Step 4] Commit, push, and open pull request
- **Files changed:** src/scenes/GameScene.ts, src/scenes/HUDScene.ts, /tmp/worklog-codex-ic-ra2-hotkeys-onscreen-everywhere.md
- **What:** Committed changes as `51c8b99` (`Add RA2-style T/P on-screen selection hotkeys`), pushed branch `feat/ic-ra2-hotkeys-onscreen-everywhere`, and opened PR #38: https://github.com/linkbag/IronCommand/pull/38.
- **Why:** Complete delivery workflow for review/integration.
- **Decisions:** Updated PR body via `gh api` REST patch after `gh pr edit` failed with the known Projects Classic GraphQL deprecation error path.
- **Issues found:** `gh pr edit` command path remains unreliable in this environment due GraphQL `projectCards` deprecation query.

## Summary
- **Total files changed:** 2
- **Key changes:**
  - Added RA2-style same-type selection in `GameScene`: `T` selects same selected-unit type on-screen; double-tap `T` selects map-wide.
  - Changed own-unit double-click behavior to map-wide same-type selection.
  - Added `P` hotkey in `GameScene` to select all own units currently visible on-screen.
  - Added HUD hotkey compatibility guard so build-hotkey `T` does not fire while own units are selected.
  - Shifted pause hotkey mapping from `P` to `Pause/Break` while keeping `ESC` pause toggle.
- **Build status:** pass (`npx tsc --noEmit`, `npm run -s build`)
- **Known issues:** None blocking; PR body updates should continue using REST API (`gh api`) if `gh pr edit` fails in this environment.
- **Integration notes:** Review focus is `src/scenes/GameScene.ts` selection helper paths (`handleSelectSameTypeHotkey`, `selectUnitsOfType`, `selectAllOwnUnitsOnScreen`, double-click branch in `handleLeftClick`) and `src/scenes/HUDScene.ts` `hasOwnUnitSelected` guard for `T` build hotkey coexistence.
