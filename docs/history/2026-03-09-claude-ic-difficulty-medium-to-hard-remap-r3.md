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
