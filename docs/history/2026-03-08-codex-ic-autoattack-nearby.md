# Work Log: codex-ic-autoattack-nearby
## Task: ic-autoattack-nearby (IronCommand)
## Branch: feat/ic-autoattack-nearby
---

### [Step 1] Survey existing combat/order architecture
- **Files changed:** none
- **What:** Scanned repository for unit update loops, order handling, stance logic, enemy lookup APIs, and combat dispatch points.
- **Why:** Determine lowest-risk insertion point for auto-acquire behavior with minimal runtime overhead.
- **Decisions:** Focused next on `src/entities/Unit.ts`, `src/entities/EntityManager.ts`, and `src/scenes/GameScene.ts` because search results show order/combat wiring there.
- **Issues found:** None yet.

### [Step 2] Trace unit order/engagement semantics
- **Files changed:** none
- **What:** Read `src/entities/Unit.ts`, `src/entities/EntityManager.ts`, and `src/scenes/GameScene.ts` sections handling unit states, auto-fire, attack orders, guard/stop commands, and enemy/team resolution.
- **Why:** Ensure auto-attack additions fit existing behavior (guard, attack-move, manual attack/move) and respect alliance/enemy logic already centralized in EntityManager.
- **Decisions:** Implement changes inside `Unit` using existing `find_enemy` callback path so team/alliance logic remains unchanged.
- **Issues found:** Current idle/moving auto-acquire checks run very frequently (per-frame in idle; near per-frame while moving when cooldown is ready), which can scale poorly.

### [Step 3] Implement auto-acquire + moving engagement improvements in Unit logic
- **Files changed:** src/entities/Unit.ts
- **What:** Added lightweight acquisition scan throttling (`autoAcquireScanCooldownMs` + interval constants) and applied it to idle auto-acquire, moving fire-on-the-move, and attack-move target checks. Refactored attack-move selection to a single nearby-enemy scan with unit-first priority (instead of two separate scans). Added `fireAtTarget()` helper.
- **Why:** Provide auto-attack engagement for idle/moving units while avoiding heavy per-frame enemy scans, and reduce duplicate work in attack-move acquisition.
- **Decisions:** Kept enemy/team/ally filtering delegated to existing `find_enemy` event path (EntityManager + `isEnemy`) to preserve current stance/team semantics. Chose short polling intervals (idle 220ms, moving 140ms, attack-move 110ms) for responsiveness without per-frame scans.
- **Issues found:** Existing moving-state branch can still execute within the same frame after state flips; added `this.state === 'moving'` guard before fire-on-move to avoid unintended extra calls.

### [Step 4] Preserve manual attack intent during moving auto-fire
- **Files changed:** src/entities/Unit.ts
- **What:** Updated moving auto-fire logic to prioritize explicit manual `attack` target tracking: if the unit is on an attack order with a valid target, it only fires that target when in range and does not retarget to arbitrary nearby enemies.
- **Why:** Prevent auto-acquisition from undermining user-issued manual attack commands while still allowing auto-engagement for idle/move stances.
- **Decisions:** Scoped preservation to explicit `attack` orders only; regular move/attack-move keeps nearest-valid auto-fire behavior.
- **Issues found:** None.

### [Step 5] Validate TypeScript correctness
- **Files changed:** none
- **What:** Ran `npx tsc --noEmit` (after discovering no `typecheck` npm script) and confirmed clean typecheck.
- **Why:** Task requires clean type safety.
- **Decisions:** Used direct `tsc` invocation because `package.json` only defines `dev`, `build`, and `preview` scripts.
- **Issues found:** `npm run typecheck` missing script (non-blocking); direct compiler check passed.

## Summary
- **Total files changed:** 1
- **Key changes:**
  - Added throttled auto-acquisition polling for units in `src/entities/Unit.ts` so idle/moving/attack-move engagement checks are interval-based (not per-frame).
  - Refactored attack-move target selection to a single nearby-enemy scan with unit-priority fallback to buildings.
  - Preserved manual attack orders during moving auto-fire by prioritizing explicit attack targets and preventing opportunistic retargeting while that target remains valid.
  - Added state guard to prevent moving auto-fire from executing after state flips out of `moving` in the same frame.
- **Build status:** pass (`npx tsc --noEmit`)
- **Known issues:** `npm run typecheck` script is not defined in `package.json`; direct TypeScript check used instead.
- **Integration notes:** Changes are scoped to `Unit` behavior and continue using existing `EntityManager` `find_enemy` + `isEnemy` team/alliance logic; no API or schema changes required for integrators.

### Review+Fix Round 1
- **Reviewer:** codex-ic-autoattack-nearby-review-1
- **Timestamp:** 2026-03-08 04:04:04
- **Files reviewed:** src/entities/Unit.ts
- **Issues found:**
  - **Moderate regression (fixed):** Attack-move units could never fire-while-moving. The shared `autoAcquireScanCooldownMs` budget is consumed by the attack-move scan inside `updateMovement()` (resetting to 110ms). The outer `case 'moving':` block then calls `consumeAutoAcquireScanBudget(MOVING_AUTO_ACQUIRE_SCAN_MS)` which returns false (110 > 0), so `tryFireWhileMoving()` is never reached for attack-move orders. This was a regression vs the pre-change code where `tryFireWhileMoving()` ran unconditionally for all moving states.
  - Minor pre-existing issues in Unit.ts (not introduced by this PR): console.log in constructor, duplicate canAttackTarget blocks, etc. — out of scope for this feature review.
- **Fixes applied:**
  1. In `updateMovement()`, changed attack-move block to: if `updateAttackMove()` returns false (no stop-and-fight target) AND weapon is ready, directly call `findNearbyEnemy()` + `fireAtTarget()` to preserve fire-on-move behavior.
  2. In `case 'moving':` outer block, added `this.currentOrder?.type !== 'attackMove'` guard so regular-move and attack-move scan budgets no longer conflict.
- **Build status:** `npx tsc --noEmit` — exit 0, clean
- **Remaining concerns:**
  - The single shared `autoAcquireScanCooldownMs` works correctly after the fix but is conceptually overloaded. If a third scan type is added in future, separate per-context cooldown fields would be cleaner.
  - Idle/moving scan intervals (220/140/110ms) are hardcoded; no gameplay tuning exposure. Low priority.
