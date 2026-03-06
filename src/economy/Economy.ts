// ============================================================
// IRON COMMAND — Economy System
// Credits tracking, ore harvesting cycle, power management
// ============================================================

import Phaser from 'phaser'
import type { EntityManager } from '../entities/EntityManager'
import type { GameState } from '../types'
import { STARTING_CREDITS, POWER_LOW_THRESHOLD } from '../types'

interface PowerState {
  generated: number
  consumed: number
  isLow: boolean
}

export class Economy extends Phaser.Events.EventEmitter {
  private credits: Map<number, number>       // playerId → credits
  private powerState: Map<number, PowerState> // playerId → power
  private em: EntityManager

  constructor(entityManager: EntityManager, playerIds: number[]) {
    super()
    this.em = entityManager
    this.credits = new Map()
    this.powerState = new Map()

    for (const id of playerIds) {
      this.credits.set(id, STARTING_CREDITS)
      this.powerState.set(id, { generated: 0, consumed: 0, isLow: false })
    }

    this.wireEntityManager()
  }

  // ── Credits API ──────────────────────────────────────────────

  getCredits(playerId: number): number {
    return this.credits.get(playerId) ?? 0
  }

  addCredits(playerId: number, amount: number): void {
    const current = this.credits.get(playerId) ?? 0
    this.credits.set(playerId, current + amount)
    this.emit('credits_changed', playerId, current + amount)
  }

  /** Returns true if deducted, false if insufficient funds */
  deductCredits(playerId: number, amount: number): boolean {
    const current = this.credits.get(playerId) ?? 0
    if (current < amount) return false
    this.credits.set(playerId, current - amount)
    this.emit('credits_changed', playerId, current - amount)
    return true
  }

  // ── Power API ────────────────────────────────────────────────

  getPowerBalance(playerId: number): number {
    const state = this.powerState.get(playerId)
    if (!state) return 0
    return state.generated - state.consumed
  }

  getPowerState(playerId: number): PowerState {
    return this.powerState.get(playerId) ?? { generated: 0, consumed: 0, isLow: false }
  }

  isPowerLow(playerId: number): boolean {
    return this.powerState.get(playerId)?.isLow ?? false
  }

  /** Speed multiplier for production when power is low */
  getProductionSpeedMultiplier(playerId: number): number {
    return this.isPowerLow(playerId) ? 0.5 : 1.0
  }

  // ── Main update ──────────────────────────────────────────────

  update(_delta: number, gameState: GameState): void {
    for (const player of gameState.players) {
      this.updatePower(player.id)
    }
  }

  // ── Power calculation ────────────────────────────────────────

  private updatePower(playerId: number): void {
    let generated = 0
    let consumed = 0

    const buildings = this.em.getBuildingsForPlayer(playerId)
    for (const b of buildings) {
      if (b.state === 'dying' || b.state === 'constructing') continue
      const power = b.def.providespower
      if (power > 0) {
        generated += power
      } else {
        consumed += -power
      }
    }

    const wasLow = this.powerState.get(playerId)?.isLow ?? false
    const ratio = generated === 0 ? 0 : generated / (generated + consumed)
    const isLow = consumed > 0 && ratio < POWER_LOW_THRESHOLD

    const prev = this.powerState.get(playerId)
    this.powerState.set(playerId, { generated, consumed, isLow })

    // Always emit so HUD stays in sync (not just on low-power toggle)
    if (!prev || prev.generated !== generated || prev.consumed !== consumed) {
      this.emit('power_state_changed', playerId, isLow)
    }

    if (isLow !== wasLow) {
      // Notify buildings of low power status change
      for (const b of buildings) {
        b.setLowPower(isLow)
      }
    }
  }

  // ── Ore dump (harvester returns to refinery) ─────────────────

  private wireEntityManager(): void {
    this.em.on('ore_dumped', (playerId: number, amount: number) => {
      // Convert ore load to credits (RA2-authentic pacing)
      // Each ore unit = 1 credit (full harvester dump = ~$1500)
      const credits = Math.floor(amount)
      this.addCredits(playerId, credits)
      this.emit('ore_converted', playerId, amount, credits)
    })
  }
}
