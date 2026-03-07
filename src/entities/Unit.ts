// ============================================================
// IRON COMMAND — Base Unit Class
// Extends Phaser.GameObjects.Container
// Manages movement, combat, harvesting, death
// ============================================================

import Phaser from 'phaser'
import type { UnitDef, Order, TileCoord, Position } from '../types'
import { TILE_SIZE, HARVESTER_CAPACITY, ORE_PER_LOAD, GEMS_PER_LOAD, ORE_HARVEST_RATE, REFINERY_PROCESS_RATE } from '../types'
import { cartToScreen } from '../engine/IsoUtils'

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
  private cargoLoads: number
  private cargoValue: number
  private unloadTimer: number
  private harvestCapacity: number
  private refineryId: string | null

  // Visuals
  facing = 0 // 0: NE, 1: SE, 2: SW, 3: NW
  private visualRoot: Phaser.GameObjects.Container
  private bodySprite: Phaser.GameObjects.Image
  private turretSprite: Phaser.GameObjects.Image | null
  private shadowEllipse: Phaser.GameObjects.Ellipse
  private healthBar: Phaser.GameObjects.Graphics
  private selectionCircle: Phaser.GameObjects.Graphics
  private isSelected: boolean
  private factionColor: number
  private labelText: Phaser.GameObjects.Text
  private turretFacing = 1 // 0: NE, 1: SE, 2: SW, 3: NW

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
    this.cargoLoads = 0
    this.cargoValue = 0
    this.unloadTimer = 0
    this.harvestCapacity = HARVESTER_CAPACITY
    this.refineryId = null

    this.isSelected = false

    // ── Build visuals ───────────────────────────────────────────
    this.visualRoot = scene.add.container(0, 0)
    this.selectionCircle = scene.add.graphics()
    const shadowW = this.def.category === 'infantry' ? 20 : this.def.category === 'aircraft' ? 18 : 26
    const shadowH = this.def.category === 'infantry' ? 8 : this.def.category === 'aircraft' ? 6 : 10
    this.shadowEllipse = scene.add.ellipse(0, this.def.category === 'aircraft' ? 9 : 5, shadowW, shadowH, 0x000000, 0.3)
    this.bodySprite = scene.add.image(0, this.def.category === 'aircraft' ? -8 : 0, this.def.spriteKey).setOrigin(0.5, 0.75)
    this.turretSprite = null
    if (this.scene.textures.exists(`${this.def.spriteKey}_turret_iso_se`)) {
      this.turretSprite = scene.add.image(0, this.def.category === 'aircraft' ? -8 : 0, `${this.def.spriteKey}_turret_iso_se`).setOrigin(0.5, 0.75)
    }
    this.healthBar = scene.add.graphics()
    this.labelText = scene.add.text(0, 0, this.getLabel(), {
      fontSize: '6px',
      color: '#ffffff',
      resolution: 2,
    }).setOrigin(0.5, 0.5)
    this.labelText.y = -22

    if (this.turretSprite) {
      this.visualRoot.add([this.selectionCircle, this.shadowEllipse, this.bodySprite, this.turretSprite, this.healthBar, this.labelText])
    } else {
      this.visualRoot.add([this.selectionCircle, this.shadowEllipse, this.bodySprite, this.healthBar, this.labelText])
    }
    this.add(this.visualRoot)

    this.drawBody()
    this.drawTurret()
    this.drawHealthBar()
    this.drawSelectionCircle()
    this.bodySprite.setTint(this.factionColor)
    this.turretSprite?.setTint(this.factionColor)
    this.syncRenderTransform()

    scene.add.existing(this)

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

  // Keep gameplay coordinates Cartesian; only visual children move to isometric projection.
  override setPosition(x?: number, y?: number, z?: number, w?: number): this {
    super.setPosition(x, y, z, w)
    this.syncRenderTransform()
    return this
  }

  override add(child: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]): this {
    if (!this.visualRoot) {
      return super.add(child)
    }
    const children = Array.isArray(child) ? child : [child]
    for (const c of children) {
      if (c === this.visualRoot) super.add(c)
      else this.visualRoot.add(c)
    }
    return this
  }

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
    return this.cargoValue
  }

  setCargoAmount(amount: number): void {
    this.cargoValue = Math.max(0, Math.floor(amount))
    this.cargoLoads = Math.min(this.harvestCapacity, Math.ceil(this.cargoValue / ORE_PER_LOAD))
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
    return this.veterancy >= 2 ? 1.5 : this.veterancy >= 1 ? 1.25 : 1.0
  }

  /** RA2 Veterancy fire rate multiplier: 1.0 / 1.1 / 1.2 */
  getVeterancyFireRateMultiplier(): number {
    return this.veterancy >= 2 ? 1.2 : this.veterancy >= 1 ? 1.1 : 1.0
  }

  /** RA2 veterancy armor bonus: 1.0 / 1.25 / 1.5 */
  getVeterancyArmorMultiplier(): number {
    return this.veterancy >= 2 ? 1.5 : this.veterancy >= 1 ? 1.25 : 1.0
  }

  /** Force veterancy rank (used by spy infiltration bonuses) */
  setVeterancy(rank: 0 | 1 | 2): void {
    const oldRank = this.veterancy
    this.veterancy = rank
    this.kills = rank >= 2 ? Math.max(this.kills, 7) : rank >= 1 ? Math.max(this.kills, 3) : this.kills
    if (this.veterancy > oldRank) {
      this.emit('unit_promoted', this, this.veterancy)
    }
  }

  /** Iron Curtain: make unit invulnerable for durationMs */
  setInvulnerable(durationMs: number): void {
    this.invulnerable = true
    this.invulnerableTimer = durationMs
  }

  /** Heal unit by amount (capped at maxHp) */
  heal(amount: number): void {
    if (this.state === 'dying') return
    this.hp = Math.min(this.hp + amount, this.def.stats.maxHp)
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

    // Elite self-heal (RA2): slow passive regeneration while alive.
    if (this.veterancy >= 2 && this.hp > 0 && this.hp < this.def.stats.maxHp) {
      this.heal((delta / 1000) * 4)
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

    this.syncRenderTransform()
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
    const screenPos = cartToScreen(this.x, this.y)
    flash.fillStyle(0xff8800, 1)
    flash.fillCircle(screenPos.x, screenPos.y, radius)
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
    this.updateFacingFromVector(this.destTile.col - this.sourceTile.col, this.destTile.row - this.sourceTile.row)
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
        const nextDx = this.destTile.col - this.sourceTile.col
        const nextDy = this.destTile.row - this.sourceTile.row
        this.updateFacingFromVector(nextDx, nextDy)
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
        this.updateFacingFromVector(dst.x - src.x, dst.y - src.y)
        const t = this.moveProgress
        this.setPosition(
          src.x + (dst.x - src.x) * t,
          src.y + (dst.y - src.y) * t,
        )
      }
    }

    // Attack-move: check for targets while moving
    if (this.currentOrder?.type === 'attackMove' && this.def.attack) {
      this.updateAttackMove()
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
        this.updateTurretFacingFromVector(nearest.x - this.x, nearest.y - this.y)
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
    } else if (this.currentOrder?.type === 'attackMove' && this.def.attack) {
      if (!this.updateAttackMove()) {
        this.processNextOrder()
      }
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
      if (this.currentOrder?.type === 'attackMove' && this.updateAttackMove()) {
        return
      }
      this.target = this.findNearbyEnemy()
      if (!this.target) {
        this.processNextOrder()
        return
      }
    }
    if (!this.canAttackTarget(this.target)) {
      if (this.currentOrder?.type === 'attackMove' && this.updateAttackMove()) {
        return
      }
      this.target = this.findNearbyEnemy()
      if (!this.target) {
        this.processNextOrder()
        return
      }
    }

    if (!this.canAttackTarget(this.target)) {
      if (this.currentOrder?.type === 'attackMove' && this.updateAttackMove()) {
        return
      }
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
    this.updateFacingFromVector(this.target.x - this.x, this.target.y - this.y)
    this.updateTurretFacingFromVector(this.target.x - this.x, this.target.y - this.y)

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

  private updateAttackMove(): boolean {
    const unitTarget = this.findNearbyEnemyUnit()
    if (unitTarget) {
      this.target = unitTarget
      this.state = 'attacking'
      return true
    }

    const buildingTarget = this.findNearbyEnemyBuilding()
    if (buildingTarget) {
      this.target = buildingTarget
      this.state = 'attacking'
      return true
    }

    return false
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

  private findNearbyEnemyUnit(): IEntityRef | null {
    if (!this.def.attack) return null
    const rangePixels = this.def.attack.range * TILE_SIZE
    let nearest: IEntityRef | null = null
    let nearestDist = Infinity

    this.emit('find_enemy', this.x, this.y, rangePixels, this.playerId, (enemies: IEntityRef[]) => {
      for (const e of enemies) {
        if (!this.canAttackEntityRef(e)) continue
        const category = e.def?.category
        if (!category || this.isBuildingCategory(category)) continue
        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y)
        if (d < nearestDist) {
          nearestDist = d
          nearest = e
        }
      }
    })

    return nearest
  }

  private findNearbyEnemyBuilding(): IEntityRef | null {
    if (!this.def.attack) return null
    const rangePixels = this.def.attack.range * TILE_SIZE
    let nearest: IEntityRef | null = null
    let nearestDist = Infinity

    this.emit('find_enemy', this.x, this.y, rangePixels, this.playerId, (enemies: IEntityRef[]) => {
      for (const e of enemies) {
        if (!this.canAttackEntityRef(e)) continue
        const category = e.def?.category
        if (!category || !this.isBuildingCategory(category)) {
          continue
        }
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

  private isBuildingCategory(category: string): boolean {
    return category === 'base'
      || category === 'power'
      || category === 'production'
      || category === 'defense'
      || category === 'tech'
      || category === 'superweapon'
  }

  // ── Private: harvest ─────────────────────────────────────────

  private updateHarvest(delta: number): void {
    const HARVEST_TIME = 1000  // ms per load
    const DUMP_RANGE = TILE_SIZE * 3

    // Priority: if we're near a refinery with cargo, process unloading at 1 load/sec.
    if (this.cargoLoads > 0 && this.refineryId) {
      this.emit('get_entity_pos', this.refineryId, (pos: Position | null) => {
        if (pos) {
          const dist = Phaser.Math.Distance.Between(this.x, this.y, pos.x, pos.y)
          if (dist < DUMP_RANGE) {
            this.unloadTimer += delta
            const unloadIntervalMs = 1000 / Math.max(0.01, REFINERY_PROCESS_RATE)
            while (this.unloadTimer >= unloadIntervalMs && this.cargoLoads > 0) {
              this.unloadTimer -= unloadIntervalMs
              const perLoad = Math.max(1, Math.round(this.cargoValue / this.cargoLoads))
              this.emit('dump_ore', this.playerId, perLoad)
              this.cargoValue = Math.max(0, this.cargoValue - perLoad)
              this.cargoLoads--
            }
            if (this.cargoLoads <= 0) {
              this.cargoLoads = 0
              this.cargoValue = 0
              this.unloadTimer = 0
              this.emit('find_ore_field', this.x, this.y, (target: Position | null) => {
                if (target) this.startMoveTo(target)
              })
            }
          }
        }
      })
    }

    if (this.cargoLoads >= this.harvestCapacity) {
      // Full — return to refinery
      this.emit('find_refinery', this.playerId, (ref: IEntityRef | null) => {
        if (ref) {
          this.refineryId = ref.id
          if (this.def.id === 'chrono_miner') {
            // Chrono Miner signature behavior: teleport back to refinery to unload.
            this.setPosition(ref.x, ref.y)
            console.log('[ChronoMiner] Teleported to refinery for unload', {
              unitId: this.id,
              refineryId: ref.id,
              playerId: this.playerId,
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
    this.emit('check_ore_at', this.x, this.y, (oreAmount: number, tilePos: Position, isGems?: boolean) => {
      if (oreAmount > 0 && this.cargoLoads < this.harvestCapacity) {
        this.harvestTimer += delta
        if (this.harvestTimer >= HARVEST_TIME) {
          this.harvestTimer = 0
          this.cargoLoads += 1
          this.cargoValue += isGems ? GEMS_PER_LOAD : ORE_PER_LOAD
          this.emit('harvest_ore', tilePos, ORE_HARVEST_RATE)
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
    const isoKey = `${this.def.spriteKey}_iso_${this.getFacingSuffix()}`
    const fallbackKey = `${this.def.spriteKey}_iso_se`
    if (this.scene.textures.exists(isoKey)) {
      this.bodySprite.setTexture(isoKey)
    } else if (this.scene.textures.exists(fallbackKey)) {
      this.bodySprite.setTexture(fallbackKey)
    } else {
      this.bodySprite.setTexture(this.def.spriteKey)
    }
    this.bodySprite.setTint(this.factionColor)
  }

  private drawTurret(): void {
    if (!this.turretSprite) return
    const dirs: Array<'ne' | 'se' | 'sw' | 'nw'> = ['ne', 'se', 'sw', 'nw']
    const suffix = dirs[this.turretFacing] ?? 'se'
    const key = `${this.def.spriteKey}_turret_iso_${suffix}`
    if (this.scene.textures.exists(key)) {
      this.turretSprite.setTexture(key)
      this.turretSprite.setVisible(true)
    } else {
      this.turretSprite.setVisible(false)
    }
    this.turretSprite.setTint(this.factionColor)
  }

  private getFacingSuffix(): 'ne' | 'se' | 'sw' | 'nw' {
    const dirs: Array<'ne' | 'se' | 'sw' | 'nw'> = ['ne', 'se', 'sw', 'nw']
    return dirs[this.facing] ?? 'se'
  }

  private updateFacingFromVector(dx: number, dy: number): void {
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return
    const angle = Math.atan2(dy, dx)
    const normalized = (angle + Math.PI * 2) % (Math.PI * 2)
    this.facing = Math.round(normalized / (Math.PI / 2)) % 4
    if (!this.turretSprite) {
      this.turretFacing = this.facing
    }
    this.drawBody()
    this.drawTurret()
  }

  private updateTurretFacingFromVector(dx: number, dy: number): void {
    if (!this.turretSprite) return
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return
    const angle = Math.atan2(dy, dx)
    const normalized = (angle + Math.PI * 2) % (Math.PI * 2)
    this.turretFacing = Math.round(normalized / (Math.PI / 2)) % 4
    this.drawTurret()
  }

  private syncRenderTransform(): void {
    const screenPos = cartToScreen(this.x, this.y)
    this.visualRoot.setPosition(screenPos.x - this.x, screenPos.y - this.y)
    this.setDepth(screenPos.y + 10)
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
    const isFriendly = this.playerId === 0
    const barColor = isFriendly
      ? (pct > 0.3 ? 0x4ade80 : 0x2f9e5a)
      : (pct > 0.3 ? 0xe94560 : 0x9f2436)
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
    const w = this.def.category === 'infantry' ? 22 : this.def.category === 'aircraft' ? 20 : 30
    const h = this.def.category === 'infantry' ? 10 : this.def.category === 'aircraft' ? 8 : 14
    g.lineStyle(2, 0x00ffff, 0.9)
    // Segmented ellipse to mimic RA2 dashed selection ring.
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 1) continue
      const a0 = (i / 10) * Math.PI * 2
      const a1 = ((i + 1) / 10) * Math.PI * 2
      g.beginPath()
      g.moveTo(Math.cos(a0) * (w / 2), 2 + Math.sin(a0) * (h / 2))
      g.lineTo(Math.cos(a1) * (w / 2), 2 + Math.sin(a1) * (h / 2))
      g.strokePath()
    }
  }
}
