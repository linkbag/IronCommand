import Phaser from 'phaser'
import { FogState, TILE_SIZE } from '../types'
import type { GameMap as GameMapData } from '../types'
import type { GameMap } from './GameMap'
import type { RTSCamera } from './Camera'

// ── Terrain colors (minimap scale) ───────────────────────────
// Using flat single colors for performance at minimap resolution

const MINIMAP_TERRAIN_COLORS: Record<number, number> = {
  0: 0x4a7c3f,  // GRASS
  1: 0x1a6fa8,  // WATER
  2: 0xd4a017,  // ORE
  3: 0x7a7a7a,  // ROCK
  4: 0xd2b48c,  // SAND
  5: 0x555555,  // ROAD
  6: 0x8b6914,  // BRIDGE
  7: 0x1e4d1a,  // FOREST
}

const FOG_OVERLAY_ALPHA: Record<FogState, number> = {
  [FogState.HIDDEN]:   1.0,
  [FogState.EXPLORED]: 0.45,
  [FogState.VISIBLE]:  0.0,
}

export interface MinimapEntityDot {
  worldX: number
  worldY: number
  color: number   // player color
}

export class Minimap {
  private scene: Phaser.Scene
  private gameMap: GameMap
  private rtsCamera: RTSCamera

  // Minimap screen position and size
  private readonly size = 200
  private readonly margin = 10
  private screenX: number
  private screenY: number

  // Graphics objects (fixed to camera)
  private terrainRender: Phaser.GameObjects.RenderTexture
  private overlay: Phaser.GameObjects.Graphics
  private border: Phaser.GameObjects.Graphics

  private lastUpdateTime = 0
  private readonly UPDATE_INTERVAL = 500  // ms

  // Scale factors: world → minimap pixels
  private scaleX: number
  private scaleY: number

  constructor(scene: Phaser.Scene, gameMap: GameMap, camera: RTSCamera) {
    this.scene = scene
    this.gameMap = gameMap
    this.rtsCamera = camera

    const { width } = scene.scale
    this.screenX = width - this.size - this.margin
    this.screenY = this.margin

    const mapData = gameMap.data
    this.scaleX = this.size / mapData.width
    this.scaleY = this.size / mapData.height

    // RenderTexture for terrain (draw once)
    this.terrainRender = scene.add.renderTexture(this.screenX, this.screenY, this.size, this.size)
    this.terrainRender.setScrollFactor(0)
    this.terrainRender.setDepth(90)

    this.overlay = scene.add.graphics()
    this.overlay.setScrollFactor(0)
    this.overlay.setDepth(91)

    this.border = scene.add.graphics()
    this.border.setScrollFactor(0)
    this.border.setDepth(92)

    this.drawBorder()
    this.renderTerrainToTexture()
    this.setupClickInput()
  }

  // ── Update (call every frame) ─────────────────────────────────

  update(time: number, entityDots: MinimapEntityDot[]): void {
    if (time - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
      this.lastUpdateTime = time
      this.renderOverlay(entityDots)
    }
    this.drawViewport()
  }

  // ── Terrain (baked once into RenderTexture) ────────────────────

  private renderTerrainToTexture(): void {
    const { tiles, width, height } = this.gameMap.data
    const g = this.scene.add.graphics()

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        const color = MINIMAP_TERRAIN_COLORS[tile.terrain] ?? 0x4a7c3f
        const px = Math.floor(col * this.scaleX)
        const py = Math.floor(row * this.scaleY)
        const pw = Math.max(1, Math.ceil(this.scaleX))
        const ph = Math.max(1, Math.ceil(this.scaleY))
        g.fillStyle(color)
        g.fillRect(px, py, pw, ph)
      }
    }

    this.terrainRender.draw(g, 0, 0)
    g.destroy()
  }

  // ── Overlay (fog + units, updated periodically) ───────────────

  private renderOverlay(entityDots: MinimapEntityDot[]): void {
    const g = this.overlay
    g.clear()

    const { tiles, width, height } = this.gameMap.data

    // Fog overlay
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        const alpha = FOG_OVERLAY_ALPHA[tile.fogState]
        if (alpha > 0) {
          const px = this.screenX + col * this.scaleX
          const py = this.screenY + row * this.scaleY
          const pw = Math.max(1, Math.ceil(this.scaleX))
          const ph = Math.max(1, Math.ceil(this.scaleY))
          g.fillStyle(0x000000, alpha)
          g.fillRect(px, py, pw, ph)
        }
      }
    }

    // Entity dots
    const mapW = this.gameMap.worldWidth
    const mapH = this.gameMap.worldHeight
    for (const dot of entityDots) {
      const px = this.screenX + (dot.worldX / mapW) * this.size
      const py = this.screenY + (dot.worldY / mapH) * this.size
      g.fillStyle(dot.color)
      g.fillCircle(px, py, 1.5)
    }
  }

  // ── Viewport rectangle ────────────────────────────────────────

  private drawViewport(): void {
    const g = this.border
    g.clear()
    this.drawBorderRect(g)

    const mapW = this.gameMap.worldWidth
    const mapH = this.gameMap.worldHeight
    const view = this.rtsCamera.worldView

    const rx = this.screenX + (view.x / mapW) * this.size
    const ry = this.screenY + (view.y / mapH) * this.size
    const rw = (view.width  / mapW) * this.size
    const rh = (view.height / mapH) * this.size

    g.lineStyle(1, 0xffffff, 0.9)
    g.strokeRect(rx, ry, rw, rh)
  }

  private drawBorder(): void {
    this.drawBorderRect(this.border)
  }

  private drawBorderRect(g: Phaser.GameObjects.Graphics): void {
    g.lineStyle(2, 0x888888, 1)
    g.strokeRect(this.screenX - 1, this.screenY - 1, this.size + 2, this.size + 2)
  }

  // ── Click to pan camera ───────────────────────────────────────

  private setupClickInput(): void {
    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, (ptr: Phaser.Input.Pointer) => {
      if (ptr.rightButtonDown()) return
      const px = ptr.x, py = ptr.y
      if (
        px >= this.screenX && px <= this.screenX + this.size &&
        py >= this.screenY && py <= this.screenY + this.size
      ) {
        const fracX = (px - this.screenX) / this.size
        const fracY = (py - this.screenY) / this.size
        const worldX = fracX * this.gameMap.worldWidth
        const worldY = fracY * this.gameMap.worldHeight
        this.rtsCamera.snapTo(worldX, worldY)
      }
    })
  }

  /** Call when window resizes to reposition minimap */
  onResize(newWidth: number): void {
    this.screenX = newWidth - this.size - this.margin
    this.terrainRender.setPosition(this.screenX, this.screenY)
    this.overlay.setPosition(0, 0)
    // Redraw terrain at new position
    this.renderTerrainToTexture()
  }
}
