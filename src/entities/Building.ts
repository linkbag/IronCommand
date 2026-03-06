// ============================================================
// IRON COMMAND — Base Building Class
// Extends Phaser.GameObjects.Container
// Manages construction, production queue, rally points, selling
// ============================================================

import Phaser from 'phaser'
import type { BuildingDef, BuildQueueItem, Position } from '../types'
import { TILE_SIZE } from '../types'

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
  private bodyGraphic: Phaser.GameObjects.Graphics
  private healthBar: Phaser.GameObjects.Graphics
  private selectionOutline: Phaser.GameObjects.Graphics
  private constructionOverlay: Phaser.GameObjects.Graphics
  private statusText: Phaser.GameObjects.Text
  private isSelected: boolean
  private factionColor: number
  private smokeTimer = 0

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
    this.selectionOutline = scene.add.graphics()
    this.constructionOverlay = scene.add.graphics()
    this.bodyGraphic = scene.add.graphics()
    this.healthBar = scene.add.graphics()
    this.statusText = scene.add.text(0, 0, def.name.slice(0, 4).toUpperCase(), {
      fontSize: '7px',
      color: '#ffffff',
      resolution: 2,
    }).setOrigin(0.5, 0.5)

    this.add([this.selectionOutline, this.constructionOverlay, this.bodyGraphic, this.healthBar, this.statusText])

    this.drawBody()
    this.drawHealthBar()
    this.drawSelectionOutline()

    scene.add.existing(this)
    this.setDepth(5)

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

    if (this.state === 'constructing') {
      this.updateConstruction(delta)
      return
    }

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
  }

  private spawnSmoke(): void {
    const w = this.def.footprint.w * TILE_SIZE
    const h = this.def.footprint.h * TILE_SIZE
    const smoke = this.scene.add.graphics()
    const rx = this.x + Phaser.Math.Between(-w / 3, w / 3)
    const ry = this.y + Phaser.Math.Between(-h / 3, h / 3)
    const size = Phaser.Math.Between(3, 7)
    smoke.fillStyle(0x444444, 0.6)
    smoke.fillCircle(rx, ry, size)
    smoke.setDepth(45)
    this.scene.tweens.add({
      targets: smoke,
      alpha: 0,
      y: ry - 20,
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
    const flash = this.scene.add.graphics()
    flash.fillStyle(0xff6600, 1)
    flash.fillRect(this.x - w / 2, this.y - h / 2, w, h)
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
      smoke.fillStyle(0x888888, 0.8)
      smoke.fillCircle(rx, ry, Phaser.Math.Between(4, 12))
      smoke.setDepth(49)
      this.scene.tweens.add({
        targets: smoke,
        alpha: 0,
        y: ry - 30,
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
    const w = this.def.footprint.w * TILE_SIZE
    const h = this.def.footprint.h * TILE_SIZE
    const color = this.state === 'low_power' ? 0x886644 : this.factionColor
    const darker = adjustBrightness(color, -35)
    const lighter = adjustBrightness(color, 25)

    // Main body
    g.fillStyle(color, 1)
    g.fillRect(-w / 2, -h / 2, w, h)

    // 3D bevel — top and left edges lighter
    g.lineStyle(2, lighter, 0.5)
    g.beginPath()
    g.moveTo(-w / 2, h / 2)
    g.lineTo(-w / 2, -h / 2)
    g.lineTo(w / 2, -h / 2)
    g.strokePath()

    // 3D bevel — bottom and right edges darker
    g.lineStyle(2, darker, 0.5)
    g.beginPath()
    g.moveTo(w / 2, -h / 2)
    g.lineTo(w / 2, h / 2)
    g.lineTo(-w / 2, h / 2)
    g.strokePath()

    // Dark outline
    g.lineStyle(1, 0x000000, 0.4)
    g.strokeRect(-w / 2, -h / 2, w, h)

    // Category icon
    this.drawCategoryIcon(w, h)

    // Low power indicator
    if (this.state === 'low_power') {
      g.lineStyle(2, 0xff4400, 0.8)
      g.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4)
    }
  }

  private drawCategoryIcon(w: number, h: number): void {
    const g = this.bodyGraphic
    const hw = w / 2
    const hh = h / 2
    const r = Math.min(w, h) * 0.2

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
        // Inner dot
        g.fillStyle(0xff4444, 0.6)
        g.fillCircle(0, 0, 2)
        break

      case 'tech':
        // Radar dish
        g.lineStyle(2, 0x88aaff, 0.8)
        g.lineBetween(0, hh * 0.1, 0, -hh * 0.5)
        // Dish arc
        g.beginPath()
        g.arc(-hw * 0.25, -hh * 0.3, r, -0.8, 0.8)
        g.strokePath()
        // Signal lines
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
        // Radiation segments
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
    // Fill with gradient color
    const barColor = pct > 0.6 ? 0x00ff44 : pct > 0.3 ? 0xffaa00 : 0xff2200
    g.fillStyle(barColor, 1)
    g.fillRect(-barW / 2, barY, barW * pct, barH)
  }

  private drawSelectionOutline(): void {
    const g = this.selectionOutline
    g.clear()
    if (!this.isSelected) return
    const w = this.def.footprint.w * TILE_SIZE + 4
    const h = this.def.footprint.h * TILE_SIZE + 4
    // Bright cyan outline
    g.lineStyle(2, 0x00ffff, 0.9)
    g.strokeRect(-w / 2, -h / 2, w, h)
    // Corner accents
    const c = 6
    g.lineStyle(3, 0x00ffff, 1)
    // Top-left
    g.lineBetween(-w / 2, -h / 2 + c, -w / 2, -h / 2)
    g.lineBetween(-w / 2, -h / 2, -w / 2 + c, -h / 2)
    // Top-right
    g.lineBetween(w / 2 - c, -h / 2, w / 2, -h / 2)
    g.lineBetween(w / 2, -h / 2, w / 2, -h / 2 + c)
    // Bottom-left
    g.lineBetween(-w / 2, h / 2 - c, -w / 2, h / 2)
    g.lineBetween(-w / 2, h / 2, -w / 2 + c, h / 2)
    // Bottom-right
    g.lineBetween(w / 2 - c, h / 2, w / 2, h / 2)
    g.lineBetween(w / 2, h / 2, w / 2, h / 2 - c)
  }

  private updateProductionVisuals(): void {
    if (this.productionQueue.length === 0) return
    const item = this.productionQueue[0]
    // Production progress is drawn as overlay on the health bar area
    // The full progress bar rendering is handled by the UI layer (Agent 3)
    this.emit('production_progress', this.id, item.defId, item.progress)
  }
}
