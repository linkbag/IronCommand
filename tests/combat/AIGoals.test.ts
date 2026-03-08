import { describe, expect, it } from 'vitest'
import { buildUltimateGoalPlan, type AIUltimateGoalSignals } from '../../src/combat/AIGoals'

function makeSignals(overrides: Partial<AIUltimateGoalSignals> = {}): AIUltimateGoalSignals {
  return {
    credits: 1000,
    reserveCredits: 1500,
    mineExhaustionPressure: 0.2,
    hasUntappedMines: false,
    armyCount: 8,
    armyCap: 28,
    hasAnyProduction: true,
    idleProductionSlots: 1,
    knownEnemyForceCount: 8,
    nearbyEnemyForceCount: 0,
    idleCombatUnits: 3,
    scoutOverdue: false,
    currentlyAttacking: false,
    ...overrides,
  }
}

describe('buildUltimateGoalPlan', () => {
  it('returns all ultimate goals exactly once', () => {
    const plan = buildUltimateGoalPlan(makeSignals())
    const ids = plan.map(p => p.id)
    expect(ids).toEqual(expect.arrayContaining([
      'spend_money_efficiently',
      'exhaust_map_mines',
      'maximize_unit_production',
      'destroy_enemies',
      'scout_enemy_forces',
      'auto_engage_enemies',
    ]))
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i - 1]!.priority).toBeGreaterThanOrEqual(plan[i]!.priority)
    }
  })

  it('prioritizes auto-engage when nearby enemies are present', () => {
    const plan = buildUltimateGoalPlan(
      makeSignals({
        nearbyEnemyForceCount: 6,
        idleCombatUnits: 5,
      }),
    )
    expect(plan[0]?.id).toBe('auto_engage_enemies')
  })

  it('prioritizes spending when credits are floating', () => {
    const plan = buildUltimateGoalPlan(
      makeSignals({
        credits: 9000,
        reserveCredits: 1500,
        idleProductionSlots: 3,
      }),
    )
    const spendIdx = plan.findIndex(p => p.id === 'spend_money_efficiently')
    const scoutIdx = plan.findIndex(p => p.id === 'scout_enemy_forces')
    expect(spendIdx).toBeLessThan(scoutIdx)
  })

  it('prioritizes mine exhaustion when untapped mines remain', () => {
    const plan = buildUltimateGoalPlan(
      makeSignals({
        mineExhaustionPressure: 1,
        hasUntappedMines: true,
      }),
    )
    const mineIdx = plan.findIndex(p => p.id === 'exhaust_map_mines')
    const scoutIdx = plan.findIndex(p => p.id === 'scout_enemy_forces')
    expect(mineIdx).toBeLessThan(scoutIdx)
  })

  it('pushes scouting ahead of destroy when contact is stale and unknown', () => {
    const plan = buildUltimateGoalPlan(
      makeSignals({
        knownEnemyForceCount: 0,
        scoutOverdue: true,
        currentlyAttacking: false,
      }),
    )
    const scoutIdx = plan.findIndex(p => p.id === 'scout_enemy_forces')
    const destroyIdx = plan.findIndex(p => p.id === 'destroy_enemies')
    expect(scoutIdx).toBeLessThan(destroyIdx)
  })
})
