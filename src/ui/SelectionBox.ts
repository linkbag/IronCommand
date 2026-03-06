// ============================================================
// IRON COMMAND — SelectionBox
// Green translucent drag-selection rectangle
// ============================================================

import Phaser from 'phaser'

export class SelectionBox {
  private graphics: Phaser.GameObjects.Graphics
  private active = false
  private startX = 0
  private startY = 0

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
    this.graphics.setDepth(100)
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

    this.graphics.fillStyle(0x00ff00, 0.08)
    this.graphics.fillRect(x1, y1, x2 - x1, y2 - y1)

    this.graphics.lineStyle(1, 0x00ff00, 0.85)
    this.graphics.strokeRect(x1, y1, x2 - x1, y2 - y1)

    // Corner ticks for RA2 style
    const tickSize = 6
    this.graphics.lineStyle(2, 0x44ff44, 1)
    const corners = [
      [x1, y1, x1 + tickSize, y1, x1, y1 + tickSize],
      [x2, y1, x2 - tickSize, y1, x2, y1 + tickSize],
      [x1, y2, x1 + tickSize, y2, x1, y2 - tickSize],
      [x2, y2, x2 - tickSize, y2, x2, y2 - tickSize],
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

    const { startX, startY } = this
    return {
      x: startX,
      y: startY,
      width: 0,
      height: 0,
    }
  }

  clear() {
    this.active = false
    this.graphics.clear()
  }

  destroy() {
    this.graphics.destroy()
  }
}
