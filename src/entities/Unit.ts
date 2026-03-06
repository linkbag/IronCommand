// ============================================================
// IRON COMMAND — Base Unit Class
// Extends Phaser.GameObjects.Container
// Manages movement, combat, harvesting, death
// ============================================================

import Phaser from 'phaser'
import type { UnitDef, Order, TileCoord, Position } from '../types'
import { TILE_SIZE } from '../types'

export type UnitState = 'idle' | 'moving' | 'attacking' | 'harvesting' | 'dying'

// Minimal scene interface — Agent 1 will provide the concrete implementation
export interface IRTSScene extends Phaser.Scene {
  findPath?: (from: TileCoord, to: TileCoord, playerId?: number) => TileCoord[]
  worldToTile?: (x: number, y: number) => TileCoord
  tileToWorld?: (col: number, row: number) => Position
  markTileOccupied?: (tile: TileCoord, entityId: string | null) => void
}

// Reference to avoid circular imports — EntityManager injects these
export interface IEntityRef {
  id: string
  x: number
  y: number
  hp: number
  playerId: number
  takeDamage?: (amount: number, sourcePlayerId: number) => void
}

export class Unit extends Phaser.GameObjects.Container {
  readonly id: string
  readonly playerId: number
  readonly def: UnitDef

  hp: number
  orders: Order[]
  currentOrder: Order | null
  state: UnitState

  // Movement
  private path: TileCoord[]
  private currentPathIndex: number
  private moveProgress: number  // 0–1 between tiles
  private sourceTile: TileCoord | null
  private destTile: TileCoord | null

  // Combat
  private attackCooldown: number
  private target: IEntityRef | null

  // RA2 Veterancy: 0 = rookie, 1 = veteran (3 kills), 2 = elite (7 kills)
  kills = 0
  veterancy = 0
  private guardPosition: Position | null = null

  // Harvest state
  private harvestTimer: number
  private cargoAmount: number
  private harvestCapacity: number
  private refineryId: string | null

  // Visuals
  private bodyGraphic: Phaser.GameObjects.Graphics
  private healthBar: Phaser.GameObjects.Graphics
  private selectionCircle: Phaser.GameObjects.Graphics
  private isSelected: boolean
  private factionColor: number
  private labelText: Phaser.GameObjects.Text

  constructor(
    scene: Phaser.Scene,
    id: string,
    playerId: number,
    def: UnitDef,
    factionColor: number,
    worldX: number,
    worldY: number,
  ) {
    super(scene, worldX, worldY)

    this.id = id
    this.playerId = playerId
    this.def = def
    this.factionColor = factionColor
    this.hp = def.stats.maxHp
    this.orders = []
    this.currentOrder = null
    this.state = 'idle'

    this.path = []
    this.currentPathIndex = 0
    this.moveProgress = 0
    this.sourceTile = null
    this.destTile = null

    this.attackCooldown = 0
    this.target = null

    this.harvestTimer = 0
    this.cargoAmount = 0
    this.harvestCapacity = 1500
    this.refineryId = null

    this.isSelected = false

    // ── Build visuals ───────────────────────────────────────────
    this.selectionCircle = scene.add.graphics()
    this.bodyGraphic = scene.add.graphics()
    this.healthBar = scene.add.graphics()
    this.labelText = scene.add.text(0, 0, this.getLabel(), {
      fontSize: '6px',
      color: '#ffffff',
      resolution: 2,
    }).setOrigin(0.5, 0.5)

    this.add([this.selectionCircle, this.bodyGraphic, this.healthBar, this.labelText])

    this.drawBody()
    this.drawHealthBar()
    this.drawSelectionCircle()

    scene.add.existing(this)
    this.setDepth(12)

    console.log('[Pipeline] Unit constructed', {
      id: this.id,
      playerId: this.playerId,
      defId: this.def.id,
      x: this.x,
      y: this.y,
      depth: this.depth,
    })
  }

  // ── Convenience getters (for HUDScene interop) ──────────────
  get defId(): string { return this.def.id }
  get maxHp(): number { return this.def.stats.maxHp }

  // ── Public API ───────────────────────────────────────────────

  giveOrder(order: Order, append = false): void {
    if (!append) {
      this.orders = []
      this.target = null
    }
    this.orders.push(order)
    if (!append || this.orders.length === 1) {
      this.processNextOrder()
    }
  }

  setSelected(selected: boolean): void {
    this.isSelected = selected
    this.drawSelectionCircle()
  }

  takeDamage(amount: number, _sourcePlayerId: number): void {
    if (this.state === 'dying') return
    this.hp = Math.max(0, this.hp - amount)
    this.drawHealthBar()
    if (this.hp <= 0) {
      this.die()
    }
  }

