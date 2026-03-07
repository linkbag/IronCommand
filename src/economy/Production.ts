// ============================================================
// IRON COMMAND — Production System
// Build queues, tech prerequisites, power-aware progress
// ============================================================

import Phaser from 'phaser'
import type { EntityManager } from '../entities/EntityManager'
import type { Economy } from './Economy'
import type { GameState, BuildQueueItem, FactionSide, FactionId } from '../types'
import { UNIT_DEFS, getAvailableUnitIds } from '../entities/UnitDefs'
import { BUILDING_DEFS } from '../entities/BuildingDefs'
import { TILE_SIZE } from '../types'
import { FACTIONS } from '../data/factions'

export class Production extends Phaser.Events.EventEmitter {
  private em: EntityManager
  private economy: Economy
  private playerBuildSpeedMult: Map<number, number>

  // Per-building production queues (buildingId → queue items with progress tracking)
  private queues: Map<string, BuildQueueItem[]>

  // Primary production building per category per player
  // Key: "playerId:category" (e.g., "0:barracks"), Value: buildingId
  private primaryProducers: Map<string, string> = new Map()
  private spyVeterancyBonus: Map<number, { infantry: boolean; vehicles: boolean }> = new Map()

  constructor(entityManager: EntityManager, economy: Economy) {
    super()
    this.em = entityManager
    this.economy = economy
    this.queues = new Map()
    this.playerBuildSpeedMult = new Map()
  }

  // ── Queue API ────────────────────────────────────────────────

  /**
   * Add a unit or building to the production queue.
   * Returns true if queued successfully, false if prerequisites not met or insufficient credits.
   */
  queueProduction(
    playerId: number,
    producerId: string,
    defId: string,
    gameState: GameState,
  ): boolean {
    // Validate the producer building exists
    const producer = this.em.getBuilding(producerId)
    if (!producer || producer.playerId !== playerId || (producer.state !== 'active' && producer.state !== 'low_power')) {
      return false
    }

    // Determine if this is a unit or building def
    const unitDef = UNIT_DEFS[defId]
    const buildingDef = BUILDING_DEFS[defId]
    if (!unitDef && !buildingDef) {
      console.warn(`[Production] Unknown def: ${defId}`)
      return false
    }

    if (!this.canProducerCreateDef(producer.def.id, defId)) {
      return false
    }

    const def = unitDef ?? buildingDef!
    const cost = def.stats.cost

    // Check faction exclusivity for units/buildings
    const playerFaction = gameState.players.find(p => p.id === playerId)?.faction
    if (playerFaction && def.factionExclusive && def.factionExclusive !== playerFaction) {
      return false
    }

    // Check prerequisites
    if (!this.checkPrerequisites(playerId, defId)) {
      return false
    }

    // Check credits
    if (!this.economy.deductCredits(playerId, cost)) {
      return false
    }

    // Get or create queue for this building
    if (!this.queues.has(producerId)) {
      this.queues.set(producerId, [])
    }

    const queue = this.queues.get(producerId)!

    // Max queue length per building: 5
    if (queue.length >= 5) {
      // Refund
      this.economy.addCredits(playerId, cost)
      return false
    }

    const item: BuildQueueItem = {
      defId,
      progress: 0,
      producerId,
    }

    queue.push(item)
    // Sync with building's queue
    producer.productionQueue = queue.slice()
    console.log('[Pipeline] Production.queueProduction', { playerId, producerId, defId })
    this.emit('production_queued', producerId, defId, playerId)
    return true
  }

  /**
   * Cancel the item at queueIndex in the producer's queue.
   * Refunds 100% of cost for unstarted items, 50% for in-progress.
   */
  cancelProduction(playerId: number, producerId: string, queueIndex: number): void {
    const producer = this.em.getBuilding(producerId)
    if (!producer || producer.playerId !== playerId) return

    const queue = this.queues.get(producerId)
    if (!queue || queueIndex >= queue.length) return

    const item = queue[queueIndex]
    const def = UNIT_DEFS[item.defId] ?? BUILDING_DEFS[item.defId]
    if (!def) return

    // Full refund for items not yet started (index > 0), 50% if already in progress (index 0)
    const refundPct = queueIndex === 0 && item.progress > 0 ? 0.5 : 1.0
    const refund = Math.floor(def.stats.cost * refundPct)
    this.economy.addCredits(playerId, refund)

    queue.splice(queueIndex, 1)
    producer.productionQueue = queue.slice()

    this.emit('production_cancelled', producerId, item.defId, playerId)
  }

