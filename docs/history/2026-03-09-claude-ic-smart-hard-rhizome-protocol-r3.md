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
