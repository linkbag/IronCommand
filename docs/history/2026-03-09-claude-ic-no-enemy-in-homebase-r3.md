# Work Log: claude-ic-no-enemy-in-homebase-r3
## Task: ic-no-enemy-in-homebase-r3 (IronCommand)
## Branch: feat/ic-no-enemy-in-homebase-r3
---

### [Step 1] Created src/engine/spawnValidation.ts
- **Files changed:** `src/engine/spawnValidation.ts` (new)
- **What:** Pure-function module for home-base protection and spawn-separation enforcement. Exports:
  - `HOME_BASE_RADIUS_TILES = 10` — tile radius around each spawn that is the "protected home base"
  - `ENEMY_SPAWN_MIN_SEPARATION = 20` — minimum Euclidean tile distance between enemy spawns
  - `isInHomeBase(col, row, spawnCol, spawnRow, radius?)` — Chebyshev check
  - `isInAnyEnemyBase(col, row, enemySpawns, radius?)` — checks against multiple enemy spawns
  - `relocateTileFromEnemyBases(col, row, ownSpawnCol, ownSpawnRow, enemySpawns, mapW, mapH, radius?)` — walks outward from own spawn to find nearest safe tile if the desired tile is inside an enemy base
  - `validateSpawnSeparation(spawns, isEnemy, minSep?)` — returns array of cross-team violation descriptors
  - `enforceEnemySpawnSeparation(playerIds, spawnPositions, assignedIndices, isEnemy, minSep?)` — tries to swap conflicting enemy spawn indices to farther unused spawns; never moves player 0
- **Why:** These are pure functions, making them unit-testable without Phaser or game state.

### [Step 2] Set up vitest + wrote 21 tests
- **Files changed:** `package.json`, `vitest.config.ts` (new), `src/engine/__tests__/spawnValidation.test.ts` (new)
- **What:** Installed vitest, added `npm test` script, created test file covering all exported functions
- **Decisions:** Used vitest (not jest) to align with the existing vite build toolchain

### [Step 3] Modified spawnStartingEntities() in GameScene.ts
- **Files changed:** `src/scenes/GameScene.ts`
- **What:**
  1. After `computeSpawnAssignment()`, runs `enforceEnemySpawnSeparation()` — if any enemy pair's spawns are < 20 tiles apart, tries to reassign to farther unused spawn. Player 0's spawn is never changed.
  2. Persists final assignments to `playerSpawnIndexById` BEFORE placement so all players' bases are known.
  3. Logs `validateSpawnSeparation()` warnings if any violations remain (map too small to fix).
  4. For each player, collects all ENEMY player spawn tiles as "enemy base zones".
  5. Wraps every building/unit tile choice in `safeTile(col, row)` which calls `relocateTileFromEnemyBases()` — if the desired placement is inside an enemy home-base zone it walks outward from the player's own spawn to find the nearest valid tile.
  6. Harvester world-coords now computed from safe tile (previously used spawnWorld directly which bypassed the check).
  7. Infantry world-coords similarly computed via safeTile.
- **Why:** Solves the root cause: fixed tile offsets could land inside another player's zone on small maps or with bad spawn assignments.

### [Step 4] Fixed spawnParatrooperDrop() fallback in GameScene.ts
- **Files changed:** `src/scenes/GameScene.ts`
- **What:** When no enemy buildings exist, the old code dropped paratroopers near the *calling player's own spawn* (a bug: human player's base could get bombarded by enemy paratroops on game open). New code targets a random ENEMY player's start-zone spawn position instead. Last-resort fallback is map centre.
- **Why:** Prevents early-game paratroopers from spawning inside an allied/human home base.

## Summary
- **Total files changed:** 5 (`src/engine/spawnValidation.ts`, `src/engine/__tests__/spawnValidation.test.ts`, `src/scenes/GameScene.ts`, `package.json`, `vitest.config.ts`)
- **Key changes:**
  - New `spawnValidation.ts` module with pure, unit-tested spawn-protection functions
  - `spawnStartingEntities()`: enforces enemy spawn separation, validates cross-team distance, protects all building/unit placements via home-base zone checks
  - `spawnParatrooperDrop()`: fallback now targets enemy start zone, not own base
  - 21 passing vitest tests
- **Build status:** tsc --noEmit passes, npm test 21/21 pass
- **Known issues:** If the map is genuinely too small (< 40 tiles in any dimension) the algorithm logs a warning but cannot guarantee full separation — this is unavoidable without regenerating the map
- **Integration notes:** `HOME_BASE_RADIUS_TILES=10` and `ENEMY_SPAWN_MIN_SEPARATION=20` are exported constants in `spawnValidation.ts`; reviewers can tune these. The `enforceEnemySpawnSeparation` function never moves player 0's spawn, preserving the SetupScene "playerSpawn" preference.

### Review+Fix Round 1
- **Reviewer:** claude-ic-no-enemy-in-homebase-r3-review-1
- **Timestamp:** 2026-03-09 00:14:56
- **Files reviewed:** src/engine/spawnValidation.ts, src/engine/__tests__/spawnValidation.test.ts, src/scenes/GameScene.ts, package.json, vitest.config.ts
- **Issues found:** Dead ternary on line 154 of spawnValidation.ts: `const targetIdx = i === 0 ? j : j` — both branches evaluate to `j`, making the conditional dead code. The comment "prefer moving the later player" was misleading; since the outer loop guarantees j > i >= 0, targetIdx is always j (index 0 is never j, so the human player's spawn is never moved regardless). No functional bug, but confusing.
- **Fixes applied:** Simplified `const targetIdx = i === 0 ? j : j` → `const targetIdx = j` with a corrected comment explaining why index 0 is never moved.
- **Build status:** npx tsc --noEmit → pass; npm test → 21/21 pass
- **Remaining concerns:** None. Logic is sound: Chebyshev home-base zones, Euclidean spawn separation, multi-pass swap enforcement, safeTile relocation in spawnStartingEntities, and paratrooper fallback all look correct. Map-too-small case is acknowledged with a console.warn (unavoidable without map regen).
