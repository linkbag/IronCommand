// ============================================================
// IRON COMMAND — HealthBars
// Health bar rendering for entities
// ============================================================

import Phaser from 'phaser'

export interface EntityForHP {
  id: string
  x: number      // world px
  y: number
  hp: number
  maxHp: number
  isAlive: boolean
}

export class HealthBars {
  private graphics: Phaser.GameObjects.Graphics
  private selectedIds: Set<string> = new Set()

  private readonly BAR_W = 22
  private readonly BAR_H = 3
  private readonly BAR_OFFSET_Y = -14  // above entity center

  constructor(scene: Phaser.Scene, depth = 80) {
    this.graphics = scene.add.graphics()
    this.graphics.setDepth(depth)
  }

  setSelected(ids: string[]) {
    this.selectedIds = new Set(ids)
  }

  draw(entities: EntityForHP[], camOffX: number, camOffY: number) {
    const g = this.graphics
    g.clear()
    g.setPosition(-camOffX, -camOffY)

    for (const e of entities) {
      if (!e.isAlive) continue
      const pct = e.hp / e.maxHp
      // Show bar only if selected OR damaged (< 100%)
      if (pct >= 1 && !this.selectedIds.has(e.id)) continue

      const sx = e.x - this.BAR_W / 2
      const sy = e.y + this.BAR_OFFSET_Y

      // Background
      g.fillStyle(0x111111, 0.85)
      g.fillRect(sx - 1, sy - 1, this.BAR_W + 2, this.BAR_H + 2)

      // Filled portion
      const barColor = pct > 0.5 ? 0x44ee44 : pct > 0.25 ? 0xeeee44 : 0xee4444
      g.fillStyle(barColor, 1)
      g.fillRect(sx, sy, Math.max(1, Math.floor(this.BAR_W * pct)), this.BAR_H)

      // Empty portion
      g.fillStyle(0x222222, 0.6)
      g.fillRect(
        sx + Math.floor(this.BAR_W * pct), sy,
        this.BAR_W - Math.floor(this.BAR_W * pct), this.BAR_H,
      )
    }
  }

  destroy() {
    this.graphics.destroy()
  }
}
