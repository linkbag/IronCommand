# Work Log: codex-ic-combat-ux-cursor-trajectory-warnings
## Task: ic-combat-ux-cursor-trajectory-warnings (IronCommand)
## Branch: feat/ic-combat-ux-cursor-trajectory-warnings
---

### [Step 1] Audited existing UX/combat paths and identified source commits
- **Files changed:** none
- **What:** Mapped current implementations in `src/scenes/GameScene.ts`, `src/scenes/HUDScene.ts`, `src/combat/Combat.ts`, `src/entities/Unit.ts`, and `src/entities/EntityManager.ts`; confirmed where cursor modes, minimap markers, trajectory/rally overlay, and damage-alert events are handled.
- **Why:** Needed concrete integration points for all requested UX items and to avoid redundant reimplementation.
- **Decisions:** Found existing feature branches with matching scope; chose to cherry-pick known-good commits (`e4213e0`, `da5f188`, `20b7940`) and then validate/fix integration.
- **Issues found:** Baseline branch lacks `unit_damaged` propagation and minimap warning ping rendering; enemy-hover cursor and reactive move marker logic also absent.

### [Step 2] Integrated prior feature commits and resolved cherry-pick conflict
- **Files changed:** src/scenes/GameScene.ts (conflict resolution), plus commit-applied changes in src/scenes/HUDScene.ts, src/combat/Combat.ts, src/entities/Unit.ts, src/entities/EntityManager.ts, docs/screenshots/ic-ui-enemy-cursor-minimap.png, docs/screenshots/ic-move-feedback-trajectories.png
- **What:** Cherry-picked `e4213e0` (enemy-hover cursor + minimap ally/enemy color policy), `da5f188` (reactive move marker + trajectory feedback), and `20b7940` (combat animation readability + minimap attack pings from own-unit/building damage). Resolved one conflict in `GameScene.ts` by preserving both cursor-hover constants and move-feedback constants/types.
- **Why:** These commits directly map to the requested UX scope and are already validated in sibling branches.
- **Decisions:** Kept all UX systems additive rather than replacing existing order/selection flow; retained screenshot artifacts already bundled with the feature commits.
- **Issues found:** One cherry-pick conflict in top-level constant/type declarations of `GameScene.ts`; no semantic conflicts after merge.

### [Step 3] Enforced selection-bound trajectory rendering and validated build
- **Files changed:** src/scenes/GameScene.ts
- **What:** Updated `MoveTrajectoryLine` to track `unitId`+`target` (instead of static from/to points). `drawMoveTrajectoryOverlay()` now renders a line only if the referenced unit still exists, is alive, and is currently selected; line origin is the unit’s live position each frame.
- **Why:** Matches requirement: trajectory lines should be from selected units to target and visible only while those units remain selected.
- **Decisions:** Kept existing short lifetime fade behavior (`MOVE_TRAJECTORY_DURATION_MS`) for readability but gated it by current selection state.
- **Issues found:** None; `npm run build` passed (`tsc --noEmit` + Vite build).

## Summary
- **Total files changed:** 7
- **Key changes:**
  - Added enemy-hover combat cursor in `src/scenes/GameScene.ts` (`updateHoverCursor`, `setEnemyHoverCursor`, `isHoveringEnemyEntity`) to switch pointer red when hovering enemy units/buildings.
  - Forced minimap relationship colors in `src/scenes/HUDScene.ts` via `MINIMAP_ALLY_COLOR`/`MINIMAP_ENEMY_COLOR` and `entityMgr.isEnemy(...)` checks (ally=green, enemy=red regardless faction tint).
  - Added reactive move-order destination marker + trajectory overlay in `src/scenes/GameScene.ts` (`triggerMoveFeedback`, `showMoveOrderMarker`, `drawMoveTrajectoryOverlay`) and wired for both world click move orders and HUD-issued move orders.
  - Enforced trajectory visibility to selected units only by tracking `unitId` in `MoveTrajectoryLine` and rendering only when that unit remains selected.
  - Improved attack readability in `src/combat/Combat.ts` and `src/entities/Unit.ts` (enhanced muzzle flash, projectile trail continuity, impact flashes, stronger local weapon FX).
  - Added own-unit and own-building under-attack minimap warnings by emitting/forwarding `unit_damaged` (`src/entities/Unit.ts`, `src/entities/EntityManager.ts`) and rendering HUD minimap warning circles (`src/scenes/HUDScene.ts` via `minimapAttackPing`).
  - Added UI screenshot artifacts: `docs/screenshots/ic-ui-enemy-cursor-minimap.png`, `docs/screenshots/ic-move-feedback-trajectories.png`.
