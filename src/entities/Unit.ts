// ============================================================
// IRON COMMAND — Base Unit Class
// Extends Phaser.GameObjects.Container
// Manages movement, combat, harvesting, death
// ============================================================

import Phaser from 'phaser'
import type { UnitDef, Order, TileCoord, Position } from '../types'
import { TILE_SIZE } from '../types'

export type UnitState = 'idle' | 'moving' | 'attacking' | 'harvesting' | 'dying'

/** Shift RGB channels by amount (positive = lighter, negative = darker) */
function adjustBrightness(color: number, amount: number): number {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 0xff) + amount))
  const g = Math.max(0, Math.min(255, ((color >> 8) & 0xff) + amount))
  const b = Math.max(0, Math.min(255, (color & 0xff) + amount))
  return (r << 16) | (g << 8) | b
}

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
  def?: {
    category?: string
  }
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

  // RA2 Special mechanics
  invulnerable = false                      // Iron Curtain effect
  private invulnerableTimer = 0             // ms remaining
  mindControlledBy: string | null = null    // Yuri unit ID controlling this unit
  originalPlayerId: number = -1             // original owner before mind control
  stealthed = false                         // Mirage Tank stealth (stationary)

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
    if (this.invulnerable) return  // Iron Curtain — skip all damage
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

  /** Iron Curtain: make unit invulnerable for durationMs */
  setInvulnerable(durationMs: number): void {
    this.invulnerable = true
    this.invulnerableTimer = durationMs
  }

  /** Yuri mind control: switch unit to new owner, track original */
  setMindControlled(yuriId: string, newPlayerId: number): void {
    if (this.mindControlledBy) return  // already controlled
    this.mindControlledBy = yuriId
    this.originalPlayerId = this.playerId
    ;(this as { playerId: number }).playerId = newPlayerId
    this.orders = []
    this.target = null
    this.state = 'idle'
  }

  /** Release mind control — return to original owner */
  releaseMindControl(): void {
    if (!this.mindControlledBy) return
    ;(this as { playerId: number }).playerId = this.originalPlayerId
    this.mindControlledBy = null
    this.originalPlayerId = -1
    this.orders = []
    this.target = null
    this.state = 'idle'
  }

  get isAlive(): boolean {
    return this.state !== 'dying' && this.hp > 0
  }

  // ── Main update loop ─────────────────────────────────────────

  update(delta: number): void {
    if (this.state === 'dying') return

    this.attackCooldown = Math.max(0, this.attackCooldown - delta / 1000)

    // Iron Curtain invulnerability timer
    if (this.invulnerable && this.invulnerableTimer > 0) {
      this.invulnerableTimer -= delta
      if (this.invulnerableTimer <= 0) {
        this.invulnerable = false
        this.invulnerableTimer = 0
        this.setAlpha(1)
      }
    }

    // Mirage Tank stealth: become invisible when stationary
    if (this.def.id === 'mirage_tank') {
      const wasStealthed = this.stealthed
      this.stealthed = this.state === 'idle' && this.orders.length === 0
      if (this.stealthed !== wasStealthed) {
        // Visibility will be handled by GameScene.updateEntityVisibility
        this.emit('stealth_changed', this, this.stealthed)
      }
    }

    switch (this.state) {
      case 'idle':
        this.updateIdle()
        break
      case 'moving':
        this.updateMovement(delta)
        // Auto-attack while moving (RA2-style: units fire on the move)
        if (this.def.attack && this.attackCooldown <= 0) {
          this.tryFireWhileMoving()
        }
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

    // If this unit was mind-controlling another, release it
    this.emit('yuri_died', this)

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

  /** Fire at nearby enemies while moving — doesn't stop movement */
  private tryFireWhileMoving(): void {
    if (!this.def.attack) return
    const rangePixels = this.def.attack.range * TILE_SIZE

    this.emit('find_enemy', this.x, this.y, rangePixels, this.playerId, (enemies: IEntityRef[]) => {
      const validTargets = enemies.filter(e => this.canAttackEntityRef(e))
      if (validTargets.length === 0) return
      // Pick nearest enemy
      let nearest: IEntityRef | null = null
      let nearestDist = Infinity
      for (const e of validTargets) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y)
        if (d < nearestDist) { nearestDist = d; nearest = e }
      }
      if (nearest && nearestDist <= rangePixels) {
        this.emit('fire_at_target', this, nearest)
        this.attackCooldown = 1 / this.def.attack!.fireRate
      }
    })
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
    // Spies infiltrate enemy buildings for temporary vision
    if (this.def.id === 'spy' && this.target) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y)
      if (dist > TILE_SIZE * 2) {
        this.startMoveTo({ x: this.target.x, y: this.target.y })
        return
      }
      // In range — infiltrate
      this.emit('spy_infiltrate', this, this.target)
      this.state = 'idle'
      this.target = null
      return
    }

    // Engineers capture buildings instead of fighting
    if (this.def.id === 'engineer' && this.target) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y)
      if (dist > TILE_SIZE * 2) {
        this.startMoveTo({ x: this.target.x, y: this.target.y })
        return
      }
      // In range — attempt capture
      this.emit('fire_at_target', this, this.target)
      this.state = 'idle'
      this.target = null
      return
    }

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
    if (!this.canAttackTarget(this.target)) {
      this.target = this.findNearbyEnemy()
      if (!this.target) {
        this.processNextOrder()
        return
      }
    }

    if (!this.canAttackTarget(this.target)) {
      this.target = this.findNearbyEnemy()
      if (!this.target) {
        this.processNextOrder()
        return
      }
      if (!this.canAttackTarget(this.target)) {
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
        if (!this.canAttackEntityRef(e)) continue
        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y)
        if (d < nearestDist) {
          nearestDist = d
          nearest = e
        }
      }
    })

    return nearest
  }

  private canAttackEntityRef(target: IEntityRef): boolean {
    if (!this.def.attack) return false
    const targetCategory = (target as { def?: { category?: string } }).def?.category
    const isAir = targetCategory === 'aircraft'
    return isAir ? this.def.attack.canAttackAir : this.def.attack.canAttackGround
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
          if (this.def.id === 'chrono_miner') {
            // Chrono Miner signature behavior: teleport back to refinery to unload.
            this.setPosition(ref.x, ref.y)
            this.emit('dump_ore', this.playerId, this.cargoAmount)
            this.cargoAmount = 0
            console.log('[ChronoMiner] Teleported to refinery and unloaded ore', {
              unitId: this.id,
              refineryId: ref.id,
              playerId: this.playerId,
            })
            this.emit('find_ore_field', this.x, this.y, (target: Position | null) => {
              if (target) this.startMoveTo(target)
              else this.state = 'idle'
            })
            return
          }
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

  private canAttackTarget(target: IEntityRef): boolean {
    const attack = this.def.attack
    if (!attack) return false

    const category = target.def?.category ?? 'vehicle'
    const isAir = category === 'aircraft'
    const isGround = !isAir

    if (isAir && !attack.canAttackAir) return false
    if (isGround && !attack.canAttackGround) return false
    return true
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
    const g = this.bodyGraphic
    g.clear()
    const color = this.factionColor
    const darker = adjustBrightness(color, -40)
    const lighter = adjustBrightness(color, 30)

    // ── Special full-override shapes ──────────────────────────
    if (this.def.id === 'kirov') {
      // Blimp/airship silhouette
      g.fillStyle(0x000000, 0.25)
      g.fillEllipse(4, 10, 36, 12)  // ground shadow
      g.fillStyle(color, 1)
      g.fillEllipse(0, -3, 36, 18)   // envelope
      g.fillStyle(darker, 1)
      g.fillRect(-7, 5, 14, 6)       // gondola
      g.fillTriangle(-14, -2, -20, 6, -14, 6)  // left fin
      g.fillTriangle(14, -2, 20, 6, 14, 6)     // right fin
      g.fillStyle(0x333333, 1)
      g.fillRect(-11, 9, 5, 3)       // engine pod L
      g.fillRect(6, 9, 5, 3)         // engine pod R
      g.lineStyle(1, lighter, 0.35)
      g.strokeEllipse(0, -3, 36, 18)
      return
    }

    if (this.def.id === 'attack_dog') {
      // Low horizontal dog shape
      g.fillStyle(adjustBrightness(0x8b4513, -20), 1)
      g.fillEllipse(0, 2, 18, 9)     // body
      g.fillEllipse(-8, -1, 9, 8)    // head
      g.fillTriangle(-10, -4, -12, -9, -7, -4)  // ear
      g.lineStyle(2, adjustBrightness(0x8b4513, -20), 1)
      g.lineBetween(7, 1, 11, -4)    // tail
      g.lineStyle(1.5, 0x2a1a0a, 1)
      g.lineBetween(-5, 6, -5, 11)   // leg FL
      g.lineBetween(-2, 6, -2, 11)   // leg FR
      g.lineBetween(3, 6, 3, 11)     // leg BL
      g.lineBetween(6, 6, 6, 11)     // leg BR
      return
    }

    if (this.def.id === 'recon_drone') {
      // Small quadcopter diamond
      g.fillStyle(color, 1)
      g.fillTriangle(0, -7, -5, 0, 0, 7)
      g.fillTriangle(0, -7, 5, 0, 0, 7)
      g.lineStyle(2, darker, 1)
      g.lineBetween(-3, 0, -8, -5)
      g.lineBetween(3, 0, 8, -5)
      g.lineBetween(-3, 0, -8, 5)
      g.lineBetween(3, 0, 8, 5)
      g.lineStyle(1, lighter, 0.8)
      g.strokeCircle(-8, -5, 3)
      g.strokeCircle(8, -5, 3)
      g.strokeCircle(-8, 5, 3)
      g.strokeCircle(8, 5, 3)
      return
    }

    // ── Infantry ─────────────────────────────────────────────
    if (this.def.category === 'infantry') {
      // Tesla trooper: bulkier armored suit
      const isTesla = this.def.id === 'tesla_trooper'
      const isDesolator = this.def.id === 'desolator'
      const bodyW = isTesla || isDesolator ? 13 : 10
      const bodyH = isTesla || isDesolator ? 10 : 8

      // Legs
      g.fillStyle(darker, 1)
      g.fillRect(-3, 2, 2, 5)
      g.fillRect(1, 2, 2, 5)
      // Torso
      g.fillStyle(color, 1)
      g.fillEllipse(0, 0, bodyW, bodyH)
      // Head
      g.fillStyle(lighter, 1)
      g.fillCircle(0, -6, isTesla || isDesolator ? 4 : 3)
      // Arms
      g.lineStyle(1.5, darker, 1)
      g.lineBetween(-5, -1, -8, 3)
      g.lineBetween(5, -1, 8, 3)
      // Outline
      g.lineStyle(1, 0x000000, 0.3)
      g.strokeEllipse(0, 0, bodyW, bodyH)

      // Per-id overlays
      switch (this.def.id) {
        case 'engineer':
          // Wrench/tool cross at waist
          g.lineStyle(2, 0xffaa00, 1)
          g.lineBetween(0, 4, 0, 9)
          g.lineBetween(-2, 6, 2, 6)
          break
        case 'spy':
          // Fedora hat on head
          g.fillStyle(0x222233, 1)
          g.fillRect(-5, -10, 10, 3)   // brim
          g.fillRect(-3, -13, 6, 4)    // crown
          break
        case 'tesla_trooper':
          // Electric arc lines from arms
          g.lineStyle(1.5, 0x66aaff, 0.9)
          g.lineBetween(-8, 3, -11, -1)
          g.lineBetween(-11, -1, -9, -4)
          g.lineStyle(1.5, 0x66aaff, 0.9)
          g.lineBetween(8, 3, 11, -1)
          g.lineBetween(11, -1, 9, -4)
          break
        case 'crazy_ivan':
          // Bomb in hand
          g.fillStyle(0x333333, 1)
          g.fillCircle(9, 2, 4)
          g.lineStyle(1.5, 0xff6600, 1)
          g.lineBetween(9, -1, 9, 2)   // fuse
          break
        case 'rocketeer':
          // Jetpack wings
          g.fillStyle(0x666677, 1)
          g.fillTriangle(-9, -3, -5, 1, -12, 5)
          g.fillTriangle(9, -3, 5, 1, 12, 5)
          // Jet flames
          g.fillStyle(0xff8800, 0.85)
          g.fillTriangle(-10, 5, -7, 5, -8, 10)
          g.fillTriangle(7, 5, 10, 5, 9, 10)
          break
        case 'sniper':
          // Long rifle
          g.lineStyle(2.5, 0x333333, 1)
          g.lineBetween(5, -1, 18, -4)
          g.lineStyle(1, 0x555555, 1)
          g.lineBetween(13, -4, 16, -6)  // scope
          break
        case 'desolator':
          // Hazmat visor overlay
          g.fillStyle(0x44bb44, 0.4)
          g.fillCircle(0, -6, 4)
          // Sprayer hose from arm
          g.lineStyle(2, 0x667744, 1)
          g.lineBetween(-8, 3, -11, 6)
          g.lineBetween(-11, 6, -13, 3)
          break
        case 'flak_trooper':
          // Shoulder-mounted rocket tube
          g.fillStyle(0x555555, 1)
          g.fillRect(-12, -6, 9, 4)
          g.lineStyle(1, 0x333333, 1)
          g.strokeRect(-12, -6, 9, 4)
          break
        case 'terrorist':
          // Vest with explosives strapped on
          g.fillStyle(0xff4400, 0.75)
          g.fillRect(-4, -1, 8, 5)
          g.lineStyle(1, 0xffaa00, 0.8)
          g.lineBetween(-3, 1, 3, 1)
          g.lineBetween(-3, 3, 3, 3)
          break
      }

    // ── Aircraft ─────────────────────────────────────────────
    } else if (this.def.category === 'aircraft') {
      if (this.def.id === 'rocketeer') {
        // Rocketeer in-air: infantry silhouette + jetpack
        g.fillStyle(color, 1)
        g.fillEllipse(0, 1, 10, 8)
        g.fillStyle(lighter, 1)
        g.fillCircle(0, -5, 3)
        g.fillStyle(0x666677, 1)
        g.fillRect(-4, 1, 8, 7)       // jetpack
        g.fillStyle(0xff8800, 0.85)
        g.fillTriangle(-3, 8, -1, 8, -2, 14)
        g.fillTriangle(1, 8, 3, 8, 2, 14)
      } else if (this.def.id === 'nighthawk') {
        // Wide stealth shape (flat delta)
        g.fillStyle(0x000000, 0.2)
        g.fillEllipse(3, 6, 22, 6)
        g.fillStyle(color, 1)
        g.fillTriangle(0, -6, -16, 8, 16, 8)
        g.fillRect(-2, -4, 4, 10)
        g.fillStyle(darker, 1)
        g.fillTriangle(-2, 6, 2, 6, 0, 10)
        g.fillStyle(0x88ccff, 0.6)
        g.fillCircle(0, -2, 2)
      } else {
        // Generic jet (harrier, black_eagle)
        g.fillStyle(0x000000, 0.2)
        g.fillEllipse(3, 5, 14, 6)
        g.fillStyle(color, 1)
        g.fillTriangle(0, -10, -10, 6, 10, 6)
        g.fillRect(-2, -8, 4, 12)
        g.fillStyle(darker, 1)
        g.fillTriangle(-2, 4, 2, 4, 0, 8)
        g.fillStyle(0x88ccff, 0.7)
        g.fillCircle(0, -4, 2)
        g.lineStyle(1, lighter, 0.4)
        g.lineBetween(0, -10, -10, 6)
        g.lineBetween(0, -10, 10, 6)
        // Black Eagle: swept-back wings marker
        if (this.def.id === 'black_eagle') {
          g.lineStyle(1.5, lighter, 0.5)
          g.lineBetween(-4, -2, -10, 4)
          g.lineBetween(4, -2, 10, 4)
        }
      }

    // ── Vehicles / Naval ─────────────────────────────────────
    } else {
      const isHarvester = this.def.category === 'harvester'
      const isNaval = this.def.category === 'naval'

      // Naval: boat hull instead of treads
      if (isNaval) {
        const nw = this.def.id === 'aircraft_carrier' ? 30 : this.def.id === 'dreadnought' ? 28 : 22
        const nh = this.def.id === 'aircraft_carrier' ? 12 : 9
        g.fillStyle(darker, 1)
        g.fillEllipse(0, 2, nw + 2, nh + 2)  // hull shadow
        g.fillStyle(color, 1)
        g.fillEllipse(0, 0, nw, nh)
        g.fillStyle(lighter, 1)
        g.fillRect(-nw * 0.2, -nh * 0.3, nw * 0.4, nh * 0.3)  // superstructure
        if (this.def.id === 'aircraft_carrier') {
          // Flight deck
          g.lineStyle(1, lighter, 0.5)
          g.lineBetween(-12, -3, 12, -3)
          g.lineBetween(-12, 0, 12, 0)
        } else if (this.def.id === 'typhoon_sub' || this.def.id === 'giant_squid') {
          // Submarine/squid — slightly submerged look
          g.fillStyle(0x000033, 0.3)
          g.fillEllipse(0, 3, nw, nh * 0.6)
        } else {
          // Gun barrel
          g.fillStyle(0x3a3a3a, 1)
          g.fillRect(-1, -nh / 2 - 5, 2, 6)
        }
        g.lineStyle(1, 0x000000, 0.25)
        g.strokeEllipse(0, 0, nw, nh)
        return
      }

      // Land vehicle dimensions and turret type based on unit id
      type TurretKind = 'standard' | 'large' | 'dual' | 'small' | 'aa' | 'rocket' | 'crystal' | 'tesla' | 'none'
      const vehicleProfiles: Record<string, { w: number; h: number; turret: TurretKind }> = {
        grizzly_tank:       { w: 18, h: 14, turret: 'standard' },
        ifv:                { w: 16, h: 12, turret: 'small' },
        rhino_tank:         { w: 20, h: 15, turret: 'large' },
        apocalypse_tank:    { w: 24, h: 16, turret: 'dual' },
        flak_track:         { w: 18, h: 12, turret: 'aa' },
        v3_launcher:        { w: 18, h: 14, turret: 'rocket' },
        prism_tank:         { w: 18, h: 14, turret: 'crystal' },
        tesla_tank:         { w: 18, h: 14, turret: 'tesla' },
        mcv:                { w: 26, h: 18, turret: 'none' },
        mecha_walker:       { w: 14, h: 18, turret: 'standard' },
        dragon_tank:        { w: 20, h: 14, turret: 'none' },
        tank_destroyer:     { w: 18, h: 13, turret: 'large' },
        demo_truck:         { w: 18, h: 14, turret: 'none' },
        brahmos_battery:    { w: 18, h: 14, turret: 'rocket' },
        conquistador_mech:  { w: 16, h: 18, turret: 'standard' },
        chrono_miner:       { w: 22, h: 16, turret: 'none' },
        war_miner:          { w: 22, h: 16, turret: 'none' },
      }
      const profile = vehicleProfiles[this.def.id] ?? { w: 18, h: 14, turret: 'standard' as TurretKind }
      const w = isHarvester ? 22 : profile.w
      const h = isHarvester ? 16 : profile.h
      const turret = isHarvester ? 'none' as TurretKind : profile.turret

      // Treads
      g.fillStyle(0x2a2a2a, 1)
      g.fillRect(-w / 2, -h / 2, w, 3)
      g.fillRect(-w / 2, h / 2 - 3, w, 3)
      g.lineStyle(1, 0x1a1a1a, 0.5)
      for (let tx = -w / 2 + 3; tx < w / 2; tx += 4) {
        g.lineBetween(tx, -h / 2, tx, -h / 2 + 3)
        g.lineBetween(tx, h / 2 - 3, tx, h / 2)
      }

      // Main body
      g.fillStyle(color, 1)
      g.fillRect(-w / 2 + 2, -h / 2 + 3, w - 4, h - 6)
      g.lineStyle(1, lighter, 0.4)
      g.lineBetween(-w / 2 + 2, -h / 2 + 3, w / 2 - 2, -h / 2 + 3)
      g.lineStyle(1, darker, 0.4)
      g.lineBetween(-w / 2 + 2, h / 2 - 3, w / 2 - 2, h / 2 - 3)

      // Turret / weapon system
      switch (turret) {
        case 'standard':
          g.fillStyle(lighter, 1)
          g.fillRect(-4, -3, 8, 6)
          g.fillStyle(0x3a3a3a, 1)
          g.fillRect(-1, -9, 2, 7)
          break
        case 'large':
          g.fillStyle(lighter, 1)
          g.fillRect(-5, -4, 10, 7)
          g.fillStyle(0x3a3a3a, 1)
          g.fillRect(-1.5, -12, 3, 9)
          break
        case 'dual':
          g.fillStyle(lighter, 1)
          g.fillRect(-6, -4, 12, 8)
          g.fillStyle(0x3a3a3a, 1)
          g.fillRect(-4, -12, 2.5, 9)
          g.fillRect(1.5, -12, 2.5, 9)
          break
        case 'small':
          g.fillStyle(lighter, 1)
          g.fillRect(-3, -2, 6, 5)
          g.fillStyle(0x3a3a3a, 1)
          g.fillRect(-1, -7, 2, 6)
          break
        case 'aa':
          // Anti-air: two vertical gun barrels sticking up
          g.fillStyle(lighter, 1)
          g.fillRect(-5, -2, 10, 5)
          g.fillStyle(0x3a3a3a, 1)
          g.fillRect(-4, -11, 2, 10)
          g.fillRect(2, -11, 2, 10)
          break
        case 'rocket':
          // V3/rocket: angled rocket on top
          g.fillStyle(lighter, 1)
          g.fillRect(-4, -2, 8, 5)
          g.fillStyle(0xdd3333, 1)
          g.fillTriangle(-1, -3, 1, -3, 0, -11)  // nose
          g.fillStyle(0xaaaaaa, 1)
          g.fillRect(-1, -9, 2, 7)  // body
          g.fillStyle(0x888888, 1)
          g.fillTriangle(-3, -3, -1, -3, -2, -1)  // fin L
          g.fillTriangle(1, -3, 3, -3, 2, -1)     // fin R
          break
        case 'crystal':
          // Prism: diamond crystal on top
          g.fillStyle(lighter, 1)
          g.fillRect(-4, -2, 8, 5)
          g.fillStyle(0xaaddff, 0.9)
          g.fillTriangle(0, -13, -4, -4, 4, -4)  // top prism
          g.lineStyle(1, 0xffffff, 0.5)
          g.lineBetween(0, -13, -1, -8)
          g.lineBetween(0, -13, 1, -8)
          break
        case 'tesla':
          // Tesla coil spike + arc
          g.fillStyle(lighter, 1)
          g.fillRect(-4, -3, 8, 6)
          g.fillStyle(0x3a3a3a, 1)
          g.fillRect(-1, -11, 2, 9)
          g.lineStyle(1.5, 0x66aaff, 0.9)
          g.lineBetween(-1, -11, -4, -14)
          g.lineBetween(-4, -14, 0, -12)
          g.lineBetween(1, -11, 4, -14)
          g.lineBetween(4, -14, 0, -12)
          break
        case 'none':
          if (isHarvester) {
            // Scoop at front + cargo bay
            g.fillStyle(0x1a1a1a, 0.8)
            g.fillRect(2, -h / 2 + 4, w / 2 - 4, h - 8)
            // Scoop V-shape at front
            g.fillStyle(0x888888, 1)
            g.fillTriangle(-w / 2 + 2, -2, -w / 2 - 2, 0, -w / 2 + 2, 2)
          } else if (this.def.id === 'mcv') {
            // Crane/antenna on top
            g.lineStyle(2, 0x888888, 1)
            g.lineBetween(-4, -h / 2 + 3, -4, -h / 2 - 8)
            g.lineBetween(-4, -h / 2 - 8, 4, -h / 2 - 2)
            g.fillStyle(0x666666, 1)
            g.fillRect(-w / 2 + 4, -h / 2 + 4, 8, 6)  // cab
          } else if (this.def.id === 'dragon_tank') {
            // Flame nozzle at front
            g.fillStyle(0x555555, 1)
            g.fillRect(-w / 2 - 4, -3, 6, 6)
            g.fillStyle(0xff6600, 0.7)
            g.fillTriangle(-w / 2 - 4, -2, -w / 2 - 10, 0, -w / 2 - 4, 2)
          } else if (this.def.id === 'demo_truck') {
            // Barrel on back
            g.fillStyle(0x555555, 1)
            g.fillRect(2, -h / 2 + 4, w / 2 - 4, h - 8)
            g.fillStyle(0xff2200, 0.7)
            g.fillCircle(w / 2 - 6, 0, 4)
          }
          break
      }

      // Outline
      g.lineStyle(1, 0x000000, 0.25)
      g.strokeRect(-w / 2, -h / 2, w, h)
    }
  }

  private drawHealthBar(): void {
    const g = this.healthBar
    g.clear()
    const pct = this.hp / this.def.stats.maxHp
    // Only show when damaged or selected
    if (pct >= 1 && !this.isSelected) return
    const barW = 20
    const barH = 3
    const barY = -16

    // Black outline
    g.fillStyle(0x000000, 0.9)
    g.fillRect(-barW / 2 - 1, barY - 1, barW + 2, barH + 2)
    // Background
    g.fillStyle(0x333333, 0.8)
    g.fillRect(-barW / 2, barY, barW, barH)
    // Gradient fill: green → yellow → red
    const barColor = pct > 0.6 ? 0x00ff44 : pct > 0.3 ? 0xffaa00 : 0xff2200
    g.fillStyle(barColor, 1)
    g.fillRect(-barW / 2, barY, barW * pct, barH)

    // Veterancy chevrons
    if (this.veterancy > 0) {
      const chevColor = this.veterancy >= 2 ? 0xffdd44 : 0x88bbff
      g.lineStyle(1.5, chevColor, 1)
      for (let r = 0; r < this.veterancy; r++) {
        const ox = barW / 2 + 3 + r * 6
        g.beginPath()
        g.moveTo(ox, barY + barH)
        g.lineTo(ox + 2.5, barY - 1)
        g.lineTo(ox + 5, barY + barH)
        g.strokePath()
      }
    }
  }

  private drawSelectionCircle(): void {
    const g = this.selectionCircle
    g.clear()
    if (!this.isSelected) return
    // Cyan dashed ellipse for 3/4 perspective
    g.lineStyle(2, 0x00ffff, 0.85)
    g.strokeEllipse(0, 2, 24, 12)
  }
}
