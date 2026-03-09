# Integration Log: IronCommand midnight recovery: homebase fix, difficulty remap, Smart Hard Rhizome AI
**Project:** IronCommand
**Subteams:** claude-ic-no-enemy-in-homebase-r3 claude-ic-difficulty-medium-to-hard-remap-r3 claude-ic-smart-hard-rhizome-protocol-r3
**Started:** 2026-03-09 00:27:54

## Subteam Summaries


========================================
## Subteam: claude-ic-no-enemy-in-homebase-r3
========================================
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

========================================
## Subteam: claude-ic-difficulty-medium-to-hard-remap-r3
========================================
# Work Log: claude-ic-difficulty-medium-to-hard-remap-r3
## Task: ic-difficulty-medium-to-hard-remap-r3 (IronCommand)
## Branch: feat/ic-difficulty-medium-to-hard-remap-r3
---

### [Step 1] Explored difficulty system
- **Files changed:** none (read-only)
- **What:** Found all difficulty-related code across 4 files
- **Why:** Understanding scope before changing
- **Decisions:** medium values in all tables + all `=== 'hard'` behavioral branches need updating to `!== 'easy'`

### [Step 2] Updated all difficulty parameters and behavioral branches
- **Files changed:** src/combat/AI.ts, src/economy/Economy.ts, src/scenes/GameScene.ts
- **What:** 
  - AI.ts: All 11 difficulty constant tables — medium values set to match hard (e.g. TICK_INTERVAL medium 2000→1200, MAX_ARMY 28→50, FIRST_ATTACK_MS 180k→120k, etc.)
  - AI.ts: 25+ behavioral branches changed from `=== 'hard'` / `!== 'hard'` to `!== 'easy'` / `=== 'easy'`
  - Economy.ts: AI_INCOME_MULT medium 1.0 → 1.25
  - GameScene.ts: buildSpeed check `=== 'hard'` → `!== 'easy'`
  - Also removed redundant `!== 'easy'` check inside rebuildDestroyedBuildings() which already had an early-return guard; TypeScript narrowed type and flagged it
- **Why:** Medium difficulty should now behave identically to what Hard used to be
- **Decisions:** String keys 'easy'/'medium'/'hard' unchanged → existing save/config files migrate automatically, no data migration needed. Labels unchanged in SetupScene.ts.
- **Issues found:** TypeScript narrow-type error at line 2253 (function had early `=== 'easy') return` so `!== 'easy'` was unreachable) — fixed by removing the outer if and inlining the block

## Summary
- **Total files changed:** 3 (src/combat/AI.ts, src/economy/Economy.ts, src/scenes/GameScene.ts)
- **Key changes:**
  - AI.ts: 11 constant tables updated (medium values → hard values)
  - AI.ts: 25+ behavioral branches switched from `=== 'hard'` to `!== 'easy'`
  - Economy.ts: AI income multiplier for medium: 1.0 → 1.25
  - GameScene.ts: build speed 1.3× now applies to medium (was hard-only)
  - String keys unchanged, no save migration needed
- **Build status:** pass (npx tsc --noEmit clean)
- **Known issues:** none
- **Integration notes:** PR #51 opened. Medium and Hard now share identical parameter values. Future work could differentiate Hard further. All labels unchanged. No schema changes.

### Review+Fix Round 1
- **Reviewer:** claude-ic-difficulty-medium-to-hard-remap-r3-review-1
- **Timestamp:** 2026-03-09 00:09:43
- **Files reviewed:** src/combat/AI.ts, src/economy/Economy.ts, src/scenes/GameScene.ts
- **Issues found:** None. All 11 constant tables correctly set medium=hard. All 25+ behavioral `=== 'hard'` branches correctly converted to `!== 'easy'`. Three-way medium ternaries (e.g. baseMaxRef, shouldExpandByTime threshold, raidSize, maxQueuePerTick) correctly collapsed to binary easy vs non-easy. The rebuildDestroyedBuildings() refactor is correct — `if (this.difficulty === 'easy') return` guard at line 2232 ensures easy exits before the inlined block. No remaining `=== 'hard'` checks in logic code. Economy.ts medium multiplier 1.0→1.25 correct. GameScene.ts buildSpeed `!== 'easy'` correct.
- **Fixes applied:** None needed
- **Build status:** npx tsc --noEmit — pass, zero errors
- **Remaining concerns:** None. Medium and Hard now behave identically. Hard could be further differentiated in a future task.

