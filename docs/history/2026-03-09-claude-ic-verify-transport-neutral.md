# Work Log: claude-ic-verify-transport-neutral
## Task: ic-verify-transport-neutral (IronCommand)
## Branch: feat/ic-verify-transport-neutral
---

### [Step 1] Explored transport system
- **Files read:** src/entities/Unit.ts, src/entities/EntityManager.ts, src/entities/UnitDefs.ts, src/types/index.ts, src/combat/AI.ts
- **What:** Traced load/unload order flow from unit.giveOrder → Unit.processNextOrder → EntityManager event listeners
- **What found:** 
  - Transport definitions (amphibious_transport, nighthawk) are complete with capacity/category/range
  - EntityManager has loadUnitIntoTransport and unloadTransportAt methods
  - AI transport hooks exist with TRANSPORT_HOOK_INTERVAL_MS=4000ms timing
  - BUG: In `case 'load'` of processNextOrder, when unit is already close to transport, `request_load_unit` fires but `processNextOrder()` is never called → order stays stuck, unit idles permanently
  - BUG: Proximity threshold in Unit.ts was `TILE_SIZE * 2` (64px) but `loadUnitIntoTransport` checks `loadRangeTiles * TILE_SIZE` (1.85 * 32 = 59.2px) — inconsistency could cause silent failures

### [Step 2] Explored neutral building system
- **Files read:** src/entities/BuildingDefs.ts, src/combat/Combat.ts, src/scenes/GameScene.ts, src/engine/GameMap.ts
- **What:** Verified neutral building definitions, engineer capture/repair logic, and neutral effect update loop
- **What found:**
  - neutral_hospital, neutral_repair_depot, neutral_bridge all defined with correct stats
  - GameScene.updateNeutralEffects correctly heals infantry (hospital +5 HP) and vehicles (repair depot +10 HP) every 2s — only fires after player captures the building (playerId >= 0)
  - BUG in Combat.ts: Engineer attacking a DAMAGED neutral hospital/repair_depot triggered the repair path instead of capture. The original code repaired ANY damaged neutral structure, but only bridges should be repaired. Tech buildings (hospital, depot) should be capturable at any health.
  - Bridge repair via repairBridgeAt/repairDamagedBridgeNear is wired up in GameScene

### [Step 3] Fixed transport load order bug
- **Files changed:** src/entities/Unit.ts
- **What:** In `case 'load'` processNextOrder handler, added missing `this.processNextOrder()` call after close-range `request_load_unit` emission. Also changed proximity threshold from `TILE_SIZE * 2` (64px) to `TILE_SIZE * 1.5` (48px) — comfortably inside the transport's loadRangeTiles = 1.85 * 32 = 59.2px — to avoid silent load failures.
- **Why:** Without processNextOrder(), the unit would sit with a dangling `currentOrder = load` forever after successfully (or unsuccessfully) trying to board.
- **Decisions:** Used `TILE_SIZE * 1.5` as the "close enough" threshold (vs. original TILE_SIZE * 2) since 1.5 < 1.85 tiles means the unit will always be within the transport's actual load range. Added `else { this.processNextOrder() }` for the no-targetEntityId case to be safe.

### [Step 4] Fixed engineer vs damaged neutral building bug
- **Files changed:** src/combat/Combat.ts
- **What:** Restructured the engineer-vs-neutral-building if/else ladder so that ONLY bridges are repaired/blocked. Non-bridge neutral buildings (hospital, repair depot) now fall through to the capture path regardless of their HP.
- **Why:** Original code: `if (isNeutralTarget && target.hp < maxHp) { repair; return }` — this would repair ANY damaged neutral building including hospitals. Now: `if (isNeutralTarget && isBridgeStructure) { repair or no-op; return }` — only bridges are handled here; hospitals/depots always get captured.
- **Decisions:** A damaged hospital is more valuable captured (gives healing buff to capturing player) than repaired as a neutral building. Bridges are infrastructure and should be repairable.

### [Step 5] Added 34 unit tests
- **Files changed:** tests/transport-and-neutral.test.ts (new file)
- **What:** Created comprehensive test suite covering:
  - Transport load gating: same-player check, category check, capacity check, distance check, dying-state check, self-load check, multi-load up to capacity
  - Transport unload: all-passengers unloaded, distinct tile placement, no-cargo case, non-transport unit case, dying passenger skip
  - findNearestOpenDropTile: origin tile returned, skips used tiles, radius-0 exhaustion, multi-passenger separate tiles
  - Engineer vs neutral building: bridge repair, intact bridge no-action, hospital capture (full HP), hospital capture (damaged HP — key regression test), depot capture, enemy building capture, own building no-op
  - Neutral effects: hospital heals infantry in range, skips uncaptured neutrals, skips enemies, skips vehicles, skips out-of-range; depot heals vehicles, skips infantry; heal caps at maxHp
- **Why:** No tests existed for any of these mechanics; tests catch both the bugs we fixed and document correct behavior.
- **Build status:** tsc ✓ clean, vitest 96/96 pass (62 pre-existing + 34 new)

## Summary
- **Total files changed:** 3 (src/entities/Unit.ts, src/combat/Combat.ts, tests/transport-and-neutral.test.ts)
- **Key changes:**
  - `Unit.ts case 'load'`: Fixed stuck-order bug; added `processNextOrder()` after close-range load attempt; corrected proximity threshold from 64px to 48px (inside transport's 59.2px load range)
  - `Combat.ts resolveAttack engineer block`: Fixed damaged-neutral-building misrouting; non-bridge neutral buildings (hospital, depot) are now always captured, not repaired
  - New test file: 34 tests covering transport load/unload gating and neutral building interactions
- **Build status:** tsc ✓, vitest 96/96 ✓
- **Known issues:** None blocking. Transport AI hook interval (4000ms) is long but not broken — cosmetic concern only.
- **Integration notes:**
  - The `case 'load'` fix in Unit.ts changes runtime behavior: units issued a load order when already in range will now correctly clear the order from their queue after attempting to board. Previously they would stall indefinitely.
  - The Combat.ts fix changes engineer behavior: a player who sends an engineer at a damaged hospital will now CAPTURE it (sacrificing the engineer) instead of silently repairing it as neutral. This is a gameplay-significant change — downstream AI/player logic that relies on engineer repair of tech buildings must now explicitly check `isBridgeStructure`.
  - No schema/data changes; no migration needed.

### Review Round 1
- Verdict: Review passed — reviewer exited cleanly (auto-pass: clean exit, no issues indicated)
