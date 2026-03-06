// ============================================================
// IRON COMMAND — Production System
// Build queues, tech prerequisites, power-aware progress
// ============================================================

import Phaser from 'phaser'
import type { EntityManager } from '../entities/EntityManager'
import type { Economy } from './Economy'
import type { GameState, BuildQueueItem } from '../types'
import { UNIT_DEFS, getAvailableUnitIds } from '../entities/UnitDefs'
import { BUILDING_DEFS } from '../entities/BuildingDefs'
import { TILE_SIZE } from '../types'

export class Production extends Phaser.Events.EventEmitter {
  private em: EntityManager
  private economy: Economy

  // Per-building production queues (buildingId → queue items with progress tracking)
  private queues: Map<string, BuildQueueItem[]>

  constructor(entityManager: EntityManager, economy: Economy) {
    super()
    this.em = entityManager
    this.economy = economy
    this.queues = new Map()
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
    if (!producer || producer.playerId !== playerId || producer.state !== 'active') {
      return false
    }

    // Determine if this is a unit or building def
    const unitDef = UNIT_DEFS[defId]
    const buildingDef = BUILDING_DEFS[defId]
    if (!unitDef && !buildingDef) {
      console.warn(`[Production] Unknown def: ${defId}`)
      return false
    }

    const def = unitDef ?? buildingDef!
    const cost = def.stats.cost

    // Check faction exclusivity for units
    if (unitDef?.factionExclusive) {
      const playerFaction = gameState.players.find(p => p.id === playerId)?.faction
      if (playerFaction && unitDef.factionExclusive !== playerFaction) {
        return false
      }
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
   */
  checkPrerequisites(playerId: number, defId: string): boolean {
    const def = UNIT_DEFS[defId] ?? BUILDING_DEFS[defId]
    if (!def) return false

    const activeBuildingIds = this.em.getPlayerActiveBuildingIds(playerId)
    return def.stats.prerequisites.every(req => activeBuildingIds.includes(req))
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

  private updatePlayerQueues(playerId: number, delta: number, _gameState: GameState): void {
    const speedMult = this.economy.getProductionSpeedMultiplier(playerId)
    const buildings = this.em.getBuildingsForPlayer(playerId)

    for (const building of buildings) {
      if (building.state !== 'active') continue
      const queue = this.queues.get(building.id)
      if (!queue || queue.length === 0) continue

      const item = queue[0]
      const def = UNIT_DEFS[item.defId] ?? BUILDING_DEFS[item.defId]
      if (!def) continue

      const buildTimeMs = def.stats.buildTime * 1000
      const progressInc = (delta / buildTimeMs) * speedMult
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
      // Spawn unit at rally point or producer exit
      const spawnPos = producer.rallyPoint ?? {
        x: producer.x + producer.def.footprint.w * TILE_SIZE / 2 + TILE_SIZE,
        y: producer.y,
      }
      const unit = this.em.createUnit(playerId, defId, spawnPos.x, spawnPos.y)
      if (unit) {
        // Auto-harvest if harvester
        if (unit.def.category === 'harvester') {
          const refinery = this.em.getNearestRefinery(unit.x, unit.y, playerId)
          if (refinery) unit.setRefineryId(refinery.id)
          unit.emit('find_ore_field', unit.x, unit.y, (target: { x: number; y: number } | null) => {
            if (target) unit.giveOrder({ type: 'harvest', target })
          })
        }
        this.emit('unit_produced', producerId, defId, unit.id, playerId)
      }
    } else if (buildingDef) {
      // Building production complete — notify scene to place it
      this.emit('building_produced', producerId, defId, playerId)
    }
  }

  // ── Getters ──────────────────────────────────────────────────

  getQueue(buildingId: string): BuildQueueItem[] {
    return this.queues.get(buildingId) ?? []
  }

  getProgressForBuilding(buildingId: string): BuildQueueItem | null {
    const queue = this.queues.get(buildingId)
    return queue?.[0] ?? null
  }
}