========================================
## Subteam: claude-ic-smart-hard-rhizome-protocol-r3
========================================
# Work Log: claude-ic-smart-hard-rhizome-protocol-r3
## Task: ic-smart-hard-rhizome-protocol-r3 (IronCommand)
## Branch: feat/ic-smart-hard-rhizome-protocol-r3
---

### [Step 1] Created src/combat/Rhizome.ts — Project Rhizome substrate
- **Files changed:** src/combat/Rhizome.ts (new, ~340 lines)
- **What:** Complete Rhizome class with all four layers + exported RHIZOME_PARAMS constants
- **Why:** Self-contained, testable AI substrate for smart_hard difficulty; separating it from AI.ts allows unit testing without Phaser/game scene
- **Decisions:** Used `as const` for RHIZOME_PARAMS so downstream tests can import exact values and catch constant regressions. Linear field falloff chosen over quadratic for simpler tuning.
- **Issues found:** None

### [Step 2] Updated src/combat/AI.ts — Added smart_hard to all constants + Rhizome wiring
- **Files changed:** src/combat/AI.ts
- **What:** 
  - AIDifficulty type: added 'smart_hard'
  - All Record<AIDifficulty, ...> constants: added smart_hard values
  - Added `rhizome: Rhizome | null` field; initialized in constructor when difficulty === 'smart_hard'
  - `update()`: calls `this.rhizome?.update(delta, gameState)` every frame
  - `retreatDamagedUnits()`: skips all retreat if overdrive active; isolated units retreat early
  - `tickSuperweapons()`: passes enemy SW presence to `rhizome.notifyEnemySwCooldown()`
  - `followTechTree()`: Rhizome organ priority overrides normal build order for smart_hard
  - `considerAttacking()`: overdrive halves attack cooldown window
