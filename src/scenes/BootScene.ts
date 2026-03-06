// ============================================================
// IRON COMMAND — BootScene
// Generates all placeholder sprites programmatically using Phaser Graphics
// ============================================================

import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  private progressBar!: Phaser.GameObjects.Graphics
  private progressBox!: Phaser.GameObjects.Graphics
  private loadingText!: Phaser.GameObjects.Text
  private tasks: Array<() => void> = []
  private taskIndex = 0

  constructor() {
    super({ key: 'BootScene' })
  }

  preload() {
    this.createLoadingUI()
  }

  create() {
    this.buildTaskList()
    this.runNextTask()
  }

  private createLoadingUI() {
    const { width, height } = this.scale

    // Dark background
    const bg = this.add.graphics()
    bg.fillStyle(0x0a0a0f, 1)
    bg.fillRect(0, 0, width, height)

    // Title
    this.add.text(width / 2, height / 2 - 80, 'IRON COMMAND', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#e94560',
      stroke: '#000',
      strokeThickness: 4,
    }).setOrigin(0.5)

    // Loading label
    this.loadingText = this.add.text(width / 2, height / 2 - 20, 'Initializing systems...', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5)

    // Progress box (background)
    this.progressBox = this.add.graphics()
    this.progressBox.fillStyle(0x1a1a2e, 1)
    this.progressBox.fillRect(width / 2 - 200, height / 2 + 10, 400, 24)

    // Progress bar
    this.progressBar = this.add.graphics()
  }

  private buildTaskList() {
    const tasks: Array<() => void> = []

    // Terrain tiles 32x32
    const terrainDefs: Array<{ key: string; color: number; label: string }> = [
      { key: 'terrain_grass',  color: 0x4a7c3f, label: '' },
      { key: 'terrain_water',  color: 0x1e6fa8, label: '' },
      { key: 'terrain_ore',    color: 0xd4a017, label: '' },
      { key: 'terrain_rock',   color: 0x777777, label: '' },
      { key: 'terrain_sand',   color: 0xc2a96e, label: '' },
      { key: 'terrain_forest', color: 0x1e5c1e, label: '' },
      { key: 'terrain_road',   color: 0x555555, label: '' },
    ]
    for (const t of terrainDefs) {
      tasks.push(() => this.genTile(t.key, t.color))
    }

    // Infantry 16x16 — colored circle with letter
    const infantryDefs: Array<{ key: string; color: number; letter: string }> = [
      { key: 'unit_rifle',    color: 0x3a8a3a, letter: 'R' },
      { key: 'unit_rocket',   color: 0x8a3a3a, letter: 'K' },
      { key: 'unit_engineer', color: 0x8a7a3a, letter: 'E' },
      { key: 'unit_dog',      color: 0x8a5a3a, letter: 'D' },
    ]
    for (const u of infantryDefs) {
      tasks.push(() => this.genInfantry(u.key, u.color, u.letter))
    }

    // Vehicles 24x16 — colored rectangle with letter
    const vehicleDefs: Array<{ key: string; color: number; letter: string }> = [
      { key: 'unit_light_tank',  color: 0x556b2f, letter: 'L' },
      { key: 'unit_heavy_tank',  color: 0x4a4a4a, letter: 'H' },
      { key: 'unit_artillery',   color: 0x8b6914, letter: 'A' },
      { key: 'unit_apc',         color: 0x3a5a7a, letter: 'P' },
      { key: 'unit_harvester',   color: 0xd4a017, letter: '$' },
    ]
    for (const v of vehicleDefs) {
      tasks.push(() => this.genVehicle(v.key, v.color, v.letter))
    }

    // Aircraft 20x20 — colored triangle
    const aircraftDefs: Array<{ key: string; color: number }> = [
      { key: 'unit_fighter',   color: 0x4466aa },
      { key: 'unit_helicopter', color: 0x446666 },
    ]
    for (const a of aircraftDefs) {
      tasks.push(() => this.genAircraft(a.key, a.color))
    }

    // Buildings — colored rectangles with abbreviations
    const buildingDefs: Array<{ key: string; color: number; label: string; w: number; h: number }> = [
      { key: 'bld_construction_yard', color: 0x8b6914, label: 'CY',  w: 64, h: 64 },
      { key: 'bld_power_plant',       color: 0xccaa00, label: 'PP',  w: 48, h: 48 },
      { key: 'bld_barracks',          color: 0x3a6a3a, label: 'BK',  w: 48, h: 48 },
      { key: 'bld_war_factory',       color: 0x5a5a5a, label: 'WF',  w: 64, h: 48 },
      { key: 'bld_airfield',          color: 0x3a4a7a, label: 'AF',  w: 64, h: 48 },
      { key: 'bld_naval_yard',        color: 0x1e4a8a, label: 'NY',  w: 64, h: 64 },
      { key: 'bld_ore_refinery',      color: 0xd4a017, label: 'OR',  w: 64, h: 48 },
      { key: 'bld_radar_tower',       color: 0x3a7a7a, label: 'RT',  w: 32, h: 48 },
      { key: 'bld_tech_center',       color: 0x6a3a8a, label: 'TC',  w: 64, h: 64 },
      { key: 'bld_turret',            color: 0x7a3a3a, label: 'TU',  w: 32, h: 32 },
      { key: 'bld_aa_gun',            color: 0x7a5a3a, label: 'AA',  w: 32, h: 32 },
      { key: 'bld_wall',              color: 0x8a8a8a, label: 'WL',  w: 32, h: 32 },
      { key: 'bld_superweapon',       color: 0xaa0044, label: 'SW',  w: 64, h: 96 },
    ]
    for (const b of buildingDefs) {
      tasks.push(() => this.genBuilding(b.key, b.color, b.label, b.w, b.h))
    }

    // Projectiles
    tasks.push(() => this.genProjectile('proj_bullet',  0xffff88, 4, 4))
    tasks.push(() => this.genProjectile('proj_missile', 0xff8844, 6, 3))
    tasks.push(() => this.genProjectile('proj_shell',   0xff4444, 5, 5))

    // Explosions (3 frames)
    tasks.push(() => this.genExplosion())

    // Faction-colored unit overlays (placeholders; real color tinting done at runtime)
    tasks.push(() => this.genTile('pixel_white', 0xffffff, 1, 1))
    tasks.push(() => this.genSelectionCircle())

    // ── HUD / UI extras ────────────────────────────────────────────
    tasks.push(() => this.genGhostTile('ghost_valid',   0x4ade80, 0.35))
    tasks.push(() => this.genGhostTile('ghost_invalid', 0xe94560, 0.35))
    tasks.push(() => this.genCursorIcon('cursor_sell',   0xffd700))
    tasks.push(() => this.genCursorIcon('cursor_repair', 0x4488ff))
    tasks.push(() => this.genAttackMoveCursor())
    tasks.push(() => this.genAlertPanel())
    tasks.push(() => this.genVetChevron('vet_rank1', 1))
    tasks.push(() => this.genVetChevron('vet_rank2', 2))

    this.tasks = tasks
  }

  private runNextTask() {
    if (this.taskIndex >= this.tasks.length) {
      this.updateProgress(1)
      this.time.delayedCall(300, () => {
        this.scene.start('MenuScene')
      })
      return
    }

    const progress = this.taskIndex / this.tasks.length
    this.updateProgress(progress)
    this.loadingText.setText(`Loading assets... ${Math.round(progress * 100)}%`)

    this.tasks[this.taskIndex]()
    this.taskIndex++

    // Schedule next task next frame to allow progress bar to render
    this.time.delayedCall(1, () => this.runNextTask())
  }

  private updateProgress(t: number) {
    const { width, height } = this.scale
    this.progressBar.clear()
    this.progressBar.fillStyle(0xe94560, 1)
    this.progressBar.fillRect(width / 2 - 198, height / 2 + 12, 396 * t, 20)
  }

  // ── Sprite Generators ──────────────────────────────────────────────

  private genTile(key: string, color: number, w = 32, h = 32) {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, 1)
    g.fillRect(0, 0, w, h)
    // Grid line
    g.lineStyle(1, 0x000000, 0.2)
    g.strokeRect(0, 0, w, h)
    g.generateTexture(key, w, h)
    g.destroy()
  }

  private genInfantry(key: string, color: number, letter: string) {
    const size = 16
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, 1)
    g.fillCircle(size / 2, size / 2, size / 2 - 1)
    g.generateTexture(key, size, size)
    g.destroy()
    // We'll render the letter in the game via text objects — texture is color-only
    void letter // suppress unused warning
  }

  private genVehicle(key: string, color: number, letter: string) {
    const w = 24
    const h = 16
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    // Body
    g.fillStyle(color, 1)
    g.fillRect(2, 2, w - 4, h - 4)
    // Tracks
    g.fillStyle(0x333333, 1)
    g.fillRect(0, 0, w, 3)
    g.fillRect(0, h - 3, w, 3)
    // Turret stub
    g.fillStyle(Phaser.Display.Color.IntegerToColor(color).lighten(20).color, 1)
    g.fillRect(8, 5, 8, 6)
    g.generateTexture(key, w, h)
    g.destroy()
    void letter
  }

  private genAircraft(key: string, color: number) {
    const size = 20
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, 1)
    // Triangle pointing up
    g.fillTriangle(size / 2, 1, size - 1, size - 1, 1, size - 1)
    g.lineStyle(1, 0xffffff, 0.5)
    g.strokeTriangle(size / 2, 1, size - 1, size - 1, 1, size - 1)
    g.generateTexture(key, size, size)
    g.destroy()
  }

  private genBuilding(key: string, color: number, label: string, w: number, h: number) {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    // Main body
    g.fillStyle(color, 1)
    g.fillRect(0, 0, w, h)
    // Dark border
    g.lineStyle(2, 0x000000, 0.8)
    g.strokeRect(1, 1, w - 2, h - 2)
    // Highlight top-left
    g.lineStyle(1, 0xffffff, 0.3)
    g.beginPath()
    g.moveTo(2, h - 2)
    g.lineTo(2, 2)
    g.lineTo(w - 2, 2)
    g.strokePath()
    g.generateTexture(key, w, h)
    g.destroy()
    void label
  }

  private genProjectile(key: string, color: number, w: number, h: number) {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, 1)
    g.fillRect(0, 0, w, h)
    g.generateTexture(key, w, h)
    g.destroy()
  }

  private genExplosion() {
    // 3 frames: small, medium, large orange/red circles
    const frames = [
      { key: 'explosion_0', r: 8,  color: 0xff8800 },
      { key: 'explosion_1', r: 16, color: 0xff4400 },
      { key: 'explosion_2', r: 12, color: 0xff2200 },
    ]
    for (const f of frames) {
      const size = f.r * 2 + 2
      const g = this.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(f.color, 1)
      g.fillCircle(f.r + 1, f.r + 1, f.r)
      // Inner bright core
      g.fillStyle(0xffff88, 0.6)
      g.fillCircle(f.r + 1, f.r + 1, Math.floor(f.r * 0.5))
      g.generateTexture(f.key, size, size)
      g.destroy()
    }
  }

  private genSelectionCircle() {
    const size = 32
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.lineStyle(2, 0x00ff00, 0.9)
    g.strokeEllipse(size / 2, size / 2, size - 4, (size - 4) * 0.4)
    g.generateTexture('selection_circle', size, size)
    g.destroy()
  }

  // ── HUD / UI extras ──────────────────────────────────────────────────

  /** Semi-transparent coloured tile for building placement ghost */
  private genGhostTile(key: string, color: number, alpha: number) {
    const size = 64
    const g    = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, alpha)
    g.fillRect(0, 0, size, size)
    g.lineStyle(2, color, 0.85)
    g.strokeRect(0, 0, size, size)
    g.lineStyle(1, color, 0.25)
    g.lineBetween(32, 0, 32, 64)
    g.lineBetween(0, 32, 64, 32)
    g.generateTexture(key, size, size)
    g.destroy()
  }

  /** Small square cursor icon ($ or wrench placeholder) */
  private genCursorIcon(key: string, color: number) {
    const size = 16
    const g    = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, 1)
    g.fillCircle(size / 2, size / 2, size / 2 - 1)
    g.fillStyle(0x000000, 0.5)
    g.fillRect(size / 2 - 2, 2, 4, size - 4)
    g.generateTexture(key, size, size)
    g.destroy()
  }

  /** Attack-move cursor: crosshair with 'A' badge */
  private genAttackMoveCursor() {
    const size = 24
    const g    = this.make.graphics({ x: 0, y: 0 }, false)
    const cx   = size / 2
    const cy   = size / 2
    const r    = size / 2 - 2
    g.lineStyle(2, 0xff4444, 1)
    g.strokeCircle(cx, cy, r)
    g.lineBetween(cx - r - 2, cy, cx + r + 2, cy)
    g.lineBetween(cx, cy - r - 2, cx, cy + r + 2)
    // Inner red dot
    g.fillStyle(0xff4444, 1)
    g.fillCircle(cx, cy, 2)
    g.generateTexture('cursor_attack_move', size, size)
    g.destroy()
  }

  /** Semi-transparent dark rectangle for EVA alert panel background */
  private genAlertPanel() {
    const w = 240
    const h = 28
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0x0a0a1a, 0.92)
    g.fillRect(0, 0, w, h)
    g.lineStyle(1, 0x4466aa, 0.7)
    g.strokeRect(0, 0, w, h)
    g.generateTexture('eva_alert_panel', w, h)
    g.destroy()
  }

  /** Veterancy chevron strip (rank 1 = one, rank 2 = two chevrons) */
  private genVetChevron(key: string, rank: number) {
    const w  = 12 * rank + 2
    const h  = 8
    const g  = this.make.graphics({ x: 0, y: 0 }, false)
    const col = rank === 2 ? 0xffdd44 : 0x88bbff
    g.lineStyle(2, col, 1)
    for (let r = 0; r < rank; r++) {
      const ox = r * 12 + 1
      g.beginPath()
      g.moveTo(ox,     h - 1)
      g.lineTo(ox + 5, 1)
      g.lineTo(ox + 10, h - 1)
      g.strokePath()
    }
    g.generateTexture(key, Math.max(1, w), Math.max(1, h))
    g.destroy()
  }
}
