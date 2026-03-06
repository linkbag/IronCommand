// ============================================================
// IRON COMMAND — Entity Manager
// Central registry + factory for all units and buildings
// Creates placeholder textures, tracks entities by ID
// ============================================================

import Phaser from 'phaser'
import { Unit } from './Unit'
import { Building } from './Building'
import { UNIT_DEFS } from './UnitDefs'
import { BUILDING_DEFS } from './BuildingDefs'
import type { UnitDef, BuildingDef, Position } from '../types'
import { TILE_SIZE } from '../types'
import { FACTIONS } from '../data/factions'
import type { FactionId } from '../types'

export class EntityManager extends Phaser.Events.EventEmitter {
  private scene: Phaser.Scene
  private units: Map<string, Unit>
  private buildings: Map<string, Building>
  private nextId: number

  constructor(scene: Phaser.Scene) {
    super()
    this.scene = scene
    this.units = new Map()
    this.buildings = new Map()
    this.nextId = 1

    this.createTextures()
    this.wireUnitEvents()
  }

  // ── Texture generation ───────────────────────────────────────

  createTextures(): void {
    this.createUnitTextures()
    this.createBuildingTextures()
  }

  private createUnitTextures(): void {
    for (const [id, def] of Object.entries(UNIT_DEFS)) {
      const key = def.spriteKey
      if (this.scene.textures.exists(key)) continue

      const size = 32
      const g = this.scene.add.graphics()

      switch (def.category) {
        case 'infantry':
          g.fillStyle(0x888888)
          g.fillCircle(size / 2, size / 2, 8)
          break
        case 'aircraft':
          g.fillStyle(0x888888)
          g.fillTriangle(size / 2, 4, size - 4, size - 4, 4, size - 4)
          break
        default:
          g.fillStyle(0x888888)
          g.fillRect(4, 8, size - 8, size - 16)
      }

      g.generateTexture(key, size, size)
      g.destroy()
      void id  // suppress unused warning
    }
  }

  private createBuildingTextures(): void {
    for (const [id, def] of Object.entries(BUILDING_DEFS)) {
      const key = def.spriteKey
      if (this.scene.textures.exists(key)) continue

      const w = def.footprint.w * TILE_SIZE
      const h = def.footprint.h * TILE_SIZE
      const g = this.scene.add.graphics()
      g.fillStyle(0x666666)
      g.fillRect(0, 0, w, h)
      g.lineStyle(1, 0xffffff, 0.3)
      g.strokeRect(0, 0, w, h)
      g.generateTexture(key, w, h)
      g.destroy()
      void id
    }
  }

  // ── Factory methods ──────────────────────────────────────────

  createUnit(
    playerId: number,
    defId: string,
    worldX: number,
    worldY: number,
  ): Unit | null {
    const def = UNIT_DEFS[defId]
    if (!def) {
      console.warn(`[EntityManager] Unknown unit def: ${defId}`)
      return null
    }

    const id = this.generateId('u')
    const factionColor = this.getFactionColor(playerId)
    const unit = new Unit(this.scene, id, playerId, def, factionColor, worldX, worldY)

    this.units.set(id, unit)
    this.wireUnit(unit)

    this.emit('unit_created', { entityId: id, playerId })
    return unit
  }

  createBuilding(
    playerId: number,
    defId: string,
    tileCol: number,
    tileRow: number,
  ): Building | null {
    const def = BUILDING_DEFS[defId]
    if (!def) {
      console.warn(`[EntityManager] Unknown building def: ${defId}`)
      return null
    }

    const id = this.generateId('b')
    const factionColor = this.getFactionColor(playerId)
    const building = new Building(this.scene, id, playerId, def, factionColor, tileCol, tileRow)

    this.buildings.set(id, building)
    this.wireBuilding(building)

    this.emit('building_placed', { entityId: id, playerId })
    return building
  }

  // ── Query methods ────────────────────────────────────────────