  /**
   * Check all prerequisites for building/unit.
   * Side-aware: skips prerequisites that belong to the opposite faction side.
   * E.g., barracks requires ['construction_yard', 'power_plant', 'tesla_reactor']
   * → Alliance skips tesla_reactor, Collective skips power_plant.
   */
  checkPrerequisites(playerId: number, defId: string, gameState?: GameState): boolean {
    const def = UNIT_DEFS[defId] ?? BUILDING_DEFS[defId]
    if (!def) return false

    const activeBuildingIds = this.em.getPlayerActiveBuildingIds(playerId)

    // Determine player's side from gameState or from their existing buildings
    let playerSide: FactionSide | null = null
    if (gameState) {
      const player = gameState.players.find(p => p.id === playerId)
      if (player) playerSide = FACTIONS[player.faction as FactionId]?.side ?? null
    }
    if (!playerSide) {
      // Detect side from active buildings
      for (const id of activeBuildingIds) {
        const bd = BUILDING_DEFS[id]
        if (bd?.side) { playerSide = bd.side; break }
      }
    }

    return def.stats.prerequisites.every(req => {
      const reqDef = BUILDING_DEFS[req]
      // If the prerequisite is a side-specific building from the opposite side, skip it
      if (reqDef && reqDef.side !== null && playerSide && reqDef.side !== playerSide) {
        return true
      }
      return activeBuildingIds.includes(req)
    })
  }

  /**
   * Get list of unit/building IDs available to produce for a player
   * given their faction and current buildings.
   */
  getAvailableProductions(
    playerId: number,
    producerBuildingId: string,
    factionId: string,
  ): string[] {
    const producer = this.em.getBuilding(producerBuildingId)
    if (!producer) return []

    const availableUnits = getAvailableUnitIds(factionId)
    const producerDef = producer.def

    return producerDef.produces.filter(defId => {
      if (UNIT_DEFS[defId]) {
        return availableUnits.includes(defId) && this.checkPrerequisites(playerId, defId)
      }
      if (BUILDING_DEFS[defId]) {
        return this.checkPrerequisites(playerId, defId)
      }
      return false
    })
  }

  // ── Update loop ──────────────────────────────────────────────

  update(delta: number, gameState: GameState): void {
    for (const player of gameState.players) {
      this.updatePlayerQueues(player.id, delta, gameState)
    }
  }

  setPlayerBuildSpeedMultiplier(playerId: number, multiplier: number): void {
    this.playerBuildSpeedMult.set(playerId, Math.max(0.1, multiplier))
  }

  private updatePlayerQueues(playerId: number, delta: number, _gameState: GameState): void {
    const powerSpeed = this.economy.getProductionSpeedMultiplier(playerId)
    const difficultySpeed = this.playerBuildSpeedMult.get(playerId) ?? 1
    const speedMult = powerSpeed * difficultySpeed
    const buildings = this.em.getBuildingsForPlayer(playerId)

    for (const building of buildings) {
      if (building.state !== 'active' && building.state !== 'low_power') continue
      const queue = this.queues.get(building.id)
      if (!queue || queue.length === 0) continue

      const item = queue[0]
      const def = UNIT_DEFS[item.defId] ?? BUILDING_DEFS[item.defId]
      if (!def) continue

      // RA2-style: multiple same-type production buildings grant speed bonus
      // Each extra building of the same type adds +35% production speed (diminishing)
      const sameTypeCount = buildings.filter(
        b => b.def.id === building.def.id && (b.state === 'active' || b.state === 'low_power')
      ).length
      const multiFactoryBonus = 1 + (sameTypeCount - 1) * 0.35

      const buildTimeMs = def.stats.buildTime * 1000
      const progressInc = (delta / buildTimeMs) * speedMult * multiFactoryBonus
      item.progress = Math.min(1, item.progress + progressInc)

      // Sync to building
      building.productionQueue = queue.slice()

      if (item.progress >= 1) {
        queue.shift()
        building.productionQueue = queue.slice()
        this.onProductionComplete(building.id, item.defId, playerId)
      }
    }
  }

