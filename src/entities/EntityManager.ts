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
import type { UnitDef, BuildingDef, Position, FactionId } from '../types'
import { TILE_SIZE } from '../types'
import { FACTIONS } from '../data/factions'
import { getPlayerSlotColor } from '../data/playerSlots'

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

    const safeX = Number.isFinite(worldX) ? worldX : 0
    const safeY = Number.isFinite(worldY) ? worldY : 0
    if (safeX !== worldX || safeY !== worldY) {
      console.warn(`[EntityManager] Invalid spawn coordinates for ${defId}; using fallback`, { worldX, worldY })
    }

    const id = this.generateId('u')
    const factionColor = this.getFactionColor(playerId)
    const unit = new Unit(this.scene, id, playerId, def, factionColor, safeX, safeY)
    this.applyEntityTint(unit, factionColor)

    // Safety: ensure produced units are in the scene and rendered above terrain/fog.
    const maybeDisplayList = (unit as unknown as { displayList?: unknown }).displayList
    if (!maybeDisplayList) {
      this.scene.add.existing(unit)
    }
    unit.setDepth(Math.max(unit.depth, 12))

    this.units.set(id, unit)
    this.wireUnit(unit)

    console.log('[Pipeline] EntityManager.createUnit', { id, playerId, defId, x: safeX, y: safeY, depth: unit.depth })
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
    this.applyEntityTint(building, factionColor)

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

  private alliedPairs: Set<string> = new Set()

  private makeAllyKey(playerA: number, playerB: number): string {
    const a = Math.min(playerA, playerB)
    const b = Math.max(playerA, playerB)
    return `${a}|${b}`
  }

  setAllianceMode(alliedPairs: Array<[number, number]>): void {
    this.alliedPairs.clear()
    for (const [a, b] of alliedPairs) {
      if (a === b) continue
      this.alliedPairs.add(this.makeAllyKey(a, b))
    }
    console.log('[EntityManager] Explicit alliances set', alliedPairs)
  }

  isAlly(playerA: number, playerB: number): boolean {
    if (playerA === playerB) return true
    if (playerA < 0 || playerB < 0) return false
    return this.alliedPairs.has(this.makeAllyKey(playerA, playerB))
  }

  /** Check if two players are enemies (accounts for explicit alliances) */
  isEnemy(playerA: number, playerB: number): boolean {
    if (playerA === playerB) return false
    if (playerB < 0) return true // neutral buildings
    if (playerA < 0) return true
    return !this.isAlly(playerA, playerB)
  }

  /** Find the nearest air force command building for a player (RA2 parity: aircraft RTB here to rearm) */
  getNearestAirfield(x: number, y: number, playerId: number): Building | null {
    let nearest: Building | null = null
    let nearestDist = Infinity
    for (const b of this.buildings.values()) {
      if (b.playerId !== playerId || b.def.id !== 'air_force_command' || b.state === 'dying') continue
      const d = Phaser.Math.Distance.Between(x, y, b.x, b.y)
      if (d < nearestDist) {
        nearestDist = d
        nearest = b
      }
    }
    return nearest
  }

  /** Returns closest enemy unit from (x,y) within range, as seen by playerId */
  getEnemyUnitsInRange(
    x: number,
    y: number,
    radiusPixels: number,
    ownPlayerId: number,
  ): Unit[] {
    return this.getUnitsInRange(x, y, radiusPixels).filter(
      u => this.isEnemy(ownPlayerId, u.playerId) && u.state !== 'dying'
    )
  }

  getEnemyBuildingsInRange(
    x: number,
    y: number,
    radiusPixels: number,
    ownPlayerId: number,
  ): Building[] {
    return this.getBuildingsInRange(x, y, radiusPixels).filter(
      b => this.isEnemy(ownPlayerId, b.playerId) && b.state !== 'dying'
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
      b => b.playerId === playerId && b.def.id === defId && (b.state === 'active' || b.state === 'low_power')
    )
  }

  /** Get all building defIds that a player currently has active */
  getPlayerActiveBuildingIds(playerId: number): string[] {
    return Array.from(this.buildings.values())
      .filter(b => b.playerId === playerId && (b.state === 'active' || b.state === 'low_power'))
      .map(b => b.def.id)
  }

  // ── Transport operations ──────────────────────────────────────

  /** Load a passenger unit into a transport, if close enough and capacity allows. Returns true on success. */
  loadUnitIntoTransport(passengerId: string, transportId: string): boolean {
    const passenger = this.units.get(passengerId)
    const transport = this.units.get(transportId)
    if (!passenger || !transport) return false
    if (passenger.id === transport.id) return false
    if (passenger.playerId !== transport.playerId) return false
    if (passenger.state === 'dying' || transport.state === 'dying') return false
    if (passenger.isEmbarked()) return false
    if (!transport.canTransportUnits()) return false
    if (!transport.canCarryCategory(passenger.def.category)) return false
    if (!transport.hasCargoSpace()) return false

    const dist = Phaser.Math.Distance.Between(passenger.x, passenger.y, transport.x, transport.y)
    if (dist > transport.getTransportLoadRangePixels()) return false
    if (!transport.addTransportedUnit(passenger.id)) return false

    passenger.setEmbarkedTransportId(transport.id)
    passenger.setPosition(transport.x, transport.y)
    this.emit('unit_loaded', {
      transportId: transport.id,
      passengerId: passenger.id,
      playerId: transport.playerId,
    })
    return true
  }

  /** Unload all passengers from a transport near the given target position. Returns count unloaded. */
  unloadTransportAt(transportId: string, target: import('../types').Position): number {
    const transport = this.units.get(transportId)
    if (!transport || !transport.canTransportUnits()) return 0
    const cargoIds = transport.getTransportedUnitIds()
    if (cargoIds.length === 0) return 0

    const maxRadius = Math.max(2, Math.round(transport.getTransportUnloadRadiusTiles()))
    const targetTile = {
      col: Math.floor(target.x / TILE_SIZE),
      row: Math.floor(target.y / TILE_SIZE),
    }
    const usedTiles = new Set<string>()
    let unloaded = 0

    for (const cargoId of cargoIds) {
      const passenger = this.units.get(cargoId)
      if (!passenger || passenger.state === 'dying') {
        transport.removeTransportedUnit(cargoId)
        continue
      }

      const dropTile = this.findNearestOpenDropTile(targetTile, usedTiles, maxRadius)
      if (!dropTile) continue

      if (!transport.removeTransportedUnit(cargoId)) continue
      passenger.setEmbarkedTransportId(null)
      passenger.setPosition(
        dropTile.col * TILE_SIZE + TILE_SIZE / 2,
        dropTile.row * TILE_SIZE + TILE_SIZE / 2,
      )
      usedTiles.add(`${dropTile.col},${dropTile.row}`)
      unloaded++
    }
    return unloaded
  }

  private findNearestOpenDropTile(
    origin: import('../types').TileCoord,
    usedTiles: Set<string>,
    maxRadius: number,
  ): import('../types').TileCoord | null {
    for (let r = 0; r <= maxRadius; r++) {
      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue
          const col = origin.col + dc
          const row = origin.row + dr
          const key = `${col},${row}`
          if (usedTiles.has(key)) continue
          // Check if anyone occupies that tile already
          let occupied = false
          for (const u of this.units.values()) {
            if (u.isEmbarked() || u.state === 'dying') continue
            const uCol = Math.floor(u.x / TILE_SIZE)
            const uRow = Math.floor(u.y / TILE_SIZE)
            if (uCol === col && uRow === row) { occupied = true; break }
          }
          if (!occupied) return { col, row }
        }
      }
    }
    return null
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

  private separationCounter = 0

  update(delta: number): void {
    for (const unit of this.units.values()) {
      unit.update(delta)
    }
    for (const building of this.buildings.values()) {
      building.update(delta)
    }

    // Unit separation — nudge overlapping units apart (run every 3 frames for perf)
    this.separationCounter++
    if (this.separationCounter >= 3) {
      this.separationCounter = 0
      this.separateUnits()
    }
  }

  /** Push overlapping units apart so they don't stack on the same spot */
  private separateUnits(): void {
    const units = Array.from(this.units.values()).filter(u => u.hp > 0 && u.state !== 'dying')
    const MIN_DIST = 14 // minimum pixel distance between unit centers
    const PUSH_FORCE = 2 // pixels per separation tick

    for (let i = 0; i < units.length; i++) {
      const a = units[i]
      if (a.state === 'moving') continue // don't nudge moving units
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j]
        if (b.state === 'moving') continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < MIN_DIST && dist > 0.1) {
          // Push apart
          const nx = dx / dist
          const ny = dy / dist
          const push = PUSH_FORCE * (1 - dist / MIN_DIST)
          if (a.state === 'idle') { a.x -= nx * push; a.y -= ny * push }
          if (b.state === 'idle') { b.x += nx * push; b.y += ny * push }
        } else if (dist <= 0.1) {
          // Exactly overlapping — random nudge
          const angle = Math.random() * Math.PI * 2
          if (a.state === 'idle') { a.x += Math.cos(angle) * PUSH_FORCE; a.y += Math.sin(angle) * PUSH_FORCE }
          if (b.state === 'idle') { b.x -= Math.cos(angle) * PUSH_FORCE; b.y -= Math.sin(angle) * PUSH_FORCE }
        }
      }
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
    const players = (this.scene as Phaser.Scene & {
      gameState?: { players?: Array<{ id: number; color: number }> }
    }).gameState?.players
    const fromGameState = players?.find(p => p.id === playerId)?.color
    if (typeof fromGameState === 'number') return fromGameState

    if (playerId >= 0) return getPlayerSlotColor(playerId)

    // Fallback for unexpected ids.
    const factionIds = Object.keys(FACTIONS) as FactionId[]
    const factionId = factionIds[Math.abs(playerId) % factionIds.length]
    return FACTIONS[factionId]?.color ?? getPlayerSlotColor(0)
  }

  private applyEntityTint(entity: Phaser.GameObjects.Container, color: number): void {
    // Units/buildings are containers; tint the first graphic-like child as the main body.
    const mainChild = entity.list.find((child) =>
      child instanceof Phaser.GameObjects.Graphics || child instanceof Phaser.GameObjects.Image || child instanceof Phaser.GameObjects.Sprite
    )
    if (!mainChild) return
    ;(mainChild as Phaser.GameObjects.GameObject & { setTint?: (value: number) => unknown }).setTint?.(color)
  }

  // Wire up event handlers for a unit's event bus
  private wireUnit(unit: Unit): void {
    // Handle unit death
    unit.on('unit_ready_to_remove', (u: Unit) => {
      this.removeEntity(u.id)
    })
    unit.on('unit_damaged', (payload: { unit: Unit; sourcePlayerId: number; amount: number }) => {
      this.emit('unit_damaged', payload)
    })

    // Provide nearby enemy resolution
    unit.on('find_enemy', (
      x: number, y: number, range: number, ownPlayerId: number,
      cb: (enemies: Array<Unit | Building>) => void
    ) => {
      const enemies = [
        ...this.getEnemyUnitsInRange(x, y, range, ownPlayerId),
        ...this.getEnemyBuildingsInRange(x, y, range, ownPlayerId),
      ]
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

    unit.on('find_ore_field', (
      x: number,
      y: number,
      cb: (pos: Position | null) => void,
      opts?: { maxRadiusTiles?: number; minOreAmount?: number },
    ) => {
      this.emit('find_ore_field', x, y, cb, opts)
    })

    unit.on('check_ore_at', (x: number, y: number, cb: (amount: number, pos: Position) => void) => {
      this.emit('check_ore_at', x, y, cb)
    })

    // Aircraft RTB: find nearest airfield for rearming (RA2 parity)
    unit.on('find_airfield', (playerId: number, cb: (airfield: Building | null) => void) => {
      cb(this.getNearestAirfield(unit.x, unit.y, playerId))
    })

    // Spy infiltration
    unit.on('spy_infiltrate', (spy: Unit, target: Unit | Building) => {
      this.emit('spy_infiltrate', spy, target)
    })

    unit.on('engineer_repair_target', (
      engineer: Unit,
      target: Unit | Building,
      cb: (done: boolean) => void,
    ) => {
      this.emit('engineer_repair_target', engineer, target, cb)
    })

    unit.on('engineer_repair_bridge', (
      engineer: Unit,
      targetPos: Position,
      cb: (done: boolean) => void,
    ) => {
      this.emit('engineer_repair_bridge', engineer, targetPos, cb)
    })

    // Transport boarding: passenger requests to board a specific transport
    unit.on('request_load_unit', (passengerId: string, transportId: string) => {
      this.loadUnitIntoTransport(passengerId, transportId)
    })

    // Transport unloading: transport deploys its cargo at a target position
    unit.on('request_transport_unload', (transportId: string, target: Position) => {
      this.unloadTransportAt(transportId, target)
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
    building.on('building_damaged', (payload: { building: Building; sourcePlayerId: number; amount: number }) => {
      this.emit('building_damaged', payload)
    })

    building.on('find_enemy', (
      x: number, y: number, range: number, ownPlayerId: number,
      cb: (enemies: Array<Unit | Building>) => void
    ) => {
      const enemies = [
        ...this.getEnemyUnitsInRange(x, y, range, ownPlayerId),
        ...this.getEnemyBuildingsInRange(x, y, range, ownPlayerId),
      ]
      cb(enemies)
    })

    building.on('fire_at_target', (attacker: Building, target: Unit | Building) => {
      this.emit('fire_at_target', attacker, target)
    })
  }

  private wireUnitEvents(): void {
    // No-op: per-unit wiring happens in wireUnit()
  }
}
