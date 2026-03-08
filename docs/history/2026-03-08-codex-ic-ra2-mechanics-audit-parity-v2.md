# RA2 Mechanics Parity Audit (v2)
Date: 2026-03-08
Branch: feat/ic-ra2-mechanics-audit-parity-v2

## Scope
- Aircraft rearm and return-to-airfield behavior
- Low-power production slowdown parity
- Superweapon countdown behavior under low power
- Control integrity check for command semantics

## Audit Findings
1. Aircraft parity gap
- Strike aircraft had infinite ammo and no return-to-airfield/rearm loop.
- No airfield query path existed in `EntityManager` for unit logic.

2. Low-power production mismatch
- `Economy` used `0.35` production speed under low power.
- `HUDScene` used `0.5` for build progress timing.
- Result: gameplay and UI progressed at different rates.

3. Superweapon low-power behavior mismatch
- Human superweapon timers continued while low power.
- AI superweapon timers also continued while low power.
- Human launch flow allowed target mode/fire attempts even during low power.

4. Controls parity check
- Verified command semantics remained:
  - Left click: direct command/select flow
  - Right click: unselect on empty ground

## Implemented Fixes
1. Aircraft RTB/Rearm
- Added finite-ammo + rearm profiles for `harrier` and `black_eagle` in `Unit`.
- On ammo depletion, aircraft now auto-return to nearest `air_force_command`.
- Added dock-range detection and timed rearm before returning to idle combat availability.
- Added `EntityManager.getNearestAirfield()` and `find_airfield` event bridge.

2. Low-power production alignment
- Added shared constant `LOW_POWER_PRODUCTION_MULT = 0.5`.
- Updated `Economy.getProductionSpeedMultiplier()` to use shared constant.
- Updated HUD production multiplier path to use same shared logic.

3. Superweapon low-power parity
- Human countdown timers now pause during low power (resume when power restored).
- AI countdown timers now pause during low power.
- Human superweapon activation/launch is blocked during low power with explicit HUD alerts.

## Behavioral Notes
- Superweapon timers are paused, not reset, during low power.
- Strike-aircraft rearm behavior is intentionally scoped to `harrier`/`black_eagle`; transport/scout/heavy aircraft behavior remains unchanged.

## Validation
- `npm run build` passed (`tsc --noEmit && vite build`).
- No control-path changes were introduced in `GameScene` left/right-click handlers.

## Residual Risks
- No automated gameplay tests exist in repository; parity verification is compile + code audit based.
- Aircraft RTB uses nearest-airfield lookup and does not enforce per-pad slot contention.