  private onProductionComplete(producerId: string, defId: string, playerId: number): void {
    const producer = this.em.getBuilding(producerId)
    if (!producer) return

    const unitDef = UNIT_DEFS[defId]
    const buildingDef = BUILDING_DEFS[defId]

    if (unitDef) {
      // Spawn from the primary producer of this type (player-selectable)
      const primaryId = this.getPrimaryProducer(playerId, producer.def.id)
      const spawnBuilding = primaryId ? (this.em.getBuilding(primaryId) ?? producer) : producer

      const spawnPos = {
        x: spawnBuilding.x + spawnBuilding.def.footprint.w * TILE_SIZE / 2 + TILE_SIZE,
        y: spawnBuilding.y,
      }
      const unit = this.em.createUnit(playerId, defId, spawnPos.x, spawnPos.y)
      if (unit) {
        const bonus = this.spyVeterancyBonus.get(playerId)
        if (bonus?.infantry && unit.def.category === 'infantry') {
          unit.setVeterancy(1)
        }
        if (bonus?.vehicles && (unit.def.category === 'vehicle' || unit.def.category === 'harvester' || unit.def.category === 'naval')) {
          unit.setVeterancy(1)
        }

        // Auto-harvest if harvester
        if (unit.def.category === 'harvester') {
          const refinery = this.em.getNearestRefinery(unit.x, unit.y, playerId)
          if (refinery) unit.setRefineryId(refinery.id)
          unit.emit('find_ore_field', unit.x, unit.y, (target: { x: number; y: number } | null) => {
            if (target) unit.giveOrder({ type: 'harvest', target })
          })
        } else if (spawnBuilding.rallyPoint) {
          unit.giveOrder({ type: 'move', target: spawnBuilding.rallyPoint })
        }
        console.log('[Pipeline] Production.onProductionComplete unit', { producerId, defId, unitId: unit.id, playerId })
        this.emit('unit_produced', producerId, defId, unit.id, playerId)
      }
    } else if (buildingDef) {
      // Building production complete — notify scene to place it
      this.emit('building_produced', producerId, defId, playerId)
    }
  }

  // ── Primary producer selection ────────────────────────────────

  /**
   * Set a building as the primary producer for its type.
   * Units will spawn from this building. Click a barracks/war factory to set it as primary.
   */
  setPrimaryProducer(playerId: number, buildingId: string): void {
    const building = this.em.getBuilding(buildingId)
    if (!building || building.playerId !== playerId) return
    const key = `${playerId}:${building.def.id}`
    this.primaryProducers.set(key, buildingId)
    console.log(`[Production] Primary producer set: ${building.def.id} → ${buildingId}`)
    this.emit('primary_producer_changed', playerId, building.def.id, buildingId)
  }

  /**
   * Get the primary producer building for a given type.
   * Falls back to any active building of that type if primary is destroyed.
   */
  getPrimaryProducer(playerId: number, producerDefId: string): string | null {
    const key = `${playerId}:${producerDefId}`
    const primaryId = this.primaryProducers.get(key)

    // Validate it still exists and is active
    if (primaryId) {
      const building = this.em.getBuilding(primaryId)
      if (building && (building.state === 'active' || building.state === 'low_power') && building.playerId === playerId) {
        return primaryId
      }
      // Primary is dead/invalid — clear it
      this.primaryProducers.delete(key)
    }

    // Fallback: first active building of this type
    const fallback = this.em.getBuildingsForPlayer(playerId)
      .find(b => b.def.id === producerDefId && (b.state === 'active' || b.state === 'low_power'))
    if (fallback) {
      this.primaryProducers.set(key, fallback.id)
      return fallback.id
    }
    return null
  }

  /**
   * Check if a building is the primary producer for its type
   */
  isPrimaryProducer(playerId: number, buildingId: string): boolean {
    const building = this.em.getBuilding(buildingId)
    if (!building) return false
    return this.getPrimaryProducer(playerId, building.def.id) === buildingId
  }

  /**
   * Get the multi-factory speed bonus for display (e.g., "2x War Factory → +35% speed")
   */
  getSpeedBonus(playerId: number, producerDefId: string): number {
    const count = this.em.getBuildingsForPlayer(playerId)
      .filter(b => b.def.id === producerDefId && (b.state === 'active' || b.state === 'low_power')).length
    return 1 + (count - 1) * 0.35
  }

  grantSpyVeterancyBonus(playerId: number, targetDefId: string): void {
    const existing = this.spyVeterancyBonus.get(playerId) ?? { infantry: false, vehicles: false }
    if (targetDefId === 'barracks') existing.infantry = true
    if (targetDefId === 'war_factory') existing.vehicles = true
    this.spyVeterancyBonus.set(playerId, existing)
  }

  // ── Getters ──────────────────────────────────────────────────

  getQueue(buildingId: string): BuildQueueItem[] {
    return this.queues.get(buildingId) ?? []
  }

  getProgressForBuilding(buildingId: string): BuildQueueItem | null {
    const queue = this.queues.get(buildingId)
    return queue?.[0] ?? null
  }

  private canProducerCreateDef(producerDefId: string, defId: string): boolean {
    const unitDef = UNIT_DEFS[defId]
    const buildingDef = BUILDING_DEFS[defId]

    if (buildingDef) {
      return producerDefId === 'construction_yard'
    }
    if (!unitDef) return false

    if (defId === 'kirov') {
      return producerDefId === 'war_factory'
    }

    const categoryToProducers: Record<string, string[]> = {
      infantry: ['barracks'],
      vehicle: ['war_factory'],
      aircraft: ['air_force_command'],
      naval: ['naval_shipyard'],
      harvester: ['ore_refinery'],
    }

    return (categoryToProducers[unitDef.category] ?? []).includes(producerDefId)
  }
}