  setRefineryId(refineryId: string): void {
    this.refineryId = refineryId
  }

  getCargoAmount(): number {
    return this.cargoAmount
  }

  setCargoAmount(amount: number): void {
    this.cargoAmount = amount
  }

  /** RA2 Veterancy: record a kill and rank up if threshold met */
  recordKill(): void {
    this.kills++
    const oldRank = this.veterancy
    if (this.kills >= 7) this.veterancy = 2       // elite
    else if (this.kills >= 3) this.veterancy = 1  // veteran

    if (this.veterancy > oldRank) {
      this.emit('unit_promoted', this, this.veterancy)
    }
  }

  /** RA2 Veterancy damage multiplier: 1.0 / 1.2 / 1.5 */
  getVeterancyDamageMultiplier(): number {
    return this.veterancy >= 2 ? 1.5 : this.veterancy >= 1 ? 1.2 : 1.0
  }

  /** RA2 Veterancy fire rate multiplier: 1.0 / 1.1 / 1.2 */
  getVeterancyFireRateMultiplier(): number {
    return this.veterancy >= 2 ? 1.2 : this.veterancy >= 1 ? 1.1 : 1.0
  }

  get isAlive(): boolean {
    return this.state !== 'dying' && this.hp > 0
  }

  // ── Main update loop ─────────────────────────────────────────

  update(delta: number): void {
    if (this.state === 'dying') return

    this.attackCooldown = Math.max(0, this.attackCooldown - delta / 1000)

    switch (this.state) {
      case 'idle':
        this.updateIdle()
        break
      case 'moving':
        this.updateMovement(delta)
        break
      case 'attacking':
        this.updateAttack(delta)
        break
      case 'harvesting':
        this.updateHarvest(delta)
        break
    }
  }

  // ── Death ────────────────────────────────────────────────────

