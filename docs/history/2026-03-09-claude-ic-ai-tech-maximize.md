# Work Log: claude-ic-ai-tech-maximize
## Task: ic-ai-tech-maximize (IronCommand)
## Branch: feat/ic-ai-tech-maximize
---

### [Step 1] Rhizome.ts — 'tech' organ priority
- **Files changed:** src/combat/Rhizome.ts
- **What:** Added 'tech' to ORGAN_PRIORITY array (index 3, before 'expansion'). Added TECH_CREDIT_MIN=1200 param. Updated getOrganPriority() to return 'tech' when production targets are met but no tech-category buildings exist and credits >= TECH_CREDIT_MIN.
- **Why:** Rhizome (smart_hard) now automatically prioritizes tech advancement after production is established, rather than jumping straight to expansion.
- **Decisions:** Used b.def.category === 'tech' to detect tech buildings generically (works for both air_force_command and battle_lab). Credit gate prevents starving income on tech too early.

### [Step 2] AI.ts — Constants update
- **Files changed:** src/combat/AI.ts
- **What:** DEFENSE_TARGET increased (easy:2, medium:5, hard:6, smart_hard:8). New AA_DEFENSE_TARGET (easy:0, medium:2, hard:3, smart_hard:4). New TECH_CREDIT_THRESHOLD (easy:3000, medium:2000, hard:1500, smart_hard:1200).
- **Why:** Previous defense targets were too low (1-4). AA defenses were never built by AI. Tech thresholds enable credit-driven tech rushes.

### [Step 3] AI.ts — buildDefenses() overhaul
- **Files changed:** src/combat/AI.ts
- **What:** Layered defense system: Tier 1 early (pillbox/sentry_gun, up to 2), Tier 2 advanced (prism_tower/tesla_coil) after mid-tech, Tier 3 AA (patriot_missile/flak_cannon), Tier 4 outer perimeter padding. Phase bonus: +1 for mid, +2 for late. Rush bonus still applies.
- **Why:** Previous defense system never built AA and capped too low. Now scales naturally with game progression and adds anti-air coverage.

### [Step 4] AI.ts — followTechTree() aggressive tech push
- **Files changed:** src/combat/AI.ts
- **What:** Added 'tech' case to Rhizome organ priority switch. Mid-tech gate: hard/smart_hard build immediately when credits >= threshold (no tank gate). Battle_lab: easy now builds at army≥6 instead of 12; non-easy builds when credits threshold met. Superweapons: all difficulties build them (removed easy exclusion). TECH_CREDIT_THRESHOLD drives credit-based tech rush.
- **Why:** AI was stalling at low-tech too long. All difficulties now push through the tech tree ceiling.

### [Step 5] AI.ts — buildUnitPool() advanced unit weights
- **Files changed:** src/combat/AI.ts
- **What:** Mid-tech phase: removes one basic infantry slot, adds extra mainTank slot. Late phase: apocalypse_tank gets 3x weight (was 2x), kirov gets 2x, alliance gets black_eagle 2x + prism_tank 2x. Late phase removes both basic infantry slots entirely.
- **Why:** AI was building too much basic infantry even when apex units were available. Now properly shifts to high-tier army composition.

### [Step 6] Rhizome.test.ts — test updates
- **Files changed:** src/combat/Rhizome.test.ts
- **What:** Updated ORGAN_PRIORITY order test to include 'tech' at index 3. Added mockEconomy(credits) parameter. Added 3 new tests: 'tech' priority triggered, 'expansion' when tech building exists, 'expansion' when credits below threshold.
- **Why:** Tests must match new behavior. All 98 tests pass.

## Summary
- **Total files changed:** 3 (src/combat/AI.ts, src/combat/Rhizome.ts, src/combat/Rhizome.test.ts)
- **Key changes:**
  - Rhizome.ts: 'tech' added to ORGAN_PRIORITY (index 3); TECH_CREDIT_MIN=1200; getOrganPriority() returns 'tech' when production met + no tech buildings + credits >= min
  - AI.ts: DEFENSE_TARGET increased (max 8); new AA_DEFENSE_TARGET (max 4); new TECH_CREDIT_THRESHOLD; buildDefenses() 4-tier layered system with AA; followTechTree() credit-driven tech rush + Rhizome 'tech' case; buildUnitPool() apex unit weighting in mid/late phase
  - Rhizome.test.ts: updated ORGAN_PRIORITY order test; mockEconomy(credits) parameter; 2 additional tests
- **Build status:** pass (tsc clean + 98/98 vitest)
- **Known issues:** None
- **Integration notes:**
  - PR #63: https://github.com/linkbag/IronCommand/pull/63
  - The ORGAN_PRIORITY type (OrganPriority) is now union of 5 values including 'tech'
  - AI.ts followTechTree() Rhizome switch now handles case 'tech' — if AI.ts is merged without Rhizome.ts, TypeScript will error (they must be merged together)
  - The mockEconomy change in Rhizome.test.ts is backwards-compatible (default credits=0)
  - defense scaling: DEFENSE_TARGET is now higher across the board; if map geometry is tight, AI may struggle to place all defenses (handled gracefully by tryBuildBuilding returning false)

### Review Round 1
- Verdict: Review passed — reviewer exited cleanly (auto-pass: clean exit, no issues indicated)
