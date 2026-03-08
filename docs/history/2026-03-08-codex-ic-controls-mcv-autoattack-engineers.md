# Work Log: codex-ic-controls-mcv-autoattack-engineers
## Task: ic-controls-mcv-autoattack-engineers (IronCommand)
## Branch: feat/ic-controls-mcv-autoattack-engineers
---

### [Step 1] Audited gameplay, HUD, and entity systems for feature hooks
- **Files changed:** none
- **What:** Inspected `src/scenes/GameScene.ts`, `src/scenes/HUDScene.ts`, `src/entities/Unit.ts`, `src/entities/EntityManager.ts`, `src/combat/Combat.ts`, and `src/engine/GameMap.ts` to locate input, selection, combat AI, MCV transform, ore search, and engineer behavior paths.
- **Why:** Needed exact integration points to implement a cohesive control+logistics package without introducing regressions.
- **Decisions:** Implement features primarily via existing event-driven architecture (Unit -> EntityManager -> GameScene), keeping core interfaces stable.
- **Issues found:** Current branch lacks robust auto-attack scan throttling and lacks MCV undeploy loop; engineer only captures (no explicit repair orders), and no damaged-bridge repair loop exists yet.

### [Step 2] Implemented core control/logistics behaviors across unit, scene, map, HUD, and AI layers
- **Files changed:**
  - `src/entities/Unit.ts`
  - `src/entities/EntityManager.ts`
  - `src/scenes/GameScene.ts`
  - `src/engine/GameMap.ts`
  - `src/scenes/HUDScene.ts`
  - `src/combat/AI.ts`
- **What:**
  - Added robust auto-attack-nearby scan throttling and intent-preserving fire-on-move in `Unit`.
  - Added engineer `repair` order flow for damaged friendly structures and damaged bridges (capture behavior preserved for neutral/enemy buildings).
  - Added harvester low-field behavior: miners now retarget toward richer nearby ore when local ore is below 5% threshold, with retarget cooldown.
  - Added damaged-bridge state in `GameMap` plus bridge damage/repair APIs; superweapons now can destroy bridge tiles in blast radius.
  - Added MCV mobility loop in `GameScene`: deploy MCV -> construction yard and pack construction yard -> MCV, with silent despawn handling and selection transition.
  - Added HUD bottom selected-type shortcut bar in `HUDScene`; clicking a type selects all same-type player units map-wide via new scene event.
  - Added AI fallback so idle engineers repair damaged friendly structures when no capture target exists.
- **Why:** Deliver the complete control+logistics package with cohesive command UX and autonomous economic/combat upkeep.
- **Decisions:**
  - Kept integrations event-driven (Unit -> EntityManager -> GameScene) to avoid tight coupling.
  - Implemented bridge damage as terrain state mutation (bridge -> water) so pathing and visuals naturally reflect destruction.
  - Used map-wide type-select trigger from HUD chips to match requested Red Alert-style control behavior.
- **Issues found:** MCV transform requires suppressing normal destroy-side combat/UI effects; handled with `silentDespawnIds` tracking in `GameScene` destroy listeners.

### [Step 3] Validated build and generated UI screenshot artifact
- **Files changed:** `docs/screenshots/ic-controls-mcv-autoattack-engineers.png`
- **What:**
  - Ran `npm run build` (`tsc --noEmit` + Vite production build) successfully after feature integration.
  - Started local dev server and captured screenshot artifact via Playwright to include in PR description.
- **Why:** Ensure compile/runtime integrity and provide visual evidence for UI-impacting controls updates.
- **Decisions:** Used a deterministic local URL (`http://127.0.0.1:4173`) and stored screenshot under `docs/screenshots/` for reviewer access.
- **Issues found:** Initial detached dev-server attempt failed to keep process alive for capture; reran in active session and captured successfully.

### [Step 4] Completed SCM handoff (commit, push, PR)
- **Files changed:** none (SCM operations only)
- **What:**
  - Committed implementation as `36d80f7` with message: `Implement control and logistics package for units, MCV, miners, engineers`.
  - Pushed branch `feat/ic-controls-mcv-autoattack-engineers` to `origin`.
  - Opened PR: `https://github.com/linkbag/IronCommand/pull/37`.
  - Updated PR description to include summary, validation, and screenshot link.
- **Why:** Complete delivery pipeline for reviewer/integrator stages.
- **Decisions:** Used `gh api repos/linkbag/IronCommand/pulls/37 --method PATCH` to update PR body due `gh pr edit` GraphQL Projects(classic) deprecation error.
- **Issues found:** `gh pr edit` failed on deprecated Projects(classic) GraphQL field; resolved with REST patch.

## Summary
- **Total files changed:** 7
- **Key changes:**
  - Added HUD bottom selected-type shortcut chips that select map-wide same-unit-type on click.
  - Added robust combat auto-attack-nearby behavior with throttled scan budgets and manual-attack intent preservation.
  - Implemented full MCV mobility loop (deploy to construction yard + pack construction yard back to MCV) with silent despawn handling.
  - Implemented harvester retarget logic for low ore fields (<5%) to seek richer nearby mines.
  - Added engineer repair order support for damaged friendly structures and damaged bridges while preserving neutral/enemy capture.
  - Added bridge damage/repair terrain state (`GameMap`) and superweapon bridge-destruction integration.
  - Added AI engineer fallback behavior to repair damaged allied structures when no capture target exists.
- **Build status:** pass (`npm run build`)
- **Known issues:**
  - Screenshot artifact is captured from local runtime entry state; reviewers may still want interactive verification of in-match shortcut chips and engineer bridge-repair behavior.
  - `gh pr edit` remains unreliable in this environment due deprecated Projects(classic) GraphQL dependency; use `gh api` patch workflow.
- **Integration notes:**
  - Branch: `feat/ic-controls-mcv-autoattack-engineers`
  - Commit: `36d80f7`
  - PR: `https://github.com/linkbag/IronCommand/pull/37`
  - UI screenshot file: `docs/screenshots/ic-controls-mcv-autoattack-engineers.png`

### Review+Fix Round 1
- **Reviewer:** codex-ic-controls-mcv-autoattack-engineers-review-1
- **Timestamp:** 2026-03-08 10:34:21
- **Files reviewed:** src/combat/AI.ts, src/engine/GameMap.ts, src/entities/EntityManager.ts, src/entities/Unit.ts, src/scenes/GameScene.ts, src/scenes/HUDScene.ts
- **Issues found:** None — all logic is sound. Key verifications: (1) `repair` OrderType pre-exists in types/index.ts. (2) silentDespawnIds correctly suppresses EVA/kill alerts for MCV deploy and CY undeploy. (3) building_placed handler already tracks new entities so deployMCV/undeployConstructionYard don't need manual entity list updates. (4) building_destroyed handler skips syncSelectionState call since selectedIds.delete() already ran before removeEntity. (5) findNearestOpenTile correctly checks radius=0 center tile. (6) AI engineer repair correctly falls back to repairing allied buildings when no capture target found. (7) consumeAutoAcquireScanBudget uses shared timer safely (unit can only be in one state). (8) preferUnits fallback in findNearbyEnemy correctly falls back to buildings when no units in range. (9) TypeScript check: zero errors.
- **Fixes applied:** None needed
- **Build status:** `npx tsc --noEmit` exits 0, no errors
- **Remaining concerns:** Minor: undeployConstructionYard briefly clears occupiedBy on building tiles before finding a spawn tile, creating a small window where pathfinding could use those tiles. Acceptable for single-threaded JS. Also: multiple engineers targeting the same damaged building is benign (second engineer gets cb(true) immediately on next repair tick when HP is full).