  getUnit(id: string): Unit | undefined {
    return this.units.get(id)
  }

  getBuilding(id: string): Building | undefined {
    return this.buildings.get(id)
  }

  getEntity(id: string): Unit | Building | undefined {
    return this.units.get(id) ?? this.buildings.get(id)
  }

  /** Flat list of all entities (units + buildings) for HUD minimap / info panel */
  getAllEntities(): Array<{
    id: string; playerId: number; type: string; x: number; y: number;
    isAlive: boolean; defId: string; hp: number; maxHp: number;
  }> {
    const result: Array<{
      id: string; playerId: number; type: string; x: number; y: number;
      isAlive: boolean; defId: string; hp: number; maxHp: number;
    }> = []
    for (const u of this.units.values()) {
      result.push({
        id: u.id, playerId: u.playerId, type: 'unit',
        x: u.x, y: u.y, isAlive: u.state !== 'dying',
        defId: u.def.id, hp: u.hp, maxHp: u.def.stats.maxHp,
      })
    }
    for (const b of this.buildings.values()) {
      result.push({
        id: b.id, playerId: b.playerId, type: 'building',
        x: b.x, y: b.y, isAlive: b.state !== 'dying',
        defId: b.def.id, hp: b.hp, maxHp: b.def.stats.maxHp,
      })
    }
    return result
  }

  getAllUnits(): Unit[] {
    return Array.from(this.units.values())
  }

  getAllBuildings(): Building[] {
    return Array.from(this.buildings.values())
  }

  getUnitsForPlayer(playerId: number): Unit[] {
    return Array.from(this.units.values()).filter(u => u.playerId === playerId)
  }

  getBuildingsForPlayer(playerId: number): Building[] {
    return Array.from(this.buildings.values()).filter(b => b.playerId === playerId)
  }

  /** Returns all units within pixel radius of (x,y) */
  getUnitsInRange(x: number, y: number, radiusPixels: number): Unit[] {
    return Array.from(this.units.values()).filter(u =>
      Phaser.Math.Distance.Between(x, y, u.x, u.y) <= radiusPixels
    )
  }

  /** Returns all buildings within pixel radius of (x,y) */
  getBuildingsInRange(x: number, y: number, radiusPixels: number): Building[] {
    return Array.from(this.buildings.values()).filter(b =>
      Phaser.Math.Distance.Between(x, y, b.x, b.y) <= radiusPixels
    )
  }

  /** Returns closest enemy unit from (x,y) within range, as seen by playerId */
  getEnemyUnitsInRange(
    x: number,
    y: number,
    radiusPixels: number,
    ownPlayerId: number,
  ): Unit[] {
    return this.getUnitsInRange(x, y, radiusPixels).filter(
      u => u.playerId !== ownPlayerId && u.state !== 'dying'
    )
  }

  getEnemyBuildingsInRange(
    x: number,
    y: number,
    radiusPixels: number,
    ownPlayerId: number,
  ): Building[] {
    return this.getBuildingsInRange(x, y, radiusPixels).filter(
      b => b.playerId !== ownPlayerId && b.state !== 'dying'
    )
  }

  /** Find nearest refinery for a player */
  getNearestRefinery(x: number, y: number, playerId: number): Building | null {
    let nearest: Building | null = null
    let nearestDist = Infinity
    for (const b of this.buildings.values()) {
      if (b.playerId !== playerId || b.def.id !== 'ore_refinery' || b.state === 'dying') continue
      const d = Phaser.Math.Distance.Between(x, y, b.x, b.y)
      if (d < nearestDist) {
        nearestDist = d
        nearest = b
      }
    }
    return nearest
  }

  /** Check if a player has a specific building type active */
  playerHasBuilding(playerId: number, defId: string): boolean {
    return Array.from(this.buildings.values()).some(
      b => b.playerId === playerId && b.def.id === defId && b.state === 'active'
    )
  }

