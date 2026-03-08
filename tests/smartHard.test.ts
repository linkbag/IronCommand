import { describe, expect, it } from 'vitest'
import {
  SMART_HARD_TUNING,
  computeNeighborhoodCoefficient,
  evaluateCellularState,
  followsRuleOfThreeSpacing,
  pickBestPotentialFieldCandidate,
  scorePotentialFieldCandidate,
  shouldActivateOverdrive,
  type PotentialFieldCandidate,
} from '../src/combat/smartHard'

describe('smartHard helpers', () => {
  it('computes neighborhood coefficient deterministically', () => {
    expect(computeNeighborhoodCoefficient(0, 0)).toBe(1)
    expect(computeNeighborhoodCoefficient(3, 1)).toBe(2)
    expect(computeNeighborhoodCoefficient(1, 5)).toBeCloseTo(0.333333, 5)
  })

  it('classifies isolated retreat correctly', () => {
    expect(evaluateCellularState({
      allyCount: 0,
      enemyCount: 3,
      hpRatio: 0.3,
      overdrive: false,
    })).toBe('isolated_retreat')
  })

  it('classifies pressure overspill correctly', () => {
    expect(evaluateCellularState({
      allyCount: SMART_HARD_TUNING.overspillAllyThreshold + 1,
      enemyCount: 1,
      hpRatio: 0.95,
      overdrive: false,
    })).toBe('pressure_overspill')
  })

  it('overdrive trigger follows superweapon and base-damage thresholds', () => {
    expect(shouldActivateOverdrive({
      enemySuperweaponEtaMs: SMART_HARD_TUNING.overdriveEnemySuperweaponMs - 1,
      baseDamagePctLast60s: 0.01,
    })).toBe(true)
    expect(shouldActivateOverdrive({
      enemySuperweaponEtaMs: null,
      baseDamagePctLast60s: SMART_HARD_TUNING.overdriveBaseDamagePct + 0.01,
    })).toBe(true)
    expect(shouldActivateOverdrive({
      enemySuperweaponEtaMs: SMART_HARD_TUNING.overdriveEnemySuperweaponMs + 1,
      baseDamagePctLast60s: SMART_HARD_TUNING.overdriveBaseDamagePct - 0.01,
    })).toBe(false)
  })

  it('suppresses repulsion score in overdrive', () => {
    const candidate: PotentialFieldCandidate = {
      x: 0,
      y: 0,
      distanceToTargetTiles: 5,
      enemyMinerAttraction: 0.4,
      enemyPowerAttraction: 0.5,
      repairAttraction: 0.2,
      turretRepulsion: 2.2,
      fogRepulsion: 1,
      teslaNearby: true,
    }
    const normal = scorePotentialFieldCandidate(candidate, false)
    const overdrive = scorePotentialFieldCandidate(candidate, true)
    expect(overdrive).toBeGreaterThan(normal)
  })

  it('picks best potential candidate by deterministic score', () => {
    const choices: PotentialFieldCandidate[] = [
      {
        x: 1, y: 1, distanceToTargetTiles: 7,
        enemyMinerAttraction: 0.1, enemyPowerAttraction: 0.1, repairAttraction: 0,
        turretRepulsion: 0.6, fogRepulsion: 0.6, teslaNearby: false,
      },
      {
        x: 2, y: 2, distanceToTargetTiles: 5,
        enemyMinerAttraction: 0.6, enemyPowerAttraction: 0.6, repairAttraction: 0.1,
        turretRepulsion: 0.3, fogRepulsion: 0.1, teslaNearby: false,
      },
      {
        x: 3, y: 3, distanceToTargetTiles: 4.5,
        enemyMinerAttraction: 0.3, enemyPowerAttraction: 0.2, repairAttraction: 0,
        turretRepulsion: 0.7, fogRepulsion: 0.2, teslaNearby: false,
      },
    ]
    const best = pickBestPotentialFieldCandidate(choices, false)
    expect(best?.x).toBe(2)
    expect(best?.y).toBe(2)
  })

  it('enforces rule-of-3 spacing against existing base organs', () => {
    expect(followsRuleOfThreeSpacing(
      { col: 10, row: 10, w: 2, h: 2 },
      [{ col: 5, row: 10, w: 2, h: 2 }],
    )).toBe(true)
    expect(followsRuleOfThreeSpacing(
      { col: 8, row: 10, w: 2, h: 2 },
      [{ col: 5, row: 10, w: 2, h: 2 }],
    )).toBe(false)
  })
})
