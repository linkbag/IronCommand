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
    ;(this.bodyGraphic as Phaser.GameObjects.Graphics & { setTint?: (value: number) => unknown }).setTint?.(this.factionColor)

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
      this.updateConstructionMask()
      this.constructionOverlay.clear()
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
    const w = this.def.footprint.w * TILE_SIZE
    const h = this.def.footprint.h * TILE_SIZE + 22
    const revealH = h * this.constructionProgress
    this.constructionMaskShape.clear()
    this.constructionMaskShape.fillStyle(0xffffff, 1)
    this.constructionMaskShape.fillRect(-w / 2 - 10, h / 2 - revealH, w + 20, revealH + 8)
  }

  // ── Private: visuals ─────────────────────────────────────────

  private drawBody(): void {
    const g = this.bodyGraphic
    g.clear()
    const dims = this.getIsoDims()
    this.drawDropShadow(dims)
    const pct = this.hp / this.def.stats.maxHp
    const palette = this.getBuildingPalette(pct)

    this.drawIsoBox(g, dims, palette)
    this.drawBuildingDetails(g, dims)
    this.drawDamageOverlay(pct)

    if (this.state === 'low_power') {
      g.lineStyle(2, 0xff4400, 0.8)
      g.strokeEllipse(0, dims.baseY - dims.wallH * 0.08, dims.halfW * 1.35, dims.halfH * 1.35)
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

  private getBuildingPalette(pct: number): { top: number; left: number; right: number; line: number } {
    const lowPower = this.state === 'low_power'
    let main = lowPower ? 0x7a6a4e : this.factionColor
    if (pct < 0.5) main = adjustBrightness(main, -45)
    if (this.def.id === 'tesla_reactor' || this.def.id === 'tesla_coil') {
      main = this.blendColors(main, 0x7b1d1d, 0.45)
    } else if (this.def.id === 'power_plant' || this.def.id === 'battle_lab') {
      main = this.blendColors(main, 0x90b8c8, 0.3)
    } else if (this.def.id === 'war_factory' || this.def.id === 'ore_refinery' || this.def.id === 'construction_yard') {
      main = this.blendColors(main, 0x6f6f6f, 0.4)
    }

    return {
      top: adjustBrightness(main, 32),
      left: adjustBrightness(main, 10),
      right: adjustBrightness(main, -22),
      line: adjustBrightness(main, -44),
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

  private fillPolygon(g: Phaser.GameObjects.Graphics, points: Array<{ x: number; y: number }>): void {
    if (points.length === 0) return
    g.beginPath()
    g.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
    g.closePath()
    g.fillPath()
  }

  private drawIsoBox(
    g: Phaser.GameObjects.Graphics,
    dims: { halfW: number; halfH: number; wallH: number; baseY: number; topY: number },
    palette: { top: number; left: number; right: number; line: number },
  ): void {
    const top = { x: 0, y: dims.topY - dims.halfH }
    const right = { x: dims.halfW, y: dims.topY }
    const bottom = { x: 0, y: dims.topY + dims.halfH }
    const left = { x: -dims.halfW, y: dims.topY }
    const leftBottom = { x: -dims.halfW, y: dims.baseY }
    const rightBottom = { x: dims.halfW, y: dims.baseY }
    const centerBottom = { x: 0, y: dims.baseY + dims.halfH }

    g.fillStyle(palette.left, 1)
    this.fillPolygon(g, [left, bottom, centerBottom, leftBottom])
    g.fillStyle(palette.right, 1)
    this.fillPolygon(g, [right, bottom, centerBottom, rightBottom])
    g.fillStyle(palette.top, 1)
    this.fillPolygon(g, [top, right, bottom, left])

    g.lineStyle(1, palette.line, 0.75)
    g.strokeLineShape(new Phaser.Geom.Line(top.x, top.y, right.x, right.y))
    g.strokeLineShape(new Phaser.Geom.Line(right.x, right.y, bottom.x, bottom.y))
    g.strokeLineShape(new Phaser.Geom.Line(bottom.x, bottom.y, left.x, left.y))
    g.strokeLineShape(new Phaser.Geom.Line(left.x, left.y, top.x, top.y))
    g.strokeLineShape(new Phaser.Geom.Line(left.x, left.y, leftBottom.x, leftBottom.y))
    g.strokeLineShape(new Phaser.Geom.Line(right.x, right.y, rightBottom.x, rightBottom.y))
    g.strokeLineShape(new Phaser.Geom.Line(bottom.x, bottom.y, centerBottom.x, centerBottom.y))
  }

  private drawDropShadow(dims: { halfW: number; halfH: number; wallH: number; baseY: number; topY: number }): void {
    const s = this.dropShadow
    s.clear()
    s.fillStyle(0x000000, 0.35)
    s.fillEllipse(0, dims.baseY + 10, dims.halfW * 2.1, Math.max(12, dims.halfH * 1.5))
  }

  private drawBuildingDetails(
    g: Phaser.GameObjects.Graphics,
    dims: { halfW: number; halfH: number; wallH: number; baseY: number; topY: number },
  ): void {
    const hw = dims.halfW
    const hh = dims.halfH
    const roofY = dims.topY
    const wallTop = dims.topY + 2
    const wallBottom = dims.baseY + hh - 2

    switch (this.def.id) {
      case 'construction_yard':
        g.fillStyle(0xd8bf57, 0.95)
        g.fillRect(hw * 0.35, roofY - hh * 1.1, 5, hh * 1.8)
        g.fillTriangle(hw * 0.37, roofY - hh * 1.05, -hw * 0.2, roofY - hh * 1.15, hw * 0.85, roofY - hh * 1.3)
        g.lineStyle(1, 0xd9d9d9, 0.6)
        for (let i = 0; i < 4; i++) {
          const y = Phaser.Math.Linear(wallTop, wallBottom, i / 3)
          g.lineBetween(-hw * 0.75, y, -hw * 0.15, y + hh * 0.25)
        }
        return
      case 'barracks':
        g.fillStyle(0x1d2a1f, 0.82)
        g.fillRect(-hw * 0.16, wallBottom - hh * 0.85, hw * 0.32, hh * 0.82)
        g.lineStyle(2, 0xc4c4c4, 0.9)
        g.lineBetween(hw * 0.52, roofY - hh * 0.75, hw * 0.52, roofY - hh * 1.3)
        g.fillStyle(0x6e7d2d, 0.95)
        g.fillTriangle(hw * 0.52, roofY - hh * 1.28, hw * 0.95, roofY - hh * 1.18, hw * 0.52, roofY - hh * 1.08)
        return
      case 'war_factory':
        g.fillStyle(0x343434, 0.85)
        g.fillRect(-hw * 0.5, wallBottom - hh * 1.0, hw * 1.0, hh * 0.95)
        g.lineStyle(1.5, 0x7b7b7b, 0.9)
        for (let y = wallBottom - hh * 0.95; y <= wallBottom - hh * 0.1; y += 4) {
          g.lineBetween(-hw * 0.48, y, hw * 0.48, y)
        }
        g.fillStyle(0x4b4b4b, 1)
        g.fillRect(hw * 0.56, roofY - hh * 0.95, 7, hh * 1.3)
        g.fillStyle(0x909090, 0.45)
        g.fillCircle(hw * 0.6, roofY - hh * 1.1, 5)
        g.fillStyle(0x605949, 0.8)
        g.fillRect(-hw * 0.8, wallBottom - hh * 0.35, hw * 0.42, 4)
        return
      case 'ore_refinery':
        g.fillStyle(0x8f6f2c, 0.88)
        g.fillTriangle(-hw * 0.28, roofY - hh * 0.25, hw * 0.3, roofY - hh * 0.25, 0, roofY - hh * 0.95)
        g.fillStyle(0x6d5a3b, 0.9)
        g.fillTriangle(-hw * 0.82, wallBottom - hh * 0.25, -hw * 0.1, wallBottom - hh * 0.25, -hw * 0.62, wallBottom - hh * 0.8)
        g.fillStyle(0xd6a645, 0.9)
        g.fillCircle(-hw * 0.72, wallBottom - hh * 0.2, 2)
        g.fillCircle(-hw * 0.61, wallBottom - hh * 0.15, 2)
        g.fillStyle(0x2f2f2f, 0.85)
        g.fillRect(hw * 0.1, wallBottom - hh * 0.9, hw * 0.5, hh * 0.82)
        return
      case 'power_plant':
        g.fillStyle(0x86b8a2, 0.95)
        g.fillEllipse(0, roofY - hh * 0.3, hw * 1.1, hh * 0.9)
        g.fillStyle(0x3b5450, 0.95)
        g.fillRect(hw * 0.42, roofY - hh * 0.9, 5, hh * 0.95)
        g.fillRect(hw * 0.6, roofY - hh * 0.8, 4, hh * 0.8)
        return
      case 'tesla_reactor':
        g.fillStyle(0x3d4248, 1)
        g.fillEllipse(0, roofY - hh * 0.25, hw * 1.08, hh * 0.86)
        g.fillStyle(0x8f2020, 0.95)
        g.fillRect(0, roofY - hh * 1.0, 4, hh * 0.7)
        g.lineStyle(1.2, 0x6ab4ff, 0.9)
        g.lineBetween(2, roofY - hh * 1.0, -8, roofY - hh * 1.2)
        g.lineBetween(-8, roofY - hh * 1.2, 7, roofY - hh * 1.27)
        return
      case 'air_force_command':
        g.fillStyle(0x4c5b6f, 0.95)
        g.fillRect(-hw * 0.14, roofY - hh * 1.25, hw * 0.28, hh * 1.2)
        g.fillStyle(0xa5b6c9, 0.95)
        g.fillCircle(0, roofY - hh * 1.35, 7)
        g.lineStyle(1.3, 0x7fb3ff, 0.65)
        g.strokeCircle(0, roofY - hh * 1.35, 10)
        g.lineStyle(1.2, 0xe5e5e5, 0.6)
        g.lineBetween(-hw * 0.55, roofY - hh * 0.7, hw * 0.55, roofY - hh * 0.32)
        g.lineBetween(-hw * 0.45, roofY - hh * 0.42, hw * 0.45, roofY - hh * 0.06)
        return
      case 'radar_tower':
        g.fillStyle(0x464646, 0.95)
        g.fillRect(-4, roofY - hh * 1.4, 8, hh * 1.45)
        g.fillStyle(0x93a9bd, 0.95)
        g.fillEllipse(0, roofY - hh * 1.48, hw * 0.7, hh * 0.45)
        g.lineStyle(1, 0xdceeff, 0.65)
        g.lineBetween(-hw * 0.2, roofY - hh * 1.5, hw * 0.35, roofY - hh * 1.42)
        g.lineBetween(hw * 0.26, roofY - hh * 1.2, hw * 0.45, roofY - hh * 1.6)
        return
      case 'battle_lab':
        g.fillStyle(0xcedeef, 0.95)
        g.fillEllipse(0, roofY - hh * 0.3, hw * 1.05, hh * 0.78)
        g.fillStyle(0x6cc9ff, 0.85)
        g.fillCircle(-hw * 0.3, roofY - hh * 0.75, 3)
        g.fillCircle(hw * 0.2, roofY - hh * 0.7, 3)
        g.lineStyle(1.2, 0x84d8ff, 0.8)
        g.lineBetween(-hw * 0.3, roofY - hh * 0.75, hw * 0.2, roofY - hh * 0.7)
        return
      case 'tech_center':
        g.fillStyle(0x7b8794, 0.88)
        for (let i = 0; i < 4; i++) {
          const y = Phaser.Math.Linear(wallTop + hh * 0.2, wallBottom - hh * 0.12, i / 3)
          g.lineStyle(1.2, 0x4e5861, 0.85)
          g.lineBetween(-hw * 0.64, y, -hw * 0.14, y + hh * 0.2)
        }
        g.lineStyle(1.4, 0xbec8cf, 0.9)
        g.lineBetween(hw * 0.38, roofY - hh * 0.2, hw * 0.38, roofY - hh * 0.95)
        g.lineBetween(hw * 0.26, roofY - hh * 0.7, hw * 0.5, roofY - hh * 0.7)
        return
      case 'tesla_coil':
        g.fillStyle(0x3f4752, 1)
        g.fillRect(-5, roofY - hh * 1.5, 10, hh * 1.52)
        g.fillStyle(0x9fb6cc, 0.95)
        g.fillCircle(0, roofY - hh * 1.55, 4)
        g.lineStyle(1.6, 0x77beff, 1)
        g.lineBetween(0, roofY - hh * 1.55, -9, roofY - hh * 1.9)
        g.lineBetween(-9, roofY - hh * 1.9, 8, roofY - hh * 1.97)
        g.lineBetween(8, roofY - hh * 1.97, -4, roofY - hh * 1.72)
        return
      case 'prism_tower':
        g.fillStyle(0x46505b, 0.98)
        g.fillRect(-4, roofY - hh * 1.45, 8, hh * 1.45)
        g.fillStyle(0xa8e6ff, 0.96)
        g.fillTriangle(0, roofY - hh * 1.9, -9, roofY - hh * 1.45, 9, roofY - hh * 1.45)
        g.lineStyle(1.2, 0xe5fbff, 0.85)
        g.lineBetween(0, roofY - hh * 1.88, -2, roofY - hh * 1.62)
        g.lineBetween(0, roofY - hh * 1.88, 2, roofY - hh * 1.62)
        g.lineStyle(1.1, 0x9bd6ff, 0.7)
        g.lineBetween(0, roofY - hh * 1.6, hw * 0.48, roofY - hh * 1.15)
        return
      case 'pillbox':
      case 'sentry_gun':
        g.fillStyle(0x6d6d6d, 0.92)
        g.fillEllipse(0, roofY - hh * 0.22, hw * 0.92, hh * 0.72)
        g.fillStyle(0x303030, 1)
        g.fillRect(hw * 0.2, roofY - hh * 0.38, hw * 0.42, 4)
        g.lineStyle(1, 0xa59172, 0.6)
        g.lineBetween(-hw * 0.5, dims.baseY + hh * 0.2, hw * 0.5, dims.baseY + hh * 0.2)
        return
      case 'fortress_wall':
        g.fillStyle(0x8a8a8a, 0.9)
        g.fillRect(-hw * 0.75, wallBottom - hh * 0.55, hw * 1.5, hh * 0.42)
        g.lineStyle(1, 0x676767, 0.8)
        g.lineBetween(-hw * 0.55, wallBottom - hh * 0.2, -hw * 0.3, wallBottom - hh * 0.35)
        g.lineBetween(hw * 0.3, wallBottom - hh * 0.35, hw * 0.55, wallBottom - hh * 0.2)
        return
      case 'oil_derrick':
        g.lineStyle(2, 0x9e9e9e, 0.9)
        g.lineBetween(-hw * 0.3, wallBottom - hh * 0.2, 0, roofY - hh * 1.3)
        g.lineBetween(hw * 0.3, wallBottom - hh * 0.2, 0, roofY - hh * 1.3)
        g.lineBetween(-hw * 0.15, wallBottom - hh * 0.55, hw * 0.15, wallBottom - hh * 0.55)
        g.lineBetween(-hw * 0.08, wallBottom - hh * 0.9, hw * 0.08, wallBottom - hh * 0.9)
        g.lineStyle(2, 0x666666, 0.8)
        g.lineBetween(hw * 0.08, roofY - hh * 1.1, hw * 0.58, roofY - hh * 0.82)
        g.fillStyle(0x7b7b7b, 0.95)
        g.fillCircle(hw * 0.6, roofY - hh * 0.82, 3)
        return
      case 'nuclear_silo':
        g.fillStyle(0x3d3d3d, 0.9)
        g.fillRect(-hw * 0.36, roofY - hh * 0.2, hw * 0.72, hh * 0.26)
        g.lineStyle(1.4, 0xcfa34a, 0.9)
        g.lineBetween(-hw * 0.32, roofY - hh * 0.08, hw * 0.32, roofY - hh * 0.08)
        g.fillStyle(0x5a5a5a, 0.92)
        g.fillRect(-hw * 0.08, roofY - hh * 1.15, hw * 0.16, hh * 1.05)
        g.lineStyle(1.2, 0xd94747, 0.8)
        g.lineBetween(-hw * 0.58, wallBottom - hh * 0.14, -hw * 0.2, wallBottom - hh * 0.26)
        g.lineBetween(hw * 0.2, wallBottom - hh * 0.26, hw * 0.58, wallBottom - hh * 0.14)
        return
    }

    switch (this.def.category) {
      case 'power':
        g.fillStyle(0xf0e84c, 0.9)
        g.fillTriangle(-4, roofY - hh * 0.85, 2, roofY - hh * 0.42, -2, roofY - hh * 0.42)
        g.fillTriangle(-2, roofY - hh * 0.42, 4, roofY - hh * 0.05, 0, roofY - hh * 0.05)
        break
      case 'production':
        g.lineStyle(1.6, 0xd9d9d9, 0.75)
        g.strokeCircle(0, roofY - hh * 0.3, Math.max(6, hw * 0.2))
        break
      case 'defense':
        g.fillStyle(0x393939, 0.95)
        g.fillRect(-2, roofY - hh * 0.75, 4, hh * 0.72)
        break
      case 'tech':
        g.lineStyle(1.2, 0x8dc6ff, 0.8)
        g.strokeCircle(0, roofY - hh * 0.45, Math.max(7, hw * 0.25))
        break
      case 'superweapon':
        g.lineStyle(1.5, 0xffa34f, 0.85)
        g.strokeCircle(0, roofY - hh * 0.4, Math.max(8, hw * 0.28))
        break
      case 'base':
        g.lineStyle(1.5, 0xd0d0d0, 0.75)
        g.lineBetween(0, roofY - hh * 0.95, 0, roofY - hh * 0.2)
        g.lineBetween(0, roofY - hh * 0.9, hw * 0.35, roofY - hh * 0.9)
        break
    }
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

      if (this.def.id === 'grand_cannon') {
        console.log('[GrandCannon] Fired', {
          buildingId: this.id,
          owner: this.playerId,
          targetId: nearest.id,
          targetCategory: nearest.def?.category ?? 'unknown',
        })
      }
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
