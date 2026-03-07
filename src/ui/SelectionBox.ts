// ============================================================
// IRON COMMAND — SelectionBox
// Green translucent drag-selection rectangle + attack-move cursor
// ============================================================

import Phaser from 'phaser'
import { cartToIso } from '../engine/IsoUtils'

export interface SelectionCandidate {
  id: string
  x: number
  y: number
}

export class SelectionBox {
  private graphics: Phaser.GameObjects.Graphics
  private cursor:   Phaser.GameObjects.Graphics
  private active  = false
  private startX  = 0
  private startY  = 0

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
    this.graphics.setDepth(100)

    // Cursor overlay (for attack-move etc.)
    this.cursor = scene.add.graphics()
    this.cursor.setDepth(101)
  }

  startDrag(worldX: number, worldY: number) {
    this.active = true
    this.startX = worldX
    this.startY = worldY
  }

  updateDrag(worldX: number, worldY: number, camOffX: number, camOffY: number) {
    if (!this.active) return

    const x1 = Math.min(this.startX, worldX)
    const y1 = Math.min(this.startY, worldY)
    const x2 = Math.max(this.startX, worldX)
    const y2 = Math.max(this.startY, worldY)

    this.graphics.clear()
    this.graphics.setPosition(-camOffX, -camOffY)

    // Fill
    this.graphics.fillStyle(0x00ff00, 0.07)
    this.graphics.fillRect(x1, y1, x2 - x1, y2 - y1)

    // Border
    this.graphics.lineStyle(1, 0x00ff00, 0.8)
    this.graphics.strokeRect(x1, y1, x2 - x1, y2 - y1)

    // Corner ticks (RA2 style)
    const tick = 7
    this.graphics.lineStyle(2, 0x44ff44, 1)
    const corners: [number, number, number, number, number, number][] = [
      [x1, y1, x1 + tick, y1, x1, y1 + tick],
      [x2, y1, x2 - tick, y1, x2, y1 + tick],
      [x1, y2, x1 + tick, y2, x1, y2 - tick],
      [x2, y2, x2 - tick, y2, x2, y2 - tick],
    ]
    corners.forEach(([ax, ay, bx, by, cx, cy]) => {
      this.graphics.lineBetween(ax, ay, bx, by)
      this.graphics.lineBetween(ax, ay, cx, cy)
    })
  }

  endDrag(): { x: number; y: number; width: number; height: number } | null {
    if (!this.active) return null
    this.active = false
    this.graphics.clear()

    return { x: this.startX, y: this.startY, width: 0, height: 0 }
  }

  getEntitiesInScreenRect(
    entities: SelectionCandidate[],
    endScreenX: number,
    endScreenY: number,
    camOffX: number,
    camOffY: number,
  ): string[] {
    const x1 = Math.min(this.startX, endScreenX)
    const y1 = Math.min(this.startY, endScreenY)
    const x2 = Math.max(this.startX, endScreenX)
    const y2 = Math.max(this.startY, endScreenY)

    const selected: string[] = []
    for (const e of entities) {
      const iso = cartToIso(e.x, e.y)
      const sx = iso.x - camOffX
      const sy = iso.y - camOffY
      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
        selected.push(e.id)
      }
    }
    return selected
  }

  /**
   * Draw the attack-move crosshair cursor at screen coordinates.
   * Call this every frame in update() when in attack-move mode.
   */
  drawAttackMoveCursor(screenX: number, screenY: number) {
    const g  = this.cursor
    g.clear()
    const r  = 12
    const cx = screenX
    const cy = screenY

    // Outer circle
    g.lineStyle(2, 0xff4444, 1)
    g.strokeCircle(cx, cy, r)

    // Crosshair lines (gap around centre)
    const gap = 4
    g.lineBetween(cx - r - 3, cy, cx - gap, cy)
    g.lineBetween(cx + gap,   cy, cx + r + 3, cy)
    g.lineBetween(cx, cy - r - 3, cx, cy - gap)
    g.lineBetween(cx, cy + gap,   cx, cy + r + 3)

    // Centre dot
    g.fillStyle(0xff4444, 1)
    g.fillCircle(cx, cy, 2)

    // 'A' badge (top-right)
    g.fillStyle(0xff4444, 0.85)
    g.fillRect(cx + r - 2, cy - r - 10, 10, 10)
    g.lineStyle(1, 0xff8888, 1)
    g.strokeRect(cx + r - 2, cy - r - 10, 10, 10)
  }

  clearCursor() {
    this.cursor.clear()
  }

  clear() {
    this.active = false
    this.graphics.clear()
  }

  destroy() {
    this.graphics.destroy()
    this.cursor.destroy()
  }
}
