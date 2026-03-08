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
type FacilityVisualType = 'factory' | 'barracks' | 'refinery' | 'power' | 'radar' | 'lab' | 'defense'

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
  private dropShadow: Phaser.GameObjects.Graphics
  private bodyGraphic: Phaser.GameObjects.Graphics
  private crackOverlay: Phaser.GameObjects.Graphics
  private healthBar: Phaser.GameObjects.Graphics
  private selectionOutline: Phaser.GameObjects.Graphics
  private rallyLine: Phaser.GameObjects.Graphics
  private constructionOverlay: Phaser.GameObjects.Graphics
  private constructionMaskShape: Phaser.GameObjects.Graphics
  private constructionMask: Phaser.Display.Masks.GeometryMask
  private statusText: Phaser.GameObjects.Text
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
    this.dropShadow = scene.add.graphics()
    this.selectionOutline = scene.add.graphics()
    this.rallyLine = scene.add.graphics()
    this.constructionOverlay = scene.add.graphics()
    this.constructionMaskShape = scene.add.graphics().setAlpha(0)
    this.bodyGraphic = scene.add.graphics()
    this.crackOverlay = scene.add.graphics()
    this.healthBar = scene.add.graphics()
    this.statusText = scene.add.text(0, 0, def.name.slice(0, 4).toUpperCase(), {
      fontSize: '7px',
      color: '#ffffff',
      resolution: 2,
    }).setOrigin(0.5, 0.5)

    this.visualRoot.add([
      this.dropShadow,
      this.selectionOutline,
      this.rallyLine,
      this.constructionOverlay,
      this.constructionMaskShape,
      this.bodyGraphic,
      this.crackOverlay,
      this.healthBar,
      this.statusText,
    ])
    this.add(this.visualRoot)

    this.drawBody()
    this.drawHealthBar()
    this.drawSelectionOutline()
    this.constructionMask = this.constructionMaskShape.createGeometryMask()
    this.bodyGraphic.setMask(this.constructionMask)
    this.crackOverlay.setMask(this.constructionMask)
    // NOTE: Do NOT setTint on Graphics — it multiplicatively washes out the manually-drawn colors

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

    // Flash red on hit
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
    // Start with zero alpha, build up from bottom
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
      // Remove the construction mask so the full building is visible
      this.bodyGraphic.clearMask(false)
      this.crackOverlay.clearMask(false)
      this.constructionOverlay.clear()
      this.constructionMaskShape.clear()
      this.drawBody()
      this.emit('construction_complete', this)
    }
  }

  private drawConstructionOverlay(): void {
    this.constructionOverlay.clear()
    const w = this.def.footprint.w * TILE_SIZE
    const h = this.def.footprint.h * TILE_SIZE
    const fillH = h * this.constructionProgress

    this.constructionOverlay.fillStyle(0xffff00, 0.3)
    this.constructionOverlay.fillRect(-w / 2, h / 2 - fillH, w, fillH)

    // Construction stripes
    this.constructionOverlay.lineStyle(1, 0xffff00, 0.5)
    this.constructionOverlay.strokeRect(-w / 2, h / 2 - fillH, w, fillH)
  }

  private updateConstructionMask(): void {
    const dims = this.getIsoDims()
    // Full bounding box of the iso building (from top of roof to bottom of base)
    const totalH = (dims.halfH + dims.wallH + dims.halfH) + 30  // generous padding
    const totalW = dims.halfW * 2 + 20
    const revealH = totalH * this.constructionProgress
    const bottomY = dims.baseY + dims.halfH + 15
    this.constructionMaskShape.clear()
    this.constructionMaskShape.fillStyle(0xffffff, 1)
    this.constructionMaskShape.fillRect(-totalW / 2, bottomY - revealH, totalW, revealH)
  }

  // ── Private: visuals ─────────────────────────────────────────

  private drawBody(): void {
    const g = this.bodyGraphic
    g.clear()
    const dims = this.getIsoDims()
    this.drawDropShadow(dims)
    const pct = this.hp / this.def.stats.maxHp
    const visualType = this.getFacilityVisualType()
    const palette = this.getBuildingPalette(pct, visualType)

    this.drawIsoBox(g, dims, palette)
    this.drawBuildingDetails(g, dims, visualType, palette.line)
    this.drawDamageOverlay(pct)

    if (this.state === 'low_power') {
      this.drawLowPowerWarning(g, dims)
    }
  }

  private getIsoDims(): { halfW: number; halfH: number; wallH: number; baseY: number; topY: number } {
    const maxFootprint = Math.max(this.def.footprint.w, this.def.footprint.h)
    const halfW = Math.max(16, maxFootprint * 16)
    const halfH = Math.max(8, Math.round(halfW / 2))
    const baseY = 14

    let wallH = 24 + Math.max(0, maxFootprint - 2) * 4
    switch (this.def.id) {
      case 'construction_yard':
      case 'war_factory':
      case 'air_force_command':
      case 'radar_tower':
      case 'oil_derrick':
      case 'nuclear_silo':
        wallH += 12
        break
      case 'tesla_coil':
      case 'prism_tower':
        wallH += 10
        break
      case 'power_plant':
      case 'ore_refinery':
      case 'battle_lab':
      case 'tech_center':
      case 'barracks':
      case 'tesla_reactor':
      case 'nuclear_reactor':
        wallH += 3
        break
      case 'pillbox':
      case 'sentry_gun':
      case 'fortress_wall':
      case 'patriot_missile':
      case 'flak_cannon':
        wallH = 12
        break
    }

    return { halfW, halfH, wallH, baseY, topY: baseY - wallH }
  }

  private getFacilityVisualType(): FacilityVisualType {
    const id = this.def.id
    if (
      id.includes('wall') ||
      id.includes('turret') ||
      id.includes('coil') ||
      id.includes('missile') ||
      id.includes('cannon') ||
      this.def.category === 'defense'
    ) return 'defense'
    if (id.includes('refinery') || id.includes('purifier')) return 'refinery'
    if (id.includes('power') || id.includes('reactor') || id.includes('nuclear')) return 'power'
    if (id.includes('radar') || id.includes('sensor') || id.includes('satellite') || id.includes('air_force')) return 'radar'
    if (
      id.includes('lab') ||
      id.includes('tech') ||
      id.includes('weapon') ||
      id.includes('chronosphere') ||
      id.includes('iron_curtain')
    ) return 'lab'
    if (id.includes('barracks') || id.includes('cloning')) return 'barracks'
    if (id.includes('factory') || id.includes('yard') || this.def.category === 'production') return 'factory'
    return 'factory'
  }

  private getBuildingPalette(pct: number, visualType: FacilityVisualType): { top: number; left: number; right: number; line: number } {
    const lowPower = this.state === 'low_power'
    let main = lowPower ? 0x7a6a4e : this.factionColor
    if (pct < 0.5) main = adjustBrightness(main, -45)

    switch (visualType) {
      case 'factory':
        main = this.blendColors(main, 0x6f6f6f, 0.38)
        break
      case 'barracks':
        main = this.blendColors(main, 0x8b6b5f, 0.28)
        break
      case 'refinery':
        main = this.blendColors(main, 0x8d7a42, 0.42)
        break
      case 'power':
        main = this.blendColors(main, 0x4a6f8d, 0.33)
        break
      case 'radar':
        main = this.blendColors(main, 0x547f90, 0.34)
        break
      case 'lab':
        main = this.blendColors(main, 0x6277a5, 0.36)
        break
      case 'defense':
        main = this.blendColors(main, 0x4f555f, 0.42)
        break
    }
    if (this.def.category === 'superweapon') main = this.blendColors(main, 0x7a3b20, 0.25)

    return {
      top: adjustBrightness(main, 30),
      left: adjustBrightness(main, 8),
      right: adjustBrightness(main, -24),
      line: adjustBrightness(main, -46),
    }
  }

  private blendColors(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff
    const ag = (a >> 8) & 0xff
    const ab = a & 0xff
    const br = (b >> 16) & 0xff
    const bg = (b >> 8) & 0xff
    const bb = b & 0xff
    const r = Math.round(ar + (br - ar) * t)
    const g = Math.round(ag + (bg - ag) * t)
    const c = Math.round(ab + (bb - ab) * t)
    return (r << 16) | (g << 8) | c
  }

  private drawIsoBox(
    g: Phaser.GameObjects.Graphics,
    dims: { halfW: number; halfH: number; wallH: number; baseY: number; topY: number },
    palette: { top: number; left: number; right: number; line: number },
  ): void {
    const { halfW, halfH, baseY, topY } = dims

    const topFace = [
      new Phaser.Geom.Point(0, topY - halfH),
      new Phaser.Geom.Point(halfW, topY),
      new Phaser.Geom.Point(0, topY + halfH),
      new Phaser.Geom.Point(-halfW, topY),
    ]
    g.fillStyle(palette.top, 1)
    g.fillPoints(topFace, true)

    const leftFace = [
      new Phaser.Geom.Point(-halfW, topY),
      new Phaser.Geom.Point(0, topY + halfH),
      new Phaser.Geom.Point(0, baseY + halfH),
      new Phaser.Geom.Point(-halfW, baseY),
    ]
    g.fillStyle(palette.left, 1)
    g.fillPoints(leftFace, true)

    const rightFace = [
      new Phaser.Geom.Point(halfW, topY),
      new Phaser.Geom.Point(0, topY + halfH),
      new Phaser.Geom.Point(0, baseY + halfH),
      new Phaser.Geom.Point(halfW, baseY),
    ]
    g.fillStyle(palette.right, 1)
    g.fillPoints(rightFace, true)

    g.lineStyle(1, palette.line, 0.5)
    g.lineBetween(0, topY - halfH, halfW, topY)
    g.lineBetween(halfW, topY, 0, topY + halfH)
    g.lineBetween(0, topY + halfH, -halfW, topY)
    g.lineBetween(-halfW, topY, 0, topY - halfH)
    g.lineBetween(-halfW, topY, -halfW, baseY)
    g.lineBetween(halfW, topY, halfW, baseY)
    g.lineBetween(0, topY + halfH, 0, baseY + halfH)
    g.lineBetween(-halfW, baseY, 0, baseY + halfH)
    g.lineBetween(0, baseY + halfH, halfW, baseY)
  }

  private drawDropShadow(dims: { halfW: number; halfH: number; wallH: number; baseY: number; topY: number }): void {
    const s = this.dropShadow
    s.clear()
    const y = dims.baseY + 8
    const hw = dims.halfW * 1.05
    const hh = Math.max(4, dims.halfH * 0.55)
    s.fillStyle(0x000000, 0.22)
    s.fillPoints([
      new Phaser.Geom.Point(0, y - hh),
      new Phaser.Geom.Point(hw, y),
      new Phaser.Geom.Point(0, y + hh),
      new Phaser.Geom.Point(-hw, y),
    ], true)
  }

  private drawBuildingDetails(
    g: Phaser.GameObjects.Graphics,
    dims: { halfW: number; halfH: number; wallH: number; baseY: number; topY: number },
    visualType: FacilityVisualType,
    lineColor: number,
  ): void {
    const hw = dims.halfW
    const hh = dims.halfH
    const roofY = dims.topY
    const wallY = dims.topY + hh * 0.7
    const detailW = Math.max(8, hw * 0.28)
    const detailH = Math.max(5, hh * 0.45)
    const accent = adjustBrightness(lineColor, 42)
    const accentDark = adjustBrightness(lineColor, -8)

    g.fillStyle(adjustBrightness(lineColor, -20), 1)
    g.fillRect(-detailW * 0.5, wallY, detailW, detailH)

    switch (visualType) {
      case 'power':
        g.fillStyle(0xf4d447, 1)
        g.fillRect(-3, roofY - hh * 0.78, 6, 12)
        break
      case 'factory':
        g.fillStyle(0xa9b7c9, 1)
        g.fillRect(hw * 0.22, roofY - hh * 0.35, detailW, detailH)
        g.fillStyle(0x5b5b5b, 1)
        g.fillRect(-hw * 0.6, dims.baseY + hh * 0.08, hw * 1.2, 4)
        break
      case 'defense':
        g.fillStyle(0x3b3b3b, 1)
        g.fillRect(-4, roofY - hh * 0.95, 8, 14)
        g.fillStyle(0x222222, 1)
        g.fillRect(4, roofY - hh * 0.78, hw * 0.34, 3)
        break
      case 'lab':
        g.fillStyle(0x88c8ff, 1)
        g.fillRect(-5, roofY - hh * 0.65, 10, 10)
        break
      case 'barracks':
        g.fillStyle(0xd6d6d6, 1)
        g.fillRect(-2, roofY - hh * 0.92, 4, 13)
        g.fillStyle(0xd64b4b, 1)
        g.fillTriangle(3, roofY - hh * 1.12, 8, roofY - hh * 0.95, 3, roofY - hh * 0.78)
        break
      case 'refinery':
        g.fillStyle(0xffb347, 1)
        g.fillRect(-6, roofY - hh * 0.82, 12, 14)
        g.fillStyle(0xd7b24f, 1)
        g.fillCircle(6, roofY - hh * 0.35, 2)
        break
      case 'radar':
        g.fillStyle(0xb8d6ef, 1)
        g.fillRect(-8, roofY - hh * 1.05, 16, 5)
        g.lineStyle(2, 0x92deff, 1)
        g.lineBetween(5, roofY - hh * 0.1, 5, roofY - hh * 0.8)
        g.strokeCircle(5, roofY - hh * 0.8, 3)
        break
    }
    if (this.def.id === 'tesla_coil' || this.def.id === 'prism_tower' || this.def.id === 'nuclear_silo') {
      g.fillStyle(0x9fd2ff, 1)
      g.fillRect(-3, roofY - hh * 1.15, 6, 12)
    }

    this.drawFacilitySymbol(g, dims, visualType, accent, accentDark)
  }

  private drawFacilitySymbol(
    g: Phaser.GameObjects.Graphics,
    dims: { halfW: number; halfH: number; wallH: number; baseY: number; topY: number },
    visualType: FacilityVisualType,
    fillColor: number,
    lineColor: number,
  ): void {
    const cy = dims.topY - dims.halfH * 0.24
    const w = Math.max(10, dims.halfW * 0.42)
    const h = Math.max(8, dims.halfH * 0.62)

    g.fillStyle(0x1a1a1a, 1)
    g.fillRect(-w / 2 - 1, cy - h / 2 - 1, w + 2, h + 2)
    g.fillStyle(fillColor, 1)
    g.fillRect(-w / 2, cy - h / 2, w, h)
    g.lineStyle(1, lineColor, 1)
    g.strokeRect(-w / 2, cy - h / 2, w, h)

    switch (visualType) {
      case 'factory':
        g.fillStyle(lineColor, 1)
        g.fillRect(-2, cy - 3, 4, 6)
        g.fillRect(-5, cy - 1, 10, 2)
        break
      case 'barracks':
        g.lineStyle(1.5, lineColor, 1)
        g.lineBetween(-4, cy + 2, 0, cy - 2)
        g.lineBetween(0, cy - 2, 4, cy + 2)
        g.lineBetween(-4, cy - 1, 0, cy - 5)
        g.lineBetween(0, cy - 5, 4, cy - 1)
        break
      case 'refinery':
        g.fillStyle(lineColor, 1)
        g.fillCircle(-3, cy, 2)
        g.fillRect(0, cy - 3, 4, 6)
        break
      case 'power':
        g.fillStyle(lineColor, 1)
        g.fillPoints([
          new Phaser.Geom.Point(-2, cy - 4),
          new Phaser.Geom.Point(2, cy - 4),
          new Phaser.Geom.Point(-1, cy + 1),
          new Phaser.Geom.Point(2, cy + 1),
          new Phaser.Geom.Point(-3, cy + 5),
          new Phaser.Geom.Point(-1, cy),
        ], true)
        break
      case 'radar':
        g.lineStyle(1.5, lineColor, 1)
        g.lineBetween(0, cy + 3, 0, cy - 3)
        g.strokeCircle(0, cy - 3, 3)
        break
      case 'lab':
        g.lineStyle(1.5, lineColor, 1)
        g.strokeRect(-3, cy - 4, 6, 7)
        g.lineBetween(-2, cy - 1, 2, cy -1)
        break
      case 'defense':
        g.fillStyle(lineColor, 1)
        g.fillPoints([
          new Phaser.Geom.Point(0, cy - 4),
          new Phaser.Geom.Point(4, cy - 1),
          new Phaser.Geom.Point(3, cy + 4),
          new Phaser.Geom.Point(-3, cy + 4),
          new Phaser.Geom.Point(-4, cy - 1),
        ], true)
        break
    }
  }

  private drawLowPowerWarning(
    g: Phaser.GameObjects.Graphics,
    dims: { halfW: number; halfH: number; wallH: number; baseY: number; topY: number },
  ): void {
    const w = Math.max(14, dims.halfW * 0.5)
    const h = 8
    const y = dims.topY - dims.halfH - 3

    g.fillStyle(0x2b1000, 1)
    g.fillRect(-w / 2 - 1, y - 1, w + 2, h + 2)
    g.fillStyle(0xff7b2f, 1)
    g.fillRect(-w / 2, y, w, h)
    g.fillStyle(0x2b1000, 1)
    g.fillRect(-w / 2 + 2, y + 2, 2, h - 4)
    g.fillRect(-1, y + 2, 2, h - 4)
    g.fillRect(w / 2 - 4, y + 2, 2, h - 4)
  }

  private drawDamageOverlay(pct: number): void {
    this.crackOverlay.clear()
    if (pct >= 0.5 || this.state === 'constructing' || this.state === 'dying') return
    const dims = this.getIsoDims()
    const y = dims.topY + dims.halfH * 0.35
    this.crackOverlay.lineStyle(1.5, 0x1a1a1a, 0.8)
    this.crackOverlay.lineBetween(-dims.halfW * 0.2, y - 10, -dims.halfW * 0.04, y - 1)
    this.crackOverlay.lineBetween(-dims.halfW * 0.04, y - 1, dims.halfW * 0.16, y + 8)
    this.crackOverlay.lineBetween(dims.halfW * 0.16, y + 8, dims.halfW * 0.07, y + 14)
    this.crackOverlay.lineBetween(-dims.halfW * 0.04, y - 1, -dims.halfW * 0.14, y + 7)
  }

  private updateRenderTransform(): void {
    const isoPos = cartToScreen(this.x, this.y)
    this.visualRoot?.setPosition(isoPos.x - this.x, isoPos.y - this.y)
    this.setDepth(isoPos.y + 5)
    this.drawRallyLine()
  }

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

  private updateProductionVisuals(): void {
    if (this.productionQueue.length === 0) return
    const item = this.productionQueue[0]
    // Production progress is drawn as overlay on the health bar area
    // The full progress bar rendering is handled by the UI layer (Agent 3)
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
