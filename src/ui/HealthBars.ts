// ============================================================
// IRON COMMAND — HealthBars
// Health bar + veterancy chevron rendering for entities
// ============================================================

import Phaser from 'phaser'
import { cartToIso } from '../engine/IsoUtils'

export interface EntityForHP {
  id: string
  playerId: number
  x: number       // world px
  y: number
  hp: number
  maxHp: number
  isAlive: boolean
  veterancy?: number  // 0 = rookie, 1 = veteran, 2 = elite
}

export class HealthBars {
  private graphics:    Phaser.GameObjects.Graphics
  private selectedIds: Set<string> = new Set()

  private readonly BAR_W      = 24
  private readonly BAR_H      = 3
  private readonly BAR_OFF_Y  = -14  // above entity centre
  private readonly CHEV_H     = 5    // chevron strip height
  private readonly CHEV_GAP   = 2    // gap between bar and chevron

  constructor(scene: Phaser.Scene, depth = 80) {
    this.graphics = scene.add.graphics()
    this.graphics.setDepth(depth)
  }

  setSelected(ids: string[]) {
    this.selectedIds = new Set(ids)
  }

  draw(entities: EntityForHP[], camOffX: number, camOffY: number, localPlayerId = 0) {
    const g = this.graphics
    g.clear()
    g.setPosition(-camOffX, -camOffY)

    for (const e of entities) {
      if (!e.isAlive) continue
      const pct = e.hp / e.maxHp
      if (pct >= 1 && !this.selectedIds.has(e.id)) continue

      const isoPos = cartToIso(e.x, e.y)
      const sx = isoPos.x - this.BAR_W / 2
      const sy = isoPos.y + this.BAR_OFF_Y

      // ── Health bar ───────────────────────────────────────────────
      // Background shadow
      g.fillStyle(0x111111, 0.85)
      g.fillRect(sx - 1, sy - 1, this.BAR_W + 2, this.BAR_H + 2)

      // Empty track
      g.fillStyle(0x222222, 0.8)
      g.fillRect(sx, sy, this.BAR_W, this.BAR_H)

      // Filled portion
      const isFriendly = e.playerId === localPlayerId
      const barColor = isFriendly
        ? (pct > 0.3 ? 0x4ade80 : 0x2f9e5a)
        : (pct > 0.3 ? 0xe94560 : 0x9f2436)
      const fillW    = Math.max(1, Math.floor(this.BAR_W * pct))
      g.fillStyle(barColor, 1)
      g.fillRect(sx, sy, fillW, this.BAR_H)

      // Shimmer highlight
      g.fillStyle(0xffffff, 0.25)
      g.fillRect(sx, sy, fillW, 1)

      // ── Veterancy chevrons ───────────────────────────────────────
      const rank = e.veterancy ?? 0
      if (rank > 0 && this.selectedIds.has(e.id)) {
        this.drawChevrons(g, isoPos.x, sy - this.CHEV_H - this.CHEV_GAP, rank)
      }
    }
  }

  private drawChevrons(g: Phaser.GameObjects.Graphics, cx: number, top: number, rank: number) {
    // rank 1 = veteran (blue), rank 2 = elite (gold)
    const col = rank >= 2 ? 0xffdd44 : 0x88aaff
    const chevW = 6
    const gap   = 3
    const total = rank * chevW + (rank - 1) * gap
    const ox    = cx - total / 2

    g.lineStyle(1, col, 1)
    for (let r = 0; r < rank; r++) {
      const x = ox + r * (chevW + gap)
      const y = top
      g.beginPath()
      g.moveTo(x,              y + this.CHEV_H - 1)
      g.lineTo(x + chevW / 2, y)
      g.lineTo(x + chevW,     y + this.CHEV_H - 1)
      g.strokePath()
    }
  }

  destroy() {
    this.graphics.destroy()
  }
}