  die(): void {
    if (this.state === 'dying') return
    this.state = 'dying'
    this.target = null

    // Emit event for EntityManager / combat system
    this.emit('unit_died', this)

    // Small explosion flash
    const flash = this.scene.add.graphics()
    const isInfantry = this.def.category === 'infantry'
    const radius = isInfantry ? 8 : 20
    flash.fillStyle(0xff8800, 1)
    flash.fillCircle(this.x, this.y, radius)
    flash.setDepth(50)

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 400,
      onComplete: () => flash.destroy(),
    })

    // Fade out the unit
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 600,
      onComplete: () => {
        this.emit('unit_ready_to_remove', this)
        this.destroy()
      },
    })
  }

  // ── Private: order processing ────────────────────────────────

  private processNextOrder(): void {
    if (this.orders.length === 0) {
      this.state = 'idle'
      this.currentOrder = null
      return
    }

    this.currentOrder = this.orders.shift()!
    const order = this.currentOrder

    switch (order.type) {
      case 'move':
      case 'attackMove':
        if (order.target) {
          this.startMoveTo(order.target)
        }
        break

      case 'attack':
        if (order.targetEntityId) {
          this.state = 'attacking'
          // Target will be resolved by EntityManager during update
          this.emit('resolve_target', order.targetEntityId, (ref: IEntityRef) => {
            this.target = ref
          })
        }
        break

      case 'harvest':
        this.state = 'harvesting'
        if (order.target) {
          this.startMoveTo(order.target)
        }
        break

      case 'guard':
        // RA2 Guard: hold position, auto-engage, return to position
        this.guardPosition = { x: this.x, y: this.y }
        this.state = 'idle'
        this.path = []
        this.target = null
        break

      case 'stop':
        this.state = 'idle'
        this.path = []
        this.target = null
        this.guardPosition = null
        break

      default:
        this.state = 'idle'
    }
  }

  private startMoveTo(target: Position): void {
    const rts = this.scene as IRTSScene
    const fromTile = rts.worldToTile
      ? rts.worldToTile(this.x, this.y)
      : { col: Math.floor(this.x / TILE_SIZE), row: Math.floor(this.y / TILE_SIZE) }
    const toTile: TileCoord = {
      col: Math.floor(target.x / TILE_SIZE),
      row: Math.floor(target.y / TILE_SIZE),
    }

    if (rts.findPath) {
      this.path = rts.findPath(fromTile, toTile, this.playerId)
    } else {
      // Fallback: straight-line path of 1 waypoint
      this.path = [toTile]
    }

    this.currentPathIndex = 0
    this.moveProgress = 0
    this.sourceTile = fromTile
    this.destTile = this.path[0] ?? toTile
    this.state = 'moving'
  }

  // ── Private: movement ────────────────────────────────────────

  private updateMovement(delta: number): void {
    if (this.path.length === 0 || this.currentPathIndex >= this.path.length) {
      this.arriveAtDestination()
      return
    }

    const speed = this.def.stats.speed  // tiles per second
    const dt = delta / 1000
    this.moveProgress += speed * dt

    if (this.moveProgress >= 1) {
      // Arrived at this waypoint
      const arrivedTile = this.path[this.currentPathIndex]
      const rts = this.scene as IRTSScene
      if (rts.tileToWorld) {
        const wp = rts.tileToWorld(arrivedTile.col, arrivedTile.row)
        this.setPosition(wp.x, wp.y)
      } else {
        this.setPosition(
          arrivedTile.col * TILE_SIZE + TILE_SIZE / 2,
          arrivedTile.row * TILE_SIZE + TILE_SIZE / 2,
        )
      }
      this.moveProgress -= 1
      this.currentPathIndex++

      if (this.currentPathIndex < this.path.length) {
        this.sourceTile = arrivedTile
        this.destTile = this.path[this.currentPathIndex]
      } else {
        this.arriveAtDestination()
        return
      }
    } else {
      // Interpolate between source and dest
      if (this.sourceTile && this.destTile) {
        const rts = this.scene as IRTSScene
        const getSrc = () => rts.tileToWorld
          ? rts.tileToWorld(this.sourceTile!.col, this.sourceTile!.row)
          : { x: this.sourceTile!.col * TILE_SIZE + TILE_SIZE / 2, y: this.sourceTile!.row * TILE_SIZE + TILE_SIZE / 2 }
        const getDst = () => rts.tileToWorld
          ? rts.tileToWorld(this.destTile!.col, this.destTile!.row)
          : { x: this.destTile!.col * TILE_SIZE + TILE_SIZE / 2, y: this.destTile!.row * TILE_SIZE + TILE_SIZE / 2 }
        const src = getSrc()
        const dst = getDst()
        const t = this.moveProgress
        this.setPosition(
          src.x + (dst.x - src.x) * t,
          src.y + (dst.y - src.y) * t,
        )
      }
    }

    // Attack-move: check for targets while moving
    if (this.currentOrder?.type === 'attackMove' && this.def.attack) {
      const nearbyTarget = this.findNearbyEnemy()
      if (nearbyTarget) {
        this.target = nearbyTarget
        this.state = 'attacking'
      }
    }
  }

  private arriveAtDestination(): void {
    this.path = []
    this.moveProgress = 0

    if (this.currentOrder?.type === 'harvest') {
      this.state = 'harvesting'
      this.harvestTimer = 0
    } else {
      this.processNextOrder()
    }
  }

  // ── Private: attack ──────────────────────────────────────────

  private updateAttack(delta: number): void {
    if (!this.def.attack) {
      this.state = 'idle'
      return
    }

    // Validate target still alive
    if (!this.target || this.target.hp <= 0) {
      this.target = this.findNearbyEnemy()
      if (!this.target) {
        this.processNextOrder()
        return
      }
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y)
    const rangePixels = this.def.attack.range * TILE_SIZE

    if (dist > rangePixels) {
      // Move toward target
      this.startMoveTo({ x: this.target.x, y: this.target.y })
      return
    }

    // In range — fire (veterancy boosts fire rate)
    if (this.attackCooldown <= 0) {
      const cooldown = 1 / (this.def.attack.fireRate * this.getVeterancyFireRateMultiplier())
      this.attackCooldown = cooldown
      this.emit('fire_at_target', this, this.target)
    }
  }

  private findNearbyEnemy(): IEntityRef | null {
    if (!this.def.attack) return null
    const rangePixels = this.def.attack.range * TILE_SIZE
    let nearest: IEntityRef | null = null
    let nearestDist = Infinity

    // EntityManager listens to this event and returns nearby enemies
    this.emit('find_enemy', this.x, this.y, rangePixels, this.playerId, (enemies: IEntityRef[]) => {
      for (const e of enemies) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y)
        if (d < nearestDist) {
          nearestDist = d
          nearest = e
        }
      }
    })

    return nearest
  }

  // ── Private: harvest ─────────────────────────────────────────

  private updateHarvest(delta: number): void {
    const HARVEST_TIME = 3000  // ms per harvest action
    const DUMP_RANGE = TILE_SIZE * 3

    // Priority: if we're near a refinery with cargo, unload immediately.
    // This must run before the "cargo full" branch, otherwise the harvester
    // can get stuck re-issuing return-to-refinery without ever dumping.
    if (this.cargoAmount > 0 && this.refineryId) {
      this.emit('get_entity_pos', this.refineryId, (pos: Position | null) => {
        if (pos) {
          const dist = Phaser.Math.Distance.Between(this.x, this.y, pos.x, pos.y)
          if (dist < DUMP_RANGE) {
            // Dump cargo
            this.emit('dump_ore', this.playerId, this.cargoAmount)
            this.cargoAmount = 0
            // Go back to ore
            this.emit('find_ore_field', this.x, this.y, (target: Position | null) => {
              if (target) this.startMoveTo(target)
            })
          }
        }
      })
    }

    if (this.cargoAmount >= this.harvestCapacity) {
      // Full — return to refinery
      this.emit('find_refinery', this.playerId, (ref: IEntityRef | null) => {
        if (ref) {
          this.refineryId = ref.id
          const order: Order = { type: 'harvest', target: { x: ref.x, y: ref.y } }
          this.currentOrder = order
          this.startMoveTo({ x: ref.x, y: ref.y })
        }
      })
      return
    }

    // Check if adjacent to an ore tile
    this.emit('check_ore_at', this.x, this.y, (oreAmount: number, tilePos: Position) => {
      if (oreAmount > 0 && this.cargoAmount < this.harvestCapacity) {
        this.harvestTimer += delta
        if (this.harvestTimer >= HARVEST_TIME) {
          this.harvestTimer = 0
          const harvested = Math.min(100, oreAmount, this.harvestCapacity - this.cargoAmount)
          this.cargoAmount += harvested
          this.emit('harvest_ore', tilePos, harvested)
        }
      } else if (oreAmount <= 0) {
        // No ore here — find next ore field
        this.emit('find_ore_field', this.x, this.y, (target: Position | null) => {
          if (target) {
            this.startMoveTo(target)
          } else {
            this.state = 'idle'
          }
        })
      }
    })

  }

  // ── Private: idle ────────────────────────────────────────────

  private updateIdle(): void {
    // Auto-acquire targets when idle (all units auto-engage by default)
    if (this.def.attack && this.orders.length === 0) {
      const nearbyEnemy = this.findNearbyEnemy()
      if (nearbyEnemy) {
        this.target = nearbyEnemy
        this.state = 'attacking'
        return
      }
    }

    // RA2 Guard: return to guard position if we drifted away
    if (this.guardPosition && this.orders.length === 0) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, this.guardPosition.x, this.guardPosition.y)
      if (dist > TILE_SIZE * 2) {
        this.startMoveTo(this.guardPosition)
      }
    }
  }

  // ── Visuals ──────────────────────────────────────────────────

  private getLabel(): string {
    const labels: Record<string, string> = {
      infantry: 'INF',
      vehicle: 'VEH',
      aircraft: 'AIR',
      naval: 'NAV',
      harvester: 'HRV',
    }
    return labels[this.def.category] ?? '?'
  }

  private drawBody(): void {
    this.bodyGraphic.clear()
    const color = this.factionColor

    if (this.def.category === 'infantry') {
      // Small filled circle — 8px radius
      this.bodyGraphic.fillStyle(color, 1)
      this.bodyGraphic.fillCircle(0, 0, 8)
      this.bodyGraphic.lineStyle(1, 0xffffff, 0.5)
      this.bodyGraphic.strokeCircle(0, 0, 8)
    } else if (this.def.category === 'aircraft') {
      // Diamond shape for aircraft
      this.bodyGraphic.fillStyle(color, 1)
      this.bodyGraphic.fillTriangle(-8, 0, 0, -10, 8, 0)
      this.bodyGraphic.fillTriangle(-8, 0, 0, 6, 8, 0)
    } else {
      // Rectangle for vehicles / naval
      const w = this.def.category === 'naval' ? 20 : 16
      const h = 12
      this.bodyGraphic.fillStyle(color, 1)
      this.bodyGraphic.fillRect(-w / 2, -h / 2, w, h)
      this.bodyGraphic.lineStyle(1, 0xffffff, 0.4)
      this.bodyGraphic.strokeRect(-w / 2, -h / 2, w, h)
    }
  }

  private drawHealthBar(): void {
    this.healthBar.clear()
    const pct = this.hp / this.def.stats.maxHp
    const barW = 18
    const barH = 3
    const barY = -16

    // Background
    this.healthBar.fillStyle(0x333333, 0.8)
    this.healthBar.fillRect(-barW / 2, barY, barW, barH)

    // Fill
    const barColor = pct > 0.6 ? 0x00ff44 : pct > 0.3 ? 0xffaa00 : 0xff2200
    this.healthBar.fillStyle(barColor, 1)
    this.healthBar.fillRect(-barW / 2, barY, barW * pct, barH)
  }

  private drawSelectionCircle(): void {
    this.selectionCircle.clear()
    if (!this.isSelected) return
    this.selectionCircle.lineStyle(2, 0x00ffff, 0.9)
    this.selectionCircle.strokeCircle(0, 0, 14)
  }
}
