# Work Log: codex-ic-combat-anim-minimap-alert
## Task: ic-combat-anim-minimap-alert (IronCommand)
## Branch: feat/ic-combat-anim-minimap-alert
---

### [Step 1] Baseline analysis and target path mapping
- **Files changed:** none
- **What:** Inspected combat flow (`src/combat/Combat.ts`), unit/building damage events (`src/entities/Unit.ts`, `src/entities/Building.ts`, `src/entities/EntityManager.ts`), and representative minimap rendering (`src/scenes/HUDScene.ts`).
- **Why:** Needed exact insertion points for attack-readability VFX and minimap warning pings without heavy per-frame logic.
- **Decisions:** Chose to propagate attack alerts through real damage events (unit damaged) and HUD minimap event-driven pings with cooldown/debounce in `GameScene`.
- **Issues found:** Player-unit damage had no event propagation path; only building damage had alert wiring.

### [Step 2] Implemented unit attack event pipeline and minimap alert wiring
- **Files changed:** src/entities/Unit.ts, src/entities/EntityManager.ts, src/scenes/GameScene.ts, src/scenes/HUDScene.ts
- **What:** Added `unit_damaged` emission in `Unit.takeDamage`, forwarded it through `EntityManager`, and handled it in `GameScene` with centralized `handleLocalPlayerUnderAttack()` + `emitMinimapAttackPing()` (global cooldown + spatial bucket debounce). Added HUD event `minimapAttackPing` and rendered brief fading pulse rings on minimap (`tickMinimap` + `addMinimapAttackPing`).
- **Why:** Needed reliable, low-overhead detection for player units being attacked and visible minimap feedback at attack coordinates without alert spam.
- **Decisions:** Debounce is split: global (limits rapid-fire spam) + spatial bucket cooldown (prevents same-location flood). HUD also merges near-simultaneous pings and caps stored pings.
- **Issues found:** Existing code only alerted on `building_damaged`; no unit-damage signal path existed.

### [Step 3] Tuned combat readability VFX and validated build
- **Files changed:** src/combat/Combat.ts, src/entities/Unit.ts
- **What:** Improved muzzle flashes (type-sized flash core + ring + rays), made projectile tracers layered and motion-aligned (using per-projectile previous position), and added fast impact flashes at hit locations for both hitscan/projectile attacks. Also enhanced unit-local weapon FX tracer styling.
- **Why:** Increase attack readability/impact in dense fights (clear origin, travel line, and impact) while keeping effect lifetime short and graphics count low.
- **Decisions:** Kept effects as lightweight `Graphics` objects with very short tweens; no particle emitters added. Reused existing damage-type mapping for visual consistency.
- **Issues found:** None blocking; full `npm run build` passes (`tsc --noEmit` + Vite build).

### [Step 4] Finalized git artifacts (commit/push/PR) with UI screenshot
- **Files changed:** docs/screenshots/ic-combat-anim-minimap-alert.png
- **What:** Committed feature changes, pushed branch `feat/ic-combat-anim-minimap-alert`, created PR #25, and added screenshot asset referenced in PR body.
- **Why:** User requested full handoff pipeline including push + PR and screenshot for UI change.
- **Decisions:** Stored screenshot in-repo under `docs/screenshots/` so markdown rendering in PR body is stable.
- **Issues found:** `gh pr edit` failed due GraphQL projectCards deprecation query path; updated PR body via REST API (`gh api .../pulls/25 -X PATCH`) instead.

## Summary
- **Total files changed:** 6
- **Key changes:**
  - Added `unit_damaged` event emission in `src/entities/Unit.ts::takeDamage` and forwarded it via `src/entities/EntityManager.ts::wireUnit`.
  - Added centralized local-player under-attack handling in `src/scenes/GameScene.ts` with minimap ping cooldown/debounce (`handleLocalPlayerUnderAttack`, `emitMinimapAttackPing`).
  - Added minimap warning pulse rendering in `src/scenes/HUDScene.ts` (`minimapAttackPings`, `addMinimapAttackPing`, `tickMinimap` rendering pass).
  - Improved combat readability in `src/combat/Combat.ts` (motion-aligned tracers, stronger muzzle flashes, impact flashes) and `src/entities/Unit.ts::playWeaponEffect`.
  - Added screenshot asset: `docs/screenshots/ic-combat-anim-minimap-alert.png` and referenced it in PR #25.
- **Build status:** pass (`npm run build`)
- **Known issues:** `gh pr edit` command path fails in this environment due deprecated GraphQL projectCards query; PR body was updated successfully through `gh api` REST patch.
- **Integration notes:**
  - New HUD event consumed: `minimapAttackPing` with payload `{ x, y }` world coordinates.
  - Attack alert anti-spam is intentionally conservative (300ms global + 1400ms per spatial bucket of `TILE_SIZE*3`), adjust in `GameScene.emitMinimapAttackPing` if QA wants more/less sensitivity.

### Review+Fix Round 1
- **Reviewer:** codex-ic-combat-anim-minimap-alert-review-1
- **Timestamp:** 2026-03-08 04:03:42
- **Files reviewed:** src/entities/Unit.ts, src/entities/EntityManager.ts, src/scenes/GameScene.ts, src/scenes/HUDScene.ts, src/combat/Combat.ts
- **Issues found:** None
- **Fixes applied:** None needed
- **Build status:** pass (`npx tsc --noEmit` + `npm run build` both clean)
- **Remaining concerns:**
  - `minimapAttackPingBucketMs` map is cleaned up per-emit (stale entries pruned on each call to `emitMinimapAttackPing`). This is fine in typical play but in edge cases with many simultaneous pings could accumulate briefly — acceptable given cap logic.
  - Muzzle flash now fires for both hitscan and projectile attacks (intentional change, verified correct).
  - `building_damaged` guard was correctly updated from hardcoded `playerId !== 0` to `playerId !== localPlayerId` — this is a genuine correctness fix bundled into the feature.
  - All `Graphics` objects in VFX tweens call `destroy()` in `onComplete` — no leaks.
  - All `mapW/mapH/ox/oy/g` variables are in scope for minimap ping rendering (defined at top of `tickMinimap()`).