  /** Get all building defIds that a player currently has active */
  getPlayerActiveBuildingIds(playerId: number): string[] {
    return Array.from(this.buildings.values())
      .filter(b => b.playerId === playerId && b.state === 'active')
      .map(b => b.def.id)
  }

  removeEntity(id: string): void {
    const unit = this.units.get(id)
    if (unit) {
      this.units.delete(id)
      this.emit('unit_destroyed', { entityId: id, playerId: unit.playerId })
      return
    }
    const building = this.buildings.get(id)
    if (building) {
      this.buildings.delete(id)
      this.emit('building_destroyed', { entityId: id, playerId: building.playerId })
    }
  }

  // ── Main update ──────────────────────────────────────────────

  update(delta: number): void {
    for (const unit of this.units.values()) {
      unit.update(delta)
    }
    for (const building of this.buildings.values()) {
      building.update(delta)
    }
  }

  // ── Def lookups ──────────────────────────────────────────────

  getUnitDef(defId: string): UnitDef | undefined {
    return UNIT_DEFS[defId]
  }

  getBuildingDef(defId: string): BuildingDef | undefined {
    return BUILDING_DEFS[defId]
  }

  // ── Private helpers ──────────────────────────────────────────

  private generateId(prefix: string): string {
    return `${prefix}${this.nextId++}`
  }

  private getFactionColor(playerId: number): number {
    // Cycle through faction colors for multi-player
    const factionIds = Object.keys(FACTIONS) as FactionId[]
    const factionId = factionIds[playerId % factionIds.length]
    return FACTIONS[factionId].color
  }

  // Wire up event handlers for a unit's event bus
  private wireUnit(unit: Unit): void {
    // Handle unit death
    unit.on('unit_ready_to_remove', (u: Unit) => {
      this.removeEntity(u.id)
    })

    // Provide nearby enemy resolution
    unit.on('find_enemy', (
      x: number, y: number, range: number, ownPlayerId: number,
      cb: (enemies: Unit[]) => void
    ) => {
      const enemies = this.getEnemyUnitsInRange(x, y, range, ownPlayerId)
      cb(enemies)
    })

    // Target resolution by ID
    unit.on('resolve_target', (targetId: string, cb: (ref: Unit | Building | undefined) => void) => {
      cb(this.getEntity(targetId))
    })

    // Get entity position
    unit.on('get_entity_pos', (entityId: string, cb: (pos: Position | null) => void) => {
      const e = this.getEntity(entityId)
      cb(e ? { x: e.x, y: e.y } : null)
    })

    // Find nearest refinery
    unit.on('find_refinery', (playerId: number, cb: (ref: Building | null) => void) => {
      cb(this.getNearestRefinery(unit.x, unit.y, playerId))
    })

    // Fire at target — forwarded to Combat system via EntityManager event
    unit.on('fire_at_target', (attacker: Unit, target: Unit | Building) => {
      this.emit('fire_at_target', attacker, target)
    })

    // Harvest events — forwarded to Economy
    unit.on('dump_ore', (playerId: number, amount: number) => {
      this.emit('ore_dumped', playerId, amount)
    })

    unit.on('harvest_ore', (tilePos: Position, amount: number) => {
      this.emit('ore_harvested', tilePos, amount)
    })

    unit.on('find_ore_field', (x: number, y: number, cb: (pos: Position | null) => void) => {
      this.emit('find_ore_field', x, y, cb)
    })

    unit.on('check_ore_at', (x: number, y: number, cb: (amount: number, pos: Position) => void) => {
      this.emit('check_ore_at', x, y, cb)
    })
  }

  private wireBuilding(building: Building): void {
    building.on('building_ready_to_remove', (b: Building) => {
      this.removeEntity(b.id)
    })

    building.on('construction_complete', (b: Building) => {
      this.emit('construction_complete', b)
    })

    building.on('building_died', (b: Building) => {
      this.emit('building_died', b)
    })
  }

  private wireUnitEvents(): void {
    // No-op: per-unit wiring happens in wireUnit()
  }
}
