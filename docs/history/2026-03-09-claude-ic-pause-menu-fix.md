# Work Log: claude-ic-pause-menu-fix
## Task: ic-pause-menu-fix (IronCommand)
## Branch: feat/ic-pause-menu-fix
---

### [Step 1] Root-cause investigation

Traced the pause UI code in `src/scenes/GameScene.ts`. The pause panel is built from nested Phaser Containers:
- `pausePanel` (outer container, `setScrollFactor(0)`)
  - `pauseMenu` (inner container)
    - button containers (returned by `createPauseButton()`)
      - `bg` (Rectangle, `setInteractive()`) ← **bug here**
      - `txt` (Text)

Phaser's `Container.setScrollFactor(0)` defaults to `updateChildren=false`, so scroll factor is NOT propagated to children.

The WebGL renderer temporarily multiplies child scrollFactor by container scrollFactor during rendering, so buttons **appear** visually correct (scrollFactor = 1 × 0 = 0). But `InputManager.hitTest()` reads `gameObject.scrollFactorX` directly:

```
px = tempPoint.x + (csx * scrollFactorX) - csx
```

With `bg.scrollFactorX = 1` and camera scrolled by `csx` pixels, the computed hit point is in world space — displaced from the actual button position on screen. Clicks land in empty world space, never registering on the button.

### [Step 2] Fix applied

In `createPauseButton()` (`src/scenes/GameScene.ts`):
- Added `.setScrollFactor(0)` to `bg` (the interactive Rectangle) — **critical fix**
- Added `.setScrollFactor(0)` to `txt` (Text) — consistency
- Added `.setScrollFactor(0)` to the returned container — consistency

### [Step 3] Verification

- `npx tsc --noEmit` → clean (no errors)
- `npx vitest run` → 96/96 tests passing

### Review Round 1
- Verdict: Review passed — reviewer fixed issues (commit: 096b174 docs: auto-update ESR + persist worklog for claude-ic-building-graphics-fix)
