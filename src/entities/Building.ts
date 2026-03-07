// ============================================================
// IRON COMMAND — Base Building Class
// Extends Phaser.GameObjects.Container
// Manages construction, production queue, rally points, selling
// ============================================================

import Phaser from 'phaser'
import type { BuildingDef, BuildQueueItem, Position } from '../types'
import { TILE_SIZE } from '../types'
import { cartToIso } from '../engine/IsoUtils'

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
  private constructionOverlay: Phaser.GameObjects.Graphics
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
    this.constructionOverlay = scene.add.graphics()
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
      this.constructionOverlay,
      this.bodyGraphic,
      this.crackOverlay,
      this.healthBar,
      this.statusText,
    ])
    this.add(this.visualRoot)

    this.drawBody()
    this.drawHealthBar()
    this.drawSelectionOutline()
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

  takeDamage(amount: number, _sourcePlayerId: number): void {
    if (this.state === 'dying') return
    this.hp = Math.max(0, this.hp - amount)
    this.drawHealthBar()

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
    const iso = cartToIso(rx, ry)
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
    const iso = cartToIso(this.x, this.y)
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
      const isoP = cartToIso(rx, ry)
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
    this.drawConstructionOverlay()
  }

  private updateConstruction(delta: number): void {
    const buildTime = this.def.stats.buildTime * 1000 || 100
    this.constructionProgress = Math.min(1, this.constructionProgress + delta / buildTime)
    this.setAlpha(0.3 + this.constructionProgress * 0.7)
    this.drawConstructionOverlay()

    if (this.constructionProgress >= 1) {
      this.state = 'active'
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

  // ── Private: visuals ─────────────────────────────────────────

  private drawBody(): void {
    const g = this.bodyGraphic
    g.clear()
    this.drawDropShadow()
    const tileSpan = this.def.footprint.w + this.def.footprint.h
    const halfW = Math.max(16, tileSpan * 16)
    const wallH = Math.max(18, tileSpan * 8)
    const baseY = 12
    const pct = this.hp / this.def.stats.maxHp
    let color = this.state === 'low_power' ? 0x886644 : this.factionColor
    if (pct < 0.5) color = adjustBrightness(color, -45)
    const roof = adjustBrightness(color, 30)
    const left = adjustBrightness(color, 6)
    const right = adjustBrightness(color, -24)

    // Roof
    g.fillStyle(roof, 1)
    g.beginPath()
    g.moveTo(0, baseY - wallH)
    g.lineTo(halfW, baseY - wallH / 2)
    g.lineTo(0, baseY)
    g.lineTo(-halfW, baseY - wallH / 2)
    g.closePath()
    g.fillPath()

    // Left wall
    g.fillStyle(left, 1)
    g.beginPath()
    g.moveTo(-halfW, baseY - wallH / 2)
    g.lineTo(0, baseY)
    g.lineTo(0, baseY + wallH * 0.45)
    g.lineTo(-halfW, baseY + wallH * 0.45 - wallH / 2)
    g.closePath()
    g.fillPath()

    // Right wall
    g.fillStyle(right, 1)
    g.beginPath()
    g.moveTo(0, baseY)
    g.lineTo(halfW, baseY - wallH / 2)
    g.lineTo(halfW, baseY + wallH * 0.45 - wallH / 2)
    g.lineTo(0, baseY + wallH * 0.45)
    g.closePath()
    g.fillPath()

    this.drawCategoryIcon(halfW * 2, wallH * 2)
    this.drawDamageOverlay(pct)

    // Low power indicator
    if (this.state === 'low_power') {
      g.lineStyle(2, 0xff4400, 0.8)
      g.strokeEllipse(0, baseY - wallH * 0.15, halfW * 1.4, wallH * 0.9)
    }
  }

  private drawDropShadow(): void {
    const s = this.dropShadow
    s.clear()
    const tileSpan = this.def.footprint.w + this.def.footprint.h
    s.fillStyle(0x000000, 0.35)
    s.fillEllipse(0, 22, tileSpan * 18, Math.max(12, tileSpan * 7))
  }

  private drawDamageOverlay(pct: number): void {
    this.crackOverlay.clear()
    if (pct >= 0.5 || this.state === 'constructing' || this.state === 'dying') return
    const tileSpan = this.def.footprint.w + this.def.footprint.h
    const halfW = Math.max(16, tileSpan * 16)
    const wallH = Math.max(18, tileSpan * 8)
    const y = 12 - wallH * 0.35
    this.crackOverlay.lineStyle(1.5, 0x1a1a1a, 0.8)
    this.crackOverlay.lineBetween(-halfW * 0.15, y - 10, -halfW * 0.02, y - 1)
    this.crackOverlay.lineBetween(-halfW * 0.02, y - 1, halfW * 0.12, y + 8)
    this.crackOverlay.lineBetween(halfW * 0.12, y + 8, halfW * 0.05, y + 14)
    this.crackOverlay.lineBetween(-halfW * 0.02, y - 1, -halfW * 0.1, y + 7)
  }

  private updateRenderTransform(): void {
    const isoPos = cartToIso(this.x, this.y)
    this.visualRoot.setPosition(isoPos.x - this.x, isoPos.y - this.y)
    this.setDepth(isoPos.y + 5)
  }

  private drawCategoryIcon(w: number, h: number): void {
    const g = this.bodyGraphic
    const hw = w / 2
    const hh = h / 2
    const r = Math.min(w, h) * 0.2

    // Per-building-id specifics first
    switch (this.def.id) {
      case 'construction_yard':
        // Crane arm + dangling hook
        g.lineStyle(2, 0xdddddd, 0.8)
        g.lineBetween(-hw * 0.3, hh * 0.3, -hw * 0.3, -hh * 0.6)  // mast
        g.lineBetween(-hw * 0.3, -hh * 0.6, hw * 0.4, -hh * 0.6)  // arm
        g.lineBetween(hw * 0.4, -hh * 0.6, hw * 0.4, -hh * 0.1)   // cable
        g.fillStyle(0xdddddd, 0.7)
        g.fillRect(hw * 0.3, -hh * 0.1, 6, 4)                      // hook base
        g.lineStyle(1.5, 0xdddddd, 0.8)
        g.lineBetween(hw * 0.33, hh * 0.13, hw * 0.53, hh * 0.13) // hook curve
        return
      case 'barracks':
        // Door arch + flag pole
        g.fillStyle(0x000000, 0.4)
        g.fillRect(-hw * 0.15, hh * 0.05, hw * 0.3, hh * 0.45)    // door
        g.beginPath()
        g.arc(0, hh * 0.05, hw * 0.15, Math.PI, 0)
        g.fillPath()
        // Flag pole
        g.lineStyle(2, 0xaaaaaa, 0.9)
        g.lineBetween(hw * 0.35, hh * 0.45, hw * 0.35, -hh * 0.5)
        g.fillStyle(0xff3333, 0.9)
        g.fillRect(hw * 0.35, -hh * 0.5, hw * 0.3, hh * 0.2)      // flag
        return
      case 'war_factory':
        // Roll-up door (horizontal stripes) + smokestack
        g.lineStyle(1.5, 0x000000, 0.5)
        for (let dy = hh * 0.0; dy < hh * 0.55; dy += hh * 0.15) {
          g.lineBetween(-hw * 0.6, dy, hw * 0.6, dy)
        }
        // Smokestack
        g.fillStyle(0x444444, 0.8)
        g.fillRect(hw * 0.5, -hh * 0.65, 6, hh * 0.5)
        g.fillStyle(0x888888, 0.4)
        g.fillCircle(hw * 0.53, -hh * 0.7, 5)
        return
      case 'ore_refinery':
        // Hopper/funnel shape on top
        g.fillStyle(0x885522, 0.7)
        g.fillTriangle(-hw * 0.4, -hh * 0.1, hw * 0.4, -hh * 0.1, hw * 0.15, -hh * 0.65)
        g.fillTriangle(-hw * 0.4, -hh * 0.1, -hw * 0.15, -hh * 0.65, hw * 0.4, -hh * 0.1)
        // Ore spill dots
        g.fillStyle(0xd4a017, 0.8)
        g.fillRect(-5, hh * 0.15, 4, 3)
        g.fillRect(2, hh * 0.25, 3, 3)
        return
      case 'tesla_coil':
        // Tall spike with electric arc at top
        g.fillStyle(0x444466, 1)
        g.fillRect(-4, -hh * 0.75, 8, hh * 0.9)
        g.lineStyle(2, 0x66aaff, 1)
        g.lineBetween(0, -hh * 0.75, -6, -hh * 0.95)
        g.lineBetween(-6, -hh * 0.95, 0, -hh * 0.85)
        g.lineBetween(0, -hh * 0.85, 6, -hh * 0.95)
        g.fillStyle(0xaaddff, 0.9)
        g.fillCircle(0, -hh * 0.75, 3)
        return
      case 'prism_tower':
        // Narrow mast + crystal prism at top
        g.fillStyle(0x444455, 1)
        g.fillRect(-3, -hh * 0.6, 6, hh * 0.75)
        g.fillStyle(0xaaddff, 0.85)
        g.fillTriangle(0, -hh * 0.95, -8, -hh * 0.6, 8, -hh * 0.6)
        g.lineStyle(1, 0xffffff, 0.5)
        g.lineBetween(0, -hh * 0.95, -2, -hh * 0.75)
        g.lineBetween(0, -hh * 0.95, 2, -hh * 0.75)
        return
      case 'pillbox':
      case 'sentry_gun':
        // Small bunker + barrel
        g.fillStyle(0x666666, 0.8)
        g.fillCircle(0, 0, r * 1.2)
        g.fillStyle(0x333333, 1)
        g.fillRect(-1.5, -r * 1.2 - 8, 3, 9)
        g.lineStyle(1.5, 0xff4444, 0.7)
        g.strokeCircle(0, 0, r * 0.7)
        return
      case 'flak_cannon':
      case 'patriot_system':
      case 'flak_cannon_rd':
        // AA gun: two upward barrels
        g.fillStyle(0x666666, 0.8)
        g.fillCircle(0, hh * 0.1, r)
        g.fillStyle(0x333333, 1)
        g.fillRect(-5, -hh * 0.7, 3, hh * 0.75)
        g.fillRect(2, -hh * 0.7, 3, hh * 0.75)
        return
      case 'iron_curtain':
      case 'chronosphere':
        // Superweapon: large dome with beam
        g.fillStyle(0x334455, 0.7)
        g.fillCircle(0, hh * 0.1, r * 1.6)
        g.lineStyle(2, 0xff8800, 0.9)
        g.strokeCircle(0, hh * 0.1, r * 1.6)
        g.lineStyle(3, 0xff8800, 0.7)
        g.lineBetween(0, hh * 0.1, 0, -hh * 0.8)
        g.fillStyle(0xffaa44, 0.9)
        g.fillCircle(0, -hh * 0.8, 5)
        return
    }

    // Category fallback icons
    switch (this.def.category) {
      case 'power':
        // Lightning bolt ⚡
        g.fillStyle(0xffff00, 0.85)
        g.beginPath()
        g.moveTo(hw * 0.15, -hh * 0.6)
        g.lineTo(-hw * 0.2, -hh * 0.05)
        g.lineTo(hw * 0.05, -hh * 0.05)
        g.lineTo(-hw * 0.15, hh * 0.6)
        g.lineTo(hw * 0.2, hh * 0.05)
        g.lineTo(-hw * 0.05, hh * 0.05)
        g.closePath()
        g.fillPath()
        break

      case 'production':
        // Gear circle with teeth
        g.lineStyle(2, 0xffffff, 0.5)
        g.strokeCircle(0, 0, r)
        for (let a = 0; a < 6; a++) {
          const angle = (a / 6) * Math.PI * 2
          const ox = Math.cos(angle) * (r + 3)
          const oy = Math.sin(angle) * (r + 3)
          g.fillStyle(0xffffff, 0.4)
          g.fillRect(ox - 2, oy - 2, 4, 4)
        }
        break

      case 'defense':
        // Crosshair
        g.lineStyle(2, 0xff4444, 0.85)
        g.lineBetween(-hw * 0.4, 0, hw * 0.4, 0)
        g.lineBetween(0, -hh * 0.4, 0, hh * 0.4)
        g.strokeCircle(0, 0, r)
        g.fillStyle(0xff4444, 0.6)
        g.fillCircle(0, 0, 2)
        break

      case 'tech':
        // Radar dish
        g.lineStyle(2, 0x88aaff, 0.8)
        g.lineBetween(0, hh * 0.1, 0, -hh * 0.5)
        g.beginPath()
        g.arc(-hw * 0.25, -hh * 0.3, r, -0.8, 0.8)
        g.strokePath()
        g.lineStyle(1, 0x88aaff, 0.4)
        g.strokeCircle(hw * 0.15, -hh * 0.2, 3)
        g.strokeCircle(hw * 0.15, -hh * 0.2, 6)
        break

      case 'superweapon':
        // Radiation symbol
        g.lineStyle(2, 0xff8800, 0.9)
        g.strokeCircle(0, 0, r * 1.3)
        g.fillStyle(0xff8800, 0.7)
        g.fillCircle(0, 0, 3)
        for (let a = 0; a < 3; a++) {
          const angle = (a / 3) * Math.PI * 2 - Math.PI / 2
          const sx = Math.cos(angle) * 5
          const sy = Math.sin(angle) * 5
          const ex = Math.cos(angle) * (r * 1.2)
          const ey = Math.sin(angle) * (r * 1.2)
          g.lineStyle(3, 0xff8800, 0.7)
          g.lineBetween(sx, sy, ex, ey)
        }
        break

      case 'base':
        // Crane/gear icon
        g.lineStyle(2, 0xffffff, 0.5)
        g.lineBetween(-hw * 0.2, hh * 0.2, -hw * 0.2, -hh * 0.4)
        g.lineBetween(-hw * 0.2, -hh * 0.4, hw * 0.2, -hh * 0.4)
        g.lineBetween(hw * 0.2, -hh * 0.4, hw * 0.2, -hh * 0.1)
        break
    }
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
    const halfW = Math.max(16, tileSpan * 16)
    const halfH = Math.max(10, tileSpan * 8)
    const cy = 20
    g.lineStyle(2, 0x00ffff, 0.9)
    g.beginPath()
    g.moveTo(0, cy - halfH)
    g.lineTo(halfW, cy)
    g.lineTo(0, cy + halfH)
    g.lineTo(-halfW, cy)
    g.closePath()
    g.strokePath()
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
}
