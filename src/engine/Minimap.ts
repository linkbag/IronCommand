import Phaser from 'phaser'
import { FogState, TILE_SIZE } from '../types'
import type { GameMap as GameMapData } from '../types'
import type { GameMap } from './GameMap'
import type { RTSCamera } from './Camera'
import { cartToScreen, screenToCart, getIsoWorldBounds, ISO_TILE_W, ISO_TILE_H, drawIsoDiamond } from './IsoUtils'

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

function dimColor(color: number): number {
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  return ((r >> 1) << 16) | ((g >> 1) << 8) | (b >> 1)
}

export interface MinimapEntityDot {
  worldX: number
  worldY: number
  color: number   // player color
  isFriendly?: boolean
  alwaysVisible?: boolean
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
  private isoOffsetX: number
  private isoWidth: number
  private isoHeight: number

  constructor(scene: Phaser.Scene, gameMap: GameMap, camera: RTSCamera) {
    this.scene = scene
    this.gameMap = gameMap
    this.rtsCamera = camera

    const { width } = scene.scale
    this.screenX = width - this.size - this.margin
    this.screenY = this.margin

    const mapData = gameMap.data
    const bounds = getIsoWorldBounds(mapData.width, mapData.height)
    this.isoOffsetX = bounds.offsetX
    this.isoWidth = bounds.width
    this.isoHeight = bounds.height
    this.scaleX = this.size / this.isoWidth
    this.scaleY = this.size / this.isoHeight

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
      this.renderTerrainToTexture()
      this.renderOverlay(entityDots)
    }
    this.drawViewport()
  }

  // ── Terrain (redrawn on update so fog sync is exact) ────────────

  private renderTerrainToTexture(): void {
    const { tiles, width, height } = this.gameMap.data
    this.terrainRender.clear()
    const g = this.scene.add.graphics()
    const miniTileW = Math.max(1, ISO_TILE_W * this.scaleX)
    const miniTileH = Math.max(1, ISO_TILE_H * this.scaleY)

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        const terrainColor = MINIMAP_TERRAIN_COLORS[tile.terrain] ?? 0x4a7c3f
        const color =
          tile.fogState === FogState.HIDDEN ? 0x000000
          : tile.fogState === FogState.EXPLORED ? dimColor(terrainColor)
          : terrainColor
        const screen = cartToScreen(col * TILE_SIZE, row * TILE_SIZE)
        const px = screen.x * this.scaleX
        const py = screen.y * this.scaleY
        g.fillStyle(color)
        drawIsoDiamond(g, px - miniTileW / 2, py, miniTileW, miniTileH)
        g.fillPath()
      }
    }

    this.terrainRender.draw(g, 0, 0)
    g.destroy()
  }

  // ── Overlay (units only, updated periodically) ─────────────────

  private renderOverlay(entityDots: MinimapEntityDot[]): void {
    const g = this.overlay
    g.clear()

    // Entity dots
    const map = this.gameMap.data
    for (const dot of entityDots) {
      const tc = Math.floor(dot.worldX / TILE_SIZE)
      const tr = Math.floor(dot.worldY / TILE_SIZE)
      const fog = map.tiles[tr]?.[tc]?.fogState ?? FogState.HIDDEN
      const canShow = dot.alwaysVisible || dot.isFriendly || fog === FogState.VISIBLE
      if (!canShow) continue
      const screen = cartToScreen(dot.worldX, dot.worldY)
      const px = this.screenX + screen.x * this.scaleX
      const py = this.screenY + screen.y * this.scaleY
      g.fillStyle(dot.color)
      g.fillCircle(px, py, 1.5)
    }
  }

  // ── Viewport rectangle ────────────────────────────────────────

  private drawViewport(): void {
    const g = this.border
    g.clear()
    this.drawBorderRect(g)

    const view = this.rtsCamera.worldView

    const rx = this.screenX + view.x * this.scaleX
    const ry = this.screenY + view.y * this.scaleY
    const rw = view.width * this.scaleX
    const rh = view.height * this.scaleY

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
        const cart = screenToCart(fracX * this.isoWidth, fracY * this.isoHeight)
        const center = cartToScreen(cart.x, cart.y)
        this.rtsCamera.snapTo(center.x, center.y)
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