- **Build status:** pass (`npm run build`)
- **Known issues:** None blocking; Vite reports existing large bundle warning (>500kB chunk), unrelated to this change set.
- **Integration notes:**
  - New HUD event consumed: `minimapAttackPing` with payload `{ x, y }` in world/cartesian coordinates.
  - Attack ping anti-spam controls are in `GameScene.emitMinimapAttackPing()` (global + spatial-bucket cooldown); tune there if QA wants denser/sparser warning circles.
  - PR created: https://github.com/linkbag/IronCommand/pull/33

### Review+Fix Round 1
- **Reviewer:** codex-ic-combat-ux-cursor-trajectory-warnings-review-1
- **Timestamp:** 2026-03-08 10:34:12
- **Files reviewed:** src/scenes/GameScene.ts, src/scenes/HUDScene.ts, src/combat/Combat.ts, src/entities/Unit.ts, src/entities/EntityManager.ts
- **Issues found:** None requiring fixes. Detailed analysis below:
  1. No compilation errors — `npx tsc --noEmit` passes with zero output.
  2. Trajectory lines gated by `selectedIds.has(line.unitId)` in `drawMoveTrajectoryOverlay` — correct; lines only render for currently selected units and disappear when deselected.
  3. Minimap attack ping anti-spam: two-level cooldown (global 300ms + per-bucket 1400ms) with stale-bucket cleanup using Map.delete inside for-of (safe per ECMAScript spec). Bucket size is 3 tiles (96px). Logic is sound.
  4. `isHoveringEnemyEntity` iterates entity lists but does no heap allocation per entity (only `Phaser.Math.Distance.Between` returning a number). The only allocation is the `{x,y}` return from `ptrToCart` once per frame — minor, consistent with existing codebase patterns. State-change guard in `setEnemyHoverCursor` prevents DOM style writes unless cursor status changes.
  5. `prevX`/`prevY` on projectiles: initialized to `fromX/fromY` at spawn; updated after draw each frame. First frame renders a zero-length trail (guarded by `dist > 1` check in `drawProjectileGraphic`), subsequent frames get correct trailing direction.
  6. `createImpactFlash` — new function added alongside muzzle flash, called on both hitscan hit and projectile hit. Hitscan now calls impact flash at `intensity 0.8` (miss) / `1.0` (hit). Projectile onHit calls at `0.9` (miss) / `1.0` (hit). The original `createMuzzleFlash` was moved before the projectileSpeed branch so both hitscan and projectile fire show a muzzle flash — correct.
  7. `unit_damaged` event wired: Unit.takeDamage emits → EntityManager re-emits → GameScene handles. No double-fire path.
  8. Building hover check uses top-left origin + footprint extent, consistent with `getOwnBuildingAt` in the same file.
  9. `moveTrajectoryOverlay` with `setScrollFactor(0)` then manual `cartToScreen - camX/camY` offset — same pattern as `rallyOverlay`, correct.
  10. `HUD_SIDEBAR_W = 220` matches `SIDEBAR_W = 220` in HUDScene — no off-by-one in hover cursor exclusion zone.
  11. No dead code, no leftover debug artifacts in new code sections.
  12. No TODO comments introduced.
- **Fixes applied:** None needed
- **Build status:** pass (tsc --noEmit clean)
- **Remaining concerns:** None