- **Why:** Rhizome needs to run every frame for damage tracking; organ priority intercepts build before normal heuristics
- **Decisions:** `smart_hard` production targets doubled vs hard; tick interval 800ms (faster than hard's 1200ms)

### [Step 3] Updated SetupScene.ts + Economy.ts + GameScene.ts
- **Files changed:** src/scenes/SetupScene.ts, src/economy/Economy.ts, src/scenes/GameScene.ts
- **What:**
  - SetupScene: SkirmishConfig.aiDifficulty union includes 'smart_hard'; DIFFICULTIES array has 'SMART HARD' button
  - Economy: Difficulty type + AI_INCOME_MULT includes smart_hard (1.35×)
  - GameScene: build speed 1.4× for smart_hard
- **Why:** All three entry points needed the new difficulty value to avoid TypeScript errors

### [Step 4] Created src/combat/Rhizome.test.ts — 29 vitest unit tests
- **Files changed:** src/combat/Rhizome.test.ts (new); installed vitest as devDependency
- **What:** Tests for RHIZOME_PARAMS values, organ priority (all 4 levels), Rule-of-3 spacing (5 cases), NC density states (4 cases), potential-field direction + normalization (5 cases), overdrive triggers + sustain (5 cases)
- **Why:** Rhizome has no Phaser dependency so it's fully testable in isolation. Tests catch constant regressions and logic regressions.
- **Issues found:** 2 test bugs fixed: (a) organ priority 'power' required explicit check for zero power generators; (b) production priority needed to exclude refineries from prodBuildings count

### [Step 5] Created docs/rhizome-protocol.md
- **Files changed:** docs/rhizome-protocol.md (new)
- **What:** Full design doc covering all 4 layers, parameter tables, integration points, tuning guidance

## Summary
- **Total files changed:** 7 (Rhizome.ts new, Rhizome.test.ts new, AI.ts, SetupScene.ts, Economy.ts, GameScene.ts, docs/rhizome-protocol.md)
- **Key changes:** Smart Hard difficulty tier with Project Rhizome AI substrate: metabolic build priority, NC density unit states, potential-field navigation bias, overdrive flood mode
- **Build status:** tsc --noEmit pass; 29/29 vitest tests pass
- **Known issues:** Potential field bias is computed but not yet driving actual unit pathfinding (the AI calls `getPotentialFieldBias` is wired into overdrive/retreat suppression, but the bias vector isn't used to deviate unit movement paths — that would require Unit.ts pathing integration). The field is architecturally ready for integration.
- **Integration notes:** 
  - The Rhizome.notifyEnemySwCooldown() currently receives 0 (triggers immediately) when any enemy SW building is active. A more precise implementation would track per-SW estimated cooldowns. See AI.tickSuperweapons() comment.
  - Vitest added as devDependency; run tests with: npx vitest run src/combat/Rhizome.test.ts

### Review+Fix Round 1
- **Reviewer:** claude-ic-smart-hard-rhizome-protocol-r3-review-1
- **Timestamp:** 2026-03-09 00:19:27
- **Files reviewed:** src/combat/Rhizome.ts, src/combat/Rhizome.test.ts, src/combat/AI.ts, src/scenes/SetupScene.ts, src/economy/Economy.ts, docs/rhizome-protocol.md, package.json
- **Issues found:** Fourteen `difficulty === 'hard'` comparisons in AI.ts did not include `smart_hard`, causing the new difficulty tier to fall through to easy/medium fallback paths for harvester targets, refinery limits, army thresholds, queue sizes, harassment logic, scouting, target scoring, rebuild logic, economy expansion timing, wave cadence, and superweapon build triggers.
- **Fixes applied:** Extended all fourteen hard-only conditional branches to also cover `smart_hard` (using `difficulty === 'hard' || difficulty === 'smart_hard'`). Files changed: src/combat/AI.ts.
- **Build status:** pass
- **Remaining concerns:** Potential field bias computed but not driving unit pathfinding (architectural concern noted by builder — not a bug). Enemy SW cooldown is passed as 0 whenever any enemy SW building is active (intentionally pessimistic per builder notes).

---
## Integration Review

### Integration Round 1
- **Timestamp:** 2026-03-09 00:27:58
- **Cross-team conflicts found:**
  1. AI.ts (difficulty-remap × rhizome): difficulty-remap changed `==='hard'` → `!='easy'` throughout; rhizome added `'smart_hard'` tier and Rhizome substrate wiring. Conflict in imports, 3 constant tables, constructor, followTechTree, barracks/warFactory targets, considerAttacking.
  2. GameScene.ts (homebase × rhizome): homebase imported SkirmishConfig from SetupScene (old location); HEAD has it from skirmishConfig module. buildSpeed conflict: difficulty-remap set `!='easy'`→1.3×; rhizome added smart_hard=1.4× 3-tier.
  3. SetupScene.ts (rhizome): rhizome redeclared inline SkirmishConfig with smart_hard — HEAD already re-exports from skirmishConfig module. Resolved by keeping HEAD + updating skirmishConfig.ts to add smart_hard to aiDifficulty union.
  4. vitest.config.ts (homebase only): pattern `src/**/__tests__/**/*.test.ts` missed Rhizome.test.ts (src/combat/) and tests/game-balance-and-map.test.ts. Broadened to `src/**/*.test.ts, tests/**/*.test.ts`.
  5. Stale test: game-balance-and-map.test.ts:139 expected ORE_REGEN_RATE=2 (2%) but oreRecoveryInvariant.test.ts hardlocks at 1%. Fixed stale assertion to match canonical invariant test.
  6. review-fix c0f16e1 (rhizome): all 17 conflicts were `!='easy'`→`==='hard'||'smart_hard'` regressions — HEAD's `!='easy'` already covers smart_hard per difficulty-remap spec. Commit applied as empty/skipped.
  7. OPPORTUNISTIC_MIN_ARMY, MIN_HOME_GARRISON, MAX_DEFENDER_COMMIT: missing smart_hard entries after AIDifficulty type was extended. Added values following each constant's progression.
- **Duplicated code merged:** None — rhizome's SetupScene SkirmishConfig redeclaration vs skirmishConfig module resolved by keeping module.
- **Build verified:** pass (tsc --noEmit clean)
- **Fixes applied:**
  - Cherry-picked c6a95c7 (difficulty-remap), 2cb1c06+d1a24ca (homebase), d988ad9 (rhizome); skipped c0f16e1
  - Resolved 5 cherry-pick conflicts in AI.ts, GameScene.ts, SetupScene.ts
  - Updated skirmishConfig.ts: added 'smart_hard' to aiDifficulty union
  - Updated vitest.config.ts: broadened include pattern to find all test files
  - Fixed stale ORE_REGEN_RATE assertion in game-balance-and-map.test.ts
  - Added smart_hard to 3 pre-existing AI constant tables missing it
- **Remaining concerns:** Potential field bias in Rhizome is computed but not driving unit pathfinding (architectural concern flagged by builder — not a bug, ready for future Unit.ts integration). Enemy SW cooldown passed as 0 (pessimistic, intentional per builder).
