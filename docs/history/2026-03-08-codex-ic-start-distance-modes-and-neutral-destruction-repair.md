# Work Log: codex-ic-start-distance-modes-and-neutral-destruction-repair
## Task: ic-start-distance-modes-and-neutral-destruction-repair (IronCommand)
## Branch: feat/ic-start-distance-modes-and-neutral-destruction-repair
---

### [Step 1] Audited setup/map-generation/combat systems for target hooks
- **Files changed:** none
- **What:** Inspected `src/scenes/SetupScene.ts`, `src/scenes/GameScene.ts`, `src/engine/GameMap.ts`, `src/combat/Combat.ts`, `src/entities/Unit.ts`, `src/entities/EntityManager.ts`, and `src/entities/BuildingDefs.ts` to locate spawn placement inputs and neutral damage/engineer interactions.
- **Why:** Needed exact integration points to add start-distance mode and neutral destruction/repair behavior without breaking existing mission setup and order flow.
- **Decisions:** Implement start-distance at map-generation level (not only spawn assignment) so preview and gameplay stay consistent for the same seed+map.
- **Issues found:** Engineers currently always capture non-owned buildings; bridge terrain has no destruct/repair runtime model.

### [Step 2] Added start-distance mode through setup, preview, and map generation
- **Files changed:** `src/types/index.ts`, `src/scenes/SetupScene.ts`, `src/scenes/GameScene.ts`, `src/engine/GameMap.ts`
- **What:** Introduced `StartDistanceMode` (`close_battle` / `long_range`) in shared types, added Setup UI radio toggle (`START DISTANCE`), stored it in `SkirmishConfig`, threaded it into `GameScene` map creation, and updated `GameMap`/preview generation to compute start positions with mode-specific spacing and radius profiles.
- **Why:** Required per-map toggle between close-start and long-range-start variants while keeping map terrain/seed consistent.
- **Decisions:** Kept default at `long_range` to preserve existing match pacing unless user explicitly toggles; implemented mode behavior in spawn solver (`minDistance` + radial scoring) rather than post-assignment shuffling.
- **Issues found:** None during implementation.

### [Step 3] Implemented neutral bridge structures and bridge destruction flow
- **Files changed:** `src/entities/BuildingDefs.ts`, `src/scenes/GameScene.ts`
- **What:** Added `neutral_bridge` building definition and auto-spawn logic that creates one neutral bridge structure per connected bridge component. Wired `building_destroyed` handling so destroying a bridge structure collapses its component tiles into water and invalidates pathfinder tiles.
- **Why:** Existing bridge terrain had no entity-level combat target and no destruction state transition.
- **Decisions:** Modeled each connected bridge as one targetable neutral structure (center anchor) to avoid spawning hundreds of per-tile entities.
- **Issues found:** Bridge collapse currently converts full component to water to enforce clear passability break.

### [Step 4] Added engineer repair behavior for damaged neutral structures/bridges
- **Files changed:** `src/combat/Combat.ts`
- **What:** Updated engineer special-case combat logic: engineers now repair damaged neutral buildings (including neutral bridges) instead of capturing. Intact neutral bridges are non-capturable by engineer; other intact hostile/neutral buildings keep capture behavior.
- **Why:** Required explicit engineer repair path for damaged neutral map objects.
- **Decisions:** Used existing `Building.repair()` API with high credit cap to apply full field repair without introducing new resource plumbing.
- **Issues found:** Capturing damaged neutral tech now requires repairing first (intentional side-effect of repair precedence).

### [Step 5] Refined bridge targeting coverage and synchronized component teardown
- **Files changed:** `src/scenes/GameScene.ts`
- **What:** Updated bridge spawning from single-anchor-per-component to multi-anchor placement (`~1 anchor / 10 bridge tiles`) to make long bridges targetable along their span. Added sibling-anchor cleanup so destroying any anchor collapses the entire component and retires remaining anchors.
- **Why:** Single center anchor made attack commands unreliable when clicking near bridge ends.
- **Decisions:** Reused shared component tile array references as a lightweight grouping key; deleted group mappings before sibling teardown to avoid recursive collapse loops.
- **Issues found:** None after refinement.

### [Step 6] Validation build
- **Files changed:** none
- **What:** Ran `npm run build` (TypeScript typecheck + Vite production build) after all patches.
- **Why:** Confirm feature integration compiles cleanly and production bundle still builds.
- **Decisions:** Kept existing chunk-size warning unchanged (pre-existing non-blocking warning).
- **Issues found:** No build failures.

### [Step 7] Captured UI screenshot artifact for PR
- **Files changed:** `docs/screenshots/ic-start-distance-modes-and-neutral-repair.png`
- **What:** Ran local Vite server and used headless Playwright automation to enter `SetupScene` and capture a screenshot showing the new `START DISTANCE` toggle in Skirmish Setup.
- **Why:** UI-affecting change requires screenshot inclusion in PR description.
- **Decisions:** Stored screenshot in-repo under `docs/screenshots/` for stable PR markdown reference.
- **Issues found:** Initial capture landed on boot scene; increased wait and click timing to capture the correct setup UI.

### [Step 8] Tuned long-range spawn spacing for robustness and revalidated build
- **Files changed:** `src/engine/GameMap.ts`
- **What:** Adjusted `SPAWN_LONG_MIN_DISTANCE_RATIO` from `0.34` to `0.30` and reran full build.
- **Why:** Reduce risk of underfilled spawn sets on smaller/tighter maps while keeping long-range starts materially farther than close-battle.
- **Decisions:** Kept close-battle ratio unchanged; only relaxed long-range minimum spacing.
- **Issues found:** None; build remained clean.

## Summary
- **Total files changed:** 7
- **Key changes:**
  - Added `StartDistanceMode` (`close_battle` / `long_range`) and threaded it through setup config, game map creation, and preview generation.
  - Added new SetupScene UI control: `START DISTANCE` radio toggle (`CLOSE BATTLE` vs `LONG RANGE`).
  - Updated spawn solver in `GameMap` to apply mode-specific spawn spacing/radial placement for the same seed/template map.
  - Added neutral bridge structure definition (`neutral_bridge`) and automatic spawn of bridge anchors across connected bridge components.
  - Added bridge destruction behavior: destroying any bridge anchor collapses the full bridge component to water and invalidates pathfinder tiles.
  - Updated engineer special behavior to repair damaged neutral structures/bridges instead of capturing them; intact neutral bridges are non-capturable.
  - Captured and committed UI screenshot artifact: `docs/screenshots/ic-start-distance-modes-and-neutral-repair.png`.
- **Build status:** pass (`npm run build`)
- **Known issues:**
  - Capturing damaged neutral tech structures now takes priority over capture when engineer interacts; capture can still occur when those targets are intact.
  - Bridge collapse currently converts full bridge component tiles to water (hard-cut behavior).
- **Integration notes:**
  - Commit: `7af2197` on branch `feat/ic-start-distance-modes-and-neutral-destruction-repair`.
  - Branch pushed to origin.
  - PR opened and updated with screenshot: https://github.com/linkbag/IronCommand/pull/46
