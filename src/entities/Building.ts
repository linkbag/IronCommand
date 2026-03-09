// ============================================================
// IRON COMMAND — Base Building Class
// Extends Phaser.GameObjects.Container
// Manages construction, production queue, rally points, selling
// ============================================================

import Phaser from 'phaser'
import type { BuildingDef, BuildQueueItem, Position } from '../types'
import { TILE_SIZE } from '../types'
import { cartToScreen } from '../engine/IsoUtils'

export type BuildingState = 'constructing' | 'active' | 'low_power' | 'dying'

function adjustBrightness(color: number, amount: number): number {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 0xff) + amount))
  const g = Math.max(0, Math.min(255, ((color >> 8) & 0xff) + amount))
  const b = Math.max(0, Math.min(255, (color & 0xff) + amount))
  return (r << 16) | (g << 8) | b
}

export class Building extends Phaser.GameObjects.Container {
  readonly id: string
  readonly playerId: number
  readonly def: BuildingDef

  hp: number
  state: BuildingState
  productionQueue: BuildQueueItem[]
  rallyPoint: Position | null

  // Tiles this building occupies (set by EntityManager after placement)
  occupiedTiles: { col: number; row: number }[]

  // Construction progress 0→1
  private constructionProgress: number

  // Visual components
  private visualRoot: Phaser.GameObjects.Container
  private bodyGraphic: Phaser.GameObjects.Graphics
  private healthBar: Phaser.GameObjects.Graphics
  private selectionOutline: Phaser.GameObjects.Graphics
  private rallyLine: Phaser.GameObjects.Graphics
  private constructionOverlay: Phaser.GameObjects.Graphics
  private constructionMaskShape: Phaser.GameObjects.Graphics
  private constructionMask: Phaser.Display.Masks.GeometryMask
  private labelText: Phaser.GameObjects.Text
  private isSelected: boolean
  private factionColor: number
  private smokeTimer = 0
  private attackCooldown = 0

  constructor(
    scene: Phaser.Scene,
    id: string,
    playerId: number,
    def: BuildingDef,
    factionColor: number,
    tileCol: number,
    tileRow: number,
  ) {
    const worldX = tileCol * TILE_SIZE + (def.footprint.w * TILE_SIZE) / 2
    const worldY = tileRow * TILE_SIZE + (def.footprint.h * TILE_SIZE) / 2
    super(scene, worldX, worldY)

    this.id = id
    this.playerId = playerId
    this.def = def
    this.factionColor = factionColor
    this.hp = def.stats.maxHp
    this.state = 'constructing'
    this.productionQueue = []
    this.rallyPoint = null
    this.occupiedTiles = []
    this.constructionProgress = 0
    this.isSelected = false

    // Populate occupied tiles
    for (let r = 0; r < def.footprint.h; r++) {
      for (let c = 0; c < def.footprint.w; c++) {
        this.occupiedTiles.push({ col: tileCol + c, row: tileRow + r })
      }
    }

    // Visuals
    this.visualRoot = scene.add.container(0, 0)
    this.selectionOutline = scene.add.graphics()
    this.rallyLine = scene.add.graphics()
    this.constructionOverlay = scene.add.graphics()
    this.constructionMaskShape = scene.add.graphics().setAlpha(0)
    this.bodyGraphic = scene.add.graphics()
    this.healthBar = scene.add.graphics()
    this.labelText = scene.add.text(0, 0, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      resolution: 2,
    }).setOrigin(0.5, 0.5)

    this.visualRoot.add([
      this.selectionOutline,
      this.rallyLine,
      this.constructionOverlay,
      this.constructionMaskShape,
      this.bodyGraphic,
      this.healthBar,
      this.labelText,
    ])
    this.add(this.visualRoot)

    this.drawBody()
    this.drawHealthBar()
    this.drawSelectionOutline()
    this.constructionMask = this.constructionMaskShape.createGeometryMask()
    this.bodyGraphic.setMask(this.constructionMask)

    scene.add.existing(this)
    this.updateRenderTransform()

