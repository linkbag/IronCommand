import Phaser from 'phaser'
import { isoToCart } from './IsoUtils'

// ── RTS Camera ────────────────────────────────────────────────
// Edge scrolling, middle-mouse pan, scroll zoom, WASD/arrows, snap

export interface CameraConfig {
  panSpeed: number        // pixels/sec at full edge scroll
  zoomMin: number
  zoomMax: number
  zoomStep: number        // per scroll tick
  edgeScrollMargin: number  // px from screen edge to trigger scroll
  mapWidth: number        // world pixels
  mapHeight: number       // world pixels
}

const DEFAULTS: CameraConfig = {
  panSpeed: 600,
  zoomMin: 0.5,
  zoomMax: 2.0,
  zoomStep: 0.1,
  edgeScrollMargin: 32,
  mapWidth: 128 * 32,
  mapHeight: 128 * 32,
}

export class RTSCamera {
  private cam: Phaser.Cameras.Scene2D.Camera
  private scene: Phaser.Scene
  private cfg: CameraConfig

  private isMiddleDragging = false
  private middleDragOrigin = { x: 0, y: 0 }
  private middleDragScrollOrigin = { x: 0, y: 0 }

  private snapTarget: { x: number; y: number } | null = null
  private SNAP_SPEED = 8  // lerp factor

  constructor(scene: Phaser.Scene, config: Partial<CameraConfig> = {}) {
    this.scene = scene
    this.cfg = { ...DEFAULTS, ...config }
    this.cam = scene.cameras.main

    // Set world bounds
    this.cam.setBounds(0, 0, this.cfg.mapWidth, this.cfg.mapHeight)

    this.setupInput()
  }

  // ── Update (call every frame) ─────────────────────────────────

  update(delta: number): void {
    if (this.snapTarget) {
      this.updateSnap(delta)
      return
    }
    this.handleEdgeScroll(delta)
    this.handleKeyboardPan(delta)
  }

  private updateSnap(delta: number): void {
    if (!this.snapTarget) return
    const t = Math.min(1, this.SNAP_SPEED * delta / 1000)
    const cx = this.cam.scrollX + this.cam.width / 2
    const cy = this.cam.scrollY + this.cam.height / 2
    const nx = cx + (this.snapTarget.x - cx) * t
    const ny = cy + (this.snapTarget.y - cy) * t
    this.centerOn(nx, ny)
    const dx = Math.abs(this.snapTarget.x - nx)
    const dy = Math.abs(this.snapTarget.y - ny)
    if (dx < 2 && dy < 2) this.snapTarget = null
  }

  private handleEdgeScroll(delta: number): void {
    if (this.isMiddleDragging) return
    const { input, scale } = this.scene
    if (!input.activePointer.active) return

    const margin = this.cfg.edgeScrollMargin
    const speed = this.cfg.panSpeed * delta / 1000
    const px = input.activePointer.x
    const py = input.activePointer.y
    const sw = scale.width
    const sh = scale.height

    let vx = 0, vy = 0
    if (px < margin) vx = -speed
    else if (px > sw - margin) vx = speed
    if (py < margin) vy = -speed
    else if (py > sh - margin) vy = speed

    if (vx !== 0 || vy !== 0) {
      this.cam.scrollX = Phaser.Math.Clamp(
        this.cam.scrollX + vx,
        0,
        Math.max(0, this.cfg.mapWidth  - this.cam.width  / this.cam.zoom)
      )
      this.cam.scrollY = Phaser.Math.Clamp(
        this.cam.scrollY + vy,
        0,
        Math.max(0, this.cfg.mapHeight - this.cam.height / this.cam.zoom)
      )
    }
  }

  private handleKeyboardPan(delta: number): void {
    const kb = this.scene.input.keyboard
    if (!kb) return
    const speed = this.cfg.panSpeed * delta / 1000
    const keys = kb.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.UP,
      down:  Phaser.Input.Keyboard.KeyCodes.DOWN,
      left:  Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<string, Phaser.Input.Keyboard.Key>

    let vx = 0, vy = 0
    if (Phaser.Input.Keyboard.JustDown(keys.left)  || keys.left.isDown  || keys.a.isDown) vx -= speed
    if (Phaser.Input.Keyboard.JustDown(keys.right) || keys.right.isDown || keys.d.isDown) vx += speed
    if (Phaser.Input.Keyboard.JustDown(keys.up)    || keys.up.isDown    || keys.w.isDown) vy -= speed
    if (Phaser.Input.Keyboard.JustDown(keys.down)  || keys.down.isDown  || keys.s.isDown) vy += speed

    if (vx !== 0 || vy !== 0) {
      this.cam.scrollX = Phaser.Math.Clamp(
        this.cam.scrollX + vx,
        0,
        Math.max(0, this.cfg.mapWidth  - this.cam.width  / this.cam.zoom)
      )
      this.cam.scrollY = Phaser.Math.Clamp(
        this.cam.scrollY + vy,
        0,
        Math.max(0, this.cfg.mapHeight - this.cam.height / this.cam.zoom)
      )
    }
  }

