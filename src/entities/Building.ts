// ============================================================
// IRON COMMAND — Base Building Class
// Extends Phaser.GameObjects.Container
// Manages construction, production queue, rally points, selling
// ============================================================

import Phaser from 'phaser'
import type { BuildingDef, BuildQueueItem, Position } from '../types'
import { TILE_SIZE } from '../types'

export type BuildingState = 'constructing' | 'active' | 'low_power' | 'dying'

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

    // Production is handled by Production.ts via productionQueue
    this.updateProductionVisuals()
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
    this.bodyGraphic.clear()
    const w = this.def.footprint.w * TILE_SIZE
    const h = this.def.footprint.h * TILE_SIZE
    const color = this.state === 'low_power' ? 0x886644 : this.factionColor

    this.bodyGraphic.fillStyle(color, 1)
    this.bodyGraphic.fillRect(-w / 2, -h / 2, w, h)
    this.bodyGraphic.lineStyle(2, 0xffffff, 0.4)
    this.bodyGraphic.strokeRect(-w / 2, -h / 2, w, h)

    // Category icon decoration
    this.drawCategoryIcon(w, h)

    // Low power indicator
    if (this.state === 'low_power') {
      this.bodyGraphic.lineStyle(2, 0xff4400, 0.8)
      this.bodyGraphic.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4)
    }
  }

  private drawCategoryIcon(w: number, h: number): void {
    const g = this.bodyGraphic
    const hw = w / 2
    const hh = h / 2

    switch (this.def.category) {
      case 'power':
        // Lightning bolt
        g.lineStyle(2, 0xffff00, 0.9)
        g.lineBetween(hw * 0.3, -hh * 0.5, -hw * 0.1, 0)
        g.lineBetween(-hw * 0.1, 0, hw * 0.3, hh * 0.1)
        g.lineBetween(hw * 0.3, hh * 0.1, -hw * 0.3, hh * 0.5)
        break

      case 'production':
        // Gear-ish circle
        g.lineStyle(1, 0xffffff, 0.5)
        g.strokeCircle(0, 0, Math.min(w, h) * 0.2)
        break

      case 'defense':
        // Crosshair
        g.lineStyle(1, 0xff4444, 0.8)
        g.lineBetween(-hw * 0.4, 0, hw * 0.4, 0)
        g.lineBetween(0, -hh * 0.4, 0, hh * 0.4)
        g.strokeCircle(0, 0, Math.min(w, h) * 0.2)
        break

      case 'tech':
        // Antenna shape
        g.lineStyle(2, 0x88aaff, 0.8)
        g.lineBetween(0, 0, 0, -hh * 0.5)
        g.lineBetween(-hw * 0.2, -hh * 0.3, hw * 0.2, -hh * 0.3)
        break

      case 'superweapon':
        // Star / diamond
        g.lineStyle(2, 0xff8800, 0.9)
        g.strokeCircle(0, 0, Math.min(w, h) * 0.25)
        g.lineBetween(0, -hh * 0.45, 0, hh * 0.45)
        g.lineBetween(-hw * 0.45, 0, hw * 0.45, 0)
        break
    }
  }

  private drawHealthBar(): void {
    this.healthBar.clear()
    const pct = this.hp / this.def.stats.maxHp
    const w = this.def.footprint.w * TILE_SIZE
    const barW = w - 4
    const barH = 4
    const barY = -(this.def.footprint.h * TILE_SIZE) / 2 - 6

    this.healthBar.fillStyle(0x333333, 0.8)
    this.healthBar.fillRect(-barW / 2, barY, barW, barH)

    const barColor = pct > 0.6 ? 0x00ff44 : pct > 0.3 ? 0xffaa00 : 0xff2200
    this.healthBar.fillStyle(barColor, 1)
    this.healthBar.fillRect(-barW / 2, barY, barW * pct, barH)
  }

  private drawSelectionOutline(): void {
    this.selectionOutline.clear()
    if (!this.isSelected) return
    const w = this.def.footprint.w * TILE_SIZE + 4
    const h = this.def.footprint.h * TILE_SIZE + 4
    this.selectionOutline.lineStyle(2, 0x00ffff, 0.9)
    this.selectionOutline.strokeRect(-w / 2, -h / 2, w, h)
  }

  private updateProductionVisuals(): void {
    if (this.productionQueue.length === 0) return
    const item = this.productionQueue[0]
    // Production progress is drawn as overlay on the health bar area
    // The full progress bar rendering is handled by the UI layer (Agent 3)
    this.emit('production_progress', this.id, item.defId, item.progress)
  }
}