    // Start construction animation
    this.playConstructionAnimation()
  }

  // ── Convenience getters (for HUDScene interop) ──────────────
  get defId(): string { return this.def.id }
  get maxHp(): number { return this.def.stats.maxHp }

  // ── Public API ───────────────────────────────────────────────

  setSelected(selected: boolean): void {
    this.isSelected = selected
    this.drawSelectionOutline()
  }

  setRallyPoint(pos: Position): void {
    this.rallyPoint = pos
    this.drawRallyLine()
    this.emit('rally_point_changed', this.id, pos)
  }

  getPowerContribution(): number {
    return this.def.providespower
  }

  /** Sell the building — returns refund amount (50% of cost) */
  sell(): number {
    if (this.state === 'dying') return 0
    const refund = Math.floor(this.def.stats.cost * 0.5)
    this.die()
    return refund
  }

  /** Spend credits to repair HP */
  repair(creditsAvailable: number): number {
    if (this.state === 'dying' || this.state === 'constructing') return 0
    const missingHp = this.def.stats.maxHp - this.hp
    if (missingHp <= 0) return 0

    // Cost: 1 credit per 2 HP
    const costPerHp = 0.5
    const maxHealable = Math.floor(creditsAvailable / costPerHp)
    const actualHeal = Math.min(missingHp, maxHealable)
    const cost = Math.ceil(actualHeal * costPerHp)

    this.hp = Math.min(this.def.stats.maxHp, this.hp + actualHeal)
    this.drawHealthBar()
    return cost
  }

  takeDamage(amount: number, sourcePlayerId: number): void {
    if (this.state === 'dying') return
    this.hp = Math.max(0, this.hp - amount)
    this.drawHealthBar()
    this.emit('building_damaged', { building: this, sourcePlayerId, amount })

    // Flash on hit
    this.scene.tweens.add({
      targets: this.bodyGraphic,
      alpha: 0.3,
      duration: 80,
      yoyo: true,
    })

    if (this.hp <= 0) {
      this.die()
    }
  }

  setLowPower(lowPower: boolean): void {
    if (this.state === 'dying' || this.state === 'constructing') return
    this.state = lowPower ? 'low_power' : 'active'
    this.drawBody()
  }

  // ── Update loop ──────────────────────────────────────────────

  update(delta: number): void {
    if (this.state === 'dying') return
    this.updateRenderTransform()

    if (this.state === 'constructing') {
      this.updateConstruction(delta)
      return
    }

    // State was externally promoted to 'active' (e.g. GameScene sets building.state = 'active'
    // right after creation). The construction mask was never cleared, so bodyGraphic is invisible.
    // Finalize construction visuals now.
    if (this.constructionProgress < 1) {
      this.constructionProgress = 1
      this.setAlpha(1)
      this.visualRoot.y = 0
      this.bodyGraphic.clearMask(false)
      this.constructionOverlay.clear()
      this.constructionMaskShape.clear()
      this.drawBody()
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - delta / 1000)

    // Damage smoke when below 50% HP
    const pct = this.hp / this.def.stats.maxHp
    if (pct < 0.5 && pct > 0) {
      this.smokeTimer += delta
      const interval = pct < 0.25 ? 400 : 800
      if (this.smokeTimer >= interval) {
        this.smokeTimer = 0
        this.spawnSmoke()
      }
    }

    // Production is handled by Production.ts via productionQueue
    this.updateProductionVisuals()

    // Defensive buildings auto-fire at nearby enemies
    this.updateCombat()
  }

  private spawnSmoke(): void {
    const w = this.def.footprint.w * TILE_SIZE
    const h = this.def.footprint.h * TILE_SIZE
    const smoke = this.scene.add.graphics()
    const rx = this.x + Phaser.Math.Between(-w / 3, w / 3)
    const ry = this.y + Phaser.Math.Between(-h / 3, h / 3)
    const iso = cartToScreen(rx, ry)
    const size = Phaser.Math.Between(3, 7)
    smoke.fillStyle(0x444444, 0.6)
    smoke.fillCircle(iso.x, iso.y, size)
    smoke.setDepth(45)
    this.scene.tweens.add({
      targets: smoke,
      alpha: 0,
      y: iso.y - 20,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 600,
      onComplete: () => smoke.destroy(),
    })
  }

  // ── Death ────────────────────────────────────────────────────

  die(): void {
    if (this.state === 'dying') return
    this.state = 'dying'
    this.emit('building_died', this)

    // Large explosion
    const w = this.def.footprint.w * TILE_SIZE
    const h = this.def.footprint.h * TILE_SIZE
    const iso = cartToScreen(this.x, this.y)
    const flash = this.scene.add.graphics()
    flash.fillStyle(0xff6600, 1)
    flash.fillEllipse(iso.x, iso.y + 8, w * 0.9, h * 0.5)
    flash.setDepth(50)

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 800,
      onComplete: () => flash.destroy(),
    })

    // Rubble / smoke effect
    for (let i = 0; i < 5; i++) {
      const smoke = this.scene.add.graphics()
      const rx = this.x + Phaser.Math.Between(-w / 2, w / 2)
      const ry = this.y + Phaser.Math.Between(-h / 2, h / 2)
      const isoP = cartToScreen(rx, ry)
      smoke.fillStyle(0x888888, 0.8)
      smoke.fillCircle(isoP.x, isoP.y, Phaser.Math.Between(4, 12))
      smoke.setDepth(49)
      this.scene.tweens.add({
        targets: smoke,
        alpha: 0,
        y: isoP.y - 30,
        delay: i * 80,
        duration: 600,
        onComplete: () => smoke.destroy(),
      })
    }

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 1000,
      onComplete: () => {
        this.emit('building_ready_to_remove', this)
        this.destroy()
      },
    })
  }

  // ── Private: construction ────────────────────────────────────

  private playConstructionAnimation(): void {
    this.setAlpha(0.3)
    this.constructionProgress = 0
    this.visualRoot.y = 14
    this.updateConstructionMask()
    this.drawConstructionOverlay()
  }

  private updateConstruction(delta: number): void {
    const buildTime = this.def.stats.buildTime * 1000 || 100
    this.constructionProgress = Math.min(1, this.constructionProgress + delta / buildTime)
    this.setAlpha(0.3 + this.constructionProgress * 0.7)
    this.visualRoot.y = (1 - this.constructionProgress) * 14
    this.updateConstructionMask()
    this.drawConstructionOverlay()

    if (this.constructionProgress >= 1) {
      this.state = 'active'
      this.visualRoot.y = 0
      this.bodyGraphic.clearMask(false)
      this.constructionOverlay.clear()
      this.constructionMaskShape.clear()
      this.drawBody()
      this.emit('construction_complete', this)
    }
  }

  private drawConstructionOverlay(): void {
    this.constructionOverlay.clear()
    const dims = this.getBoxDims()
    const totalH = dims.wallH + dims.halfH * 2
    const fillH = totalH * this.constructionProgress
    this.constructionOverlay.fillStyle(0xffff00, 0.25)
    this.constructionOverlay.fillRect(
      -dims.halfW,
      dims.baseY + dims.halfH - fillH,
      dims.halfW * 2,
      fillH,
    )
  }

  private updateConstructionMask(): void {
    const dims = this.getBoxDims()
    const totalH = dims.wallH + dims.halfH * 2 + 10
    const totalW = dims.halfW * 2 + 10
    const revealH = totalH * this.constructionProgress
    const bottomY = dims.baseY + dims.halfH + 5
    this.constructionMaskShape.clear()
    this.constructionMaskShape.fillStyle(0xffffff, 1)
    this.constructionMaskShape.fillRect(-totalW / 2, bottomY - revealH, totalW, revealH)
  }

  // ── Private: simple 3D box rendering ────────────────────────

  /** Compute box dimensions from footprint size */
  private getBoxDims(): { halfW: number; halfH: number; wallH: number; baseY: number; topY: number } {
    const fw = this.def.footprint.w
    const fh = this.def.footprint.h
    const maxFP = Math.max(fw, fh)
    const halfW = Math.max(16, maxFP * 18)
    const halfH = Math.max(8, maxFP * 9)
    const wallH = Math.max(16, (fw + fh) * 8)
    const baseY = 8
    return { halfW, halfH, wallH, baseY, topY: baseY - wallH }
  }

  /** Short label for building type */
  private getBuildingLabel(): string {
    const id = this.def.id
    if (
      id.includes('wall') || id.includes('turret') || id.includes('coil') ||
      id.includes('missile') || id.includes('cannon') || this.def.category === 'defense'
    ) return 'DEF'
    if (id.includes('barracks') || id.includes('cloning')) return 'BAR'
    if (id.includes('refinery') || id.includes('purifier')) return 'REF'
    if (id.includes('power') || id.includes('reactor') || id.includes('nuclear')) return 'PWR'
    if (
      id.includes('radar') || id.includes('sensor') ||
      id.includes('satellite') || id.includes('air_force')
    ) return 'RAD'
    if (
      id.includes('lab') || id.includes('tech') || id.includes('weapon') ||
      id.includes('chronosphere') || id.includes('iron_curtain')
    ) return 'LAB'
    if (
      id.includes('factory') || id.includes('yard') ||
      id.includes('construction') || this.def.category === 'production'
    ) return 'FAC'
    return 'BLD'
  }

  /** Draw a simple isometric 3D box: top face + front face + side face, solid faction colors */
  private drawBody(): void {
    const g = this.bodyGraphic
    g.clear()
    const dims = this.getBoxDims()
    const { halfW, halfH, baseY, topY } = dims

    // Low power: dim toward gray
    let baseColor = this.factionColor
    if (this.state === 'low_power') {
      baseColor = adjustBrightness(this.factionColor, -50)
    }

    const topColor = adjustBrightness(baseColor, 55)     // brightest — top face lit
    const frontColor = baseColor                          // faction color — front face
    const sideColor = adjustBrightness(baseColor, -55)   // darkest — side in shadow
    const outlineColor = adjustBrightness(baseColor, -100)

    // Top face (isometric diamond)
    g.fillStyle(topColor, 1)
    g.fillPoints([
      new Phaser.Geom.Point(0, topY - halfH),
      new Phaser.Geom.Point(halfW, topY),
      new Phaser.Geom.Point(0, topY + halfH),
      new Phaser.Geom.Point(-halfW, topY),
    ], true)

    // Front-left face
    g.fillStyle(frontColor, 1)
    g.fillPoints([
      new Phaser.Geom.Point(-halfW, topY),
      new Phaser.Geom.Point(0, topY + halfH),
      new Phaser.Geom.Point(0, baseY + halfH),
      new Phaser.Geom.Point(-halfW, baseY),
    ], true)

    // Front-right face (in shadow)
    g.fillStyle(sideColor, 1)
    g.fillPoints([
      new Phaser.Geom.Point(halfW, topY),
      new Phaser.Geom.Point(0, topY + halfH),
      new Phaser.Geom.Point(0, baseY + halfH),
      new Phaser.Geom.Point(halfW, baseY),
    ], true)

    // Outline edges
    g.lineStyle(1, outlineColor, 1)
    g.lineBetween(0, topY - halfH, halfW, topY)
    g.lineBetween(halfW, topY, 0, topY + halfH)
    g.lineBetween(0, topY + halfH, -halfW, topY)
    g.lineBetween(-halfW, topY, 0, topY - halfH)
    g.lineBetween(-halfW, topY, -halfW, baseY)
    g.lineBetween(halfW, topY, halfW, baseY)
    g.lineBetween(0, topY + halfH, 0, baseY + halfH)
    g.lineBetween(-halfW, baseY, 0, baseY + halfH)
    g.lineBetween(0, baseY + halfH, halfW, baseY)

    // Low power warning indicator
    if (this.state === 'low_power') {
      g.fillStyle(0xf29b3a, 1)
      g.fillRect(-3, topY + halfH * 0.2 - 3, 6, 6)
    }

    this.updateLabel(dims)
  }

  /** Place the text label on top of the box */
  private updateLabel(dims: { topY: number; halfH: number }): void {
    if (this.state === 'constructing') {
      this.labelText.setVisible(false)
      return
    }
    this.labelText.setText(this.getBuildingLabel())
    // Position centered on the top face
    this.labelText.setPosition(0, dims.topY + dims.halfH * 0.1)
    this.labelText.setColor(this.state === 'low_power' ? '#ffcc88' : '#ffffff')
    this.labelText.setVisible(true)
  }

  // ── Private: health bar ──────────────────────────────────────

  private drawHealthBar(): void {
    const g = this.healthBar
    g.clear()
    const pct = this.hp / this.def.stats.maxHp
    // Only show when damaged or selected
    if (pct >= 1 && !this.isSelected) return
    const w = this.def.footprint.w * TILE_SIZE
    const barW = w - 4
    const barH = 4
    const barY = -(this.def.footprint.h * TILE_SIZE) / 2 - 8

    // Black outline
    g.fillStyle(0x000000, 0.9)
    g.fillRect(-barW / 2 - 1, barY - 1, barW + 2, barH + 2)
    // Background
    g.fillStyle(0x333333, 0.8)
    g.fillRect(-barW / 2, barY, barW, barH)
    const isFriendly = this.playerId === 0
    const barColor = isFriendly
      ? (pct > 0.3 ? 0x4ade80 : 0x2f9e5a)
      : (pct > 0.3 ? 0xe94560 : 0x9f2436)
    g.fillStyle(barColor, 1)
    g.fillRect(-barW / 2, barY, barW * pct, barH)
  }

  // ── Private: selection / rally ───────────────────────────────

  private drawSelectionOutline(): void {
    const g = this.selectionOutline
    g.clear()
    if (!this.isSelected) return
    const tileSpan = this.def.footprint.w + this.def.footprint.h
    const width = Math.max(28, tileSpan * 28)
    const height = Math.max(12, tileSpan * 12)
    const cy = 22
    g.lineStyle(2, 0x00ffff, 0.9)
    g.strokeEllipse(0, cy, width, height)
  }

  private drawRallyLine(): void {
    const g = this.rallyLine
    g.clear()
    if (!this.isSelected || !this.rallyPoint) return
    const fromIso = cartToScreen(this.x, this.y)
    const toIso = cartToScreen(this.rallyPoint.x, this.rallyPoint.y)
    const fromX = 0
    const fromY = 8
    const toX = toIso.x - fromIso.x
    const toY = toIso.y - fromIso.y
    const segments = 16
    g.lineStyle(2, 0x8fdfff, 0.85)
    for (let i = 0; i < segments; i += 2) {
      const t0 = i / segments
      const t1 = (i + 1) / segments
      g.lineBetween(
        Phaser.Math.Linear(fromX, toX, t0),
        Phaser.Math.Linear(fromY, toY, t0),
        Phaser.Math.Linear(fromX, toX, t1),
        Phaser.Math.Linear(fromY, toY, t1),
      )
    }
    g.fillStyle(0x8fdfff, 0.9)
    g.fillCircle(toX, toY, 3)
  }

  // ── Private: render transform ────────────────────────────────

  private updateRenderTransform(): void {
    const isoPos = cartToScreen(this.x, this.y)
    this.visualRoot?.setPosition(isoPos.x - this.x, isoPos.y - this.y)
    this.setDepth(isoPos.y + 5)
    this.drawRallyLine()
  }

  // ── Private: production / combat ─────────────────────────────

  private updateProductionVisuals(): void {
    if (this.productionQueue.length === 0) return
    const item = this.productionQueue[0]
    this.emit('production_progress', this.id, item.defId, item.progress)
  }

  private updateCombat(): void {
    if (this.state !== 'active' || !this.def.attack || this.attackCooldown > 0) return

    const attack = this.def.attack
    const rangePixels = attack.range * TILE_SIZE

    this.emit('find_enemy', this.x, this.y, rangePixels, this.playerId, (enemies: Array<{ id: string; x: number; y: number; hp: number; def?: { category?: string } }>) => {
      if (enemies.length === 0) return

      let nearest: { id: string; x: number; y: number; hp: number; def?: { category?: string } } | null = null
      let nearestDist = Infinity

      for (const e of enemies) {
        const cat = e.def?.category ?? 'vehicle'
        const isAir = cat === 'aircraft'
        const isGround = !isAir

        if (isAir && !attack.canAttackAir) continue
        if (isGround && !attack.canAttackGround) continue

        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y)
        if (d < nearestDist) {
          nearestDist = d
          nearest = e
        }
      }

      if (!nearest) return

      this.emit('fire_at_target', this, nearest)
      this.playDefenseMuzzleFlash(nearest.x, nearest.y)
      this.attackCooldown = 1 / attack.fireRate
    })
  }

  private playDefenseMuzzleFlash(targetX: number, targetY: number): void {
    const iso = cartToScreen(this.x, this.y)
    const flash = this.scene.add.graphics()
    const dir = new Phaser.Math.Vector2(targetX - this.x, targetY - this.y)
    if (dir.lengthSq() < 0.0001) dir.set(1, 0)
    dir.normalize()
    const sx = iso.x + dir.x * 10
    const sy = iso.y - 10 + dir.y * 6
    flash.fillStyle(0xffee66, 0.95)
    flash.fillCircle(sx, sy, 3)
    flash.lineStyle(2, 0xffbb44, 0.9)
    flash.lineBetween(sx, sy, sx + dir.x * 10, sy + dir.y * 6)
    flash.setDepth(60)
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 120,
      onComplete: () => flash.destroy(),
    })
  }
}