  // ── Input Setup ───────────────────────────────────────────────

  private setupInput(): void {
    const { input } = this.scene

    // Middle mouse drag
    input.on(Phaser.Input.Events.POINTER_DOWN, (ptr: Phaser.Input.Pointer) => {
      if (ptr.middleButtonDown()) {
        this.isMiddleDragging = true
        this.middleDragOrigin = { x: ptr.x, y: ptr.y }
        this.middleDragScrollOrigin = { x: this.cam.scrollX, y: this.cam.scrollY }
        this.snapTarget = null
      }
    })

    input.on(Phaser.Input.Events.POINTER_MOVE, (ptr: Phaser.Input.Pointer) => {
      if (!this.isMiddleDragging) return
      const dx = (ptr.x - this.middleDragOrigin.x) / this.cam.zoom
      const dy = (ptr.y - this.middleDragOrigin.y) / this.cam.zoom
      this.cam.scrollX = Phaser.Math.Clamp(
        this.middleDragScrollOrigin.x - dx,
        0,
        Math.max(0, this.cfg.mapWidth  - this.cam.width  / this.cam.zoom)
      )
      this.cam.scrollY = Phaser.Math.Clamp(
        this.middleDragScrollOrigin.y - dy,
        0,
        Math.max(0, this.cfg.mapHeight - this.cam.height / this.cam.zoom)
      )
    })

    input.on(Phaser.Input.Events.POINTER_UP, (ptr: Phaser.Input.Pointer) => {
      if (!ptr.middleButtonDown()) this.isMiddleDragging = false
    })

    // Scroll wheel zoom
    input.on(Phaser.Input.Events.POINTER_WHEEL, (
      _ptr: Phaser.Input.Pointer,
      _gameObjs: unknown[],
      _deltaX: number,
      deltaY: number,
    ) => {
      const direction = deltaY > 0 ? -1 : 1
      const newZoom = Phaser.Math.Clamp(
        this.cam.zoom + direction * this.cfg.zoomStep,
        this.cfg.zoomMin,
        this.cfg.zoomMax,
      )
      this.cam.setZoom(newZoom)
      this.clampScroll()
    })
  }

  // ── Public API ────────────────────────────────────────────────

  /** Instantly center camera on world position */
  centerOn(worldX: number, worldY: number): void {
    this.cam.scrollX = Phaser.Math.Clamp(
      worldX - this.cam.width  / this.cam.zoom / 2,
      0,
      Math.max(0, this.cfg.mapWidth  - this.cam.width  / this.cam.zoom)
    )
    this.cam.scrollY = Phaser.Math.Clamp(
      worldY - this.cam.height / this.cam.zoom / 2,
      0,
      Math.max(0, this.cfg.mapHeight - this.cam.height / this.cam.zoom)
    )
  }

  /** Smoothly snap camera to world position */
  snapTo(worldX: number, worldY: number): void {
    this.snapTarget = { x: worldX, y: worldY }
  }

  setZoom(zoom: number): void {
    this.cam.setZoom(Phaser.Math.Clamp(zoom, this.cfg.zoomMin, this.cfg.zoomMax))
    this.clampScroll()
  }

  get zoom(): number { return this.cam.zoom }

  get scrollX(): number { return this.cam.scrollX }
  get scrollY(): number { return this.cam.scrollY }

  /** Returns the visible world rect */
  get worldView(): Phaser.Geom.Rectangle { return this.cam.worldView }

  /**
   * Convert screen mouse coordinates to Cartesian world position
   * via isometric transform. Use this for input handling.
   * ptr.worldX/worldY are in isometric screen space;
   * this returns Cartesian game coordinates.
   */
  screenToWorld(isoWorldX: number, isoWorldY: number): { x: number; y: number } {
    return isoToCart(isoWorldX, isoWorldY)
  }

  private clampScroll(): void {
    this.cam.scrollX = Phaser.Math.Clamp(
      this.cam.scrollX, 0,
      Math.max(0, this.cfg.mapWidth  - this.cam.width  / this.cam.zoom)
    )
    this.cam.scrollY = Phaser.Math.Clamp(
      this.cam.scrollY, 0,
      Math.max(0, this.cfg.mapHeight - this.cam.height / this.cam.zoom)
    )
  }
}
