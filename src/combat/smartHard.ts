export type SmartHardCellularState = 'isolated_retreat' | 'stable_standard' | 'pressure_overspill'

export const SMART_HARD_TUNING = {
  cellularCheckIntervalMs: 2000,
  cellularRadiusTiles: 6,
  isolatedNcThreshold: 0.9,
  overspillNcThreshold: 1.85,
  overspillAllyThreshold: 4,
  isolatedHpThreshold: 0.45,
  overdriveEnemySuperweaponMs: 60000,
  overdriveBaseDamagePct: 0.3,
  overdriveMinDurationMs: 30000,
  overdriveFloodIntervalMs: 8000,
  ruleOfThreeMinGapTiles: 3,
  potentialField: {
    distancePenalty: 0.55,
    enemyMinerAttraction: 2.8,
    enemyPowerAttraction: 2.4,
    repairAttraction: 1.6,
    turretRepulsion: 4.8,
    teslaRepulsionMultiplier: 1.35,
    fogRepulsion: 1.2,
  },
} as const

export interface SmartHardCellularInput {
  allyCount: number
  enemyCount: number
  hpRatio: number
  overdrive: boolean
}

export function computeNeighborhoodCoefficient(allyCount: number, enemyCount: number): number {
  return (Math.max(0, allyCount) + 1) / (Math.max(0, enemyCount) + 1)
}

export function evaluateCellularState(input: SmartHardCellularInput): SmartHardCellularState {
  const nc = computeNeighborhoodCoefficient(input.allyCount, input.enemyCount)
  if (!input.overdrive && input.enemyCount > 0 && input.hpRatio <= SMART_HARD_TUNING.isolatedHpThreshold && nc < SMART_HARD_TUNING.isolatedNcThreshold) {
    return 'isolated_retreat'
  }
  if (nc >= SMART_HARD_TUNING.overspillNcThreshold && input.allyCount >= SMART_HARD_TUNING.overspillAllyThreshold) {
    return 'pressure_overspill'
  }
  return 'stable_standard'
}

export interface OverdriveEvaluationInput {
  enemySuperweaponEtaMs: number | null
  baseDamagePctLast60s: number
}

export function shouldActivateOverdrive(input: OverdriveEvaluationInput): boolean {
  const superweaponPressure = input.enemySuperweaponEtaMs !== null &&
    input.enemySuperweaponEtaMs <= SMART_HARD_TUNING.overdriveEnemySuperweaponMs
  const baseDamagePressure = input.baseDamagePctLast60s >= SMART_HARD_TUNING.overdriveBaseDamagePct
  return superweaponPressure || baseDamagePressure
}

export interface PotentialFieldCandidate {
  x: number
  y: number
  distanceToTargetTiles: number
  enemyMinerAttraction: number
  enemyPowerAttraction: number
  repairAttraction: number
  turretRepulsion: number
  fogRepulsion: number
  teslaNearby: boolean
}

export function scorePotentialFieldCandidate(
  candidate: PotentialFieldCandidate,
  suppressRepulsion: boolean,
): number {
  const weights = SMART_HARD_TUNING.potentialField
  const teslaWeight = candidate.teslaNearby ? weights.turretRepulsion * weights.teslaRepulsionMultiplier : weights.turretRepulsion
  const repulsion = suppressRepulsion
    ? 0
    : candidate.turretRepulsion * teslaWeight + candidate.fogRepulsion * weights.fogRepulsion

  return (
    -candidate.distanceToTargetTiles * weights.distancePenalty +
    candidate.enemyMinerAttraction * weights.enemyMinerAttraction +
    candidate.enemyPowerAttraction * weights.enemyPowerAttraction +
    candidate.repairAttraction * weights.repairAttraction -
    repulsion
  )
}

export function pickBestPotentialFieldCandidate(
  candidates: PotentialFieldCandidate[],
  suppressRepulsion: boolean,
): PotentialFieldCandidate | null {
  if (candidates.length === 0) return null
  let best = candidates[0]
  let bestScore = scorePotentialFieldCandidate(candidates[0], suppressRepulsion)
  for (let i = 1; i < candidates.length; i++) {
    const score = scorePotentialFieldCandidate(candidates[i], suppressRepulsion)
    if (score > bestScore) {
      bestScore = score
      best = candidates[i]
    }
  }
  return best
}

export interface OccupiedRect {
  col: number
  row: number
  w: number
  h: number
}

export function getRectGapTiles(a: OccupiedRect, b: OccupiedRect): number {
  const ax2 = a.col + a.w - 1
  const ay2 = a.row + a.h - 1
  const bx2 = b.col + b.w - 1
  const by2 = b.row + b.h - 1
  const gapX = Math.max(0, Math.max(b.col - ax2 - 1, a.col - bx2 - 1))
  const gapY = Math.max(0, Math.max(b.row - ay2 - 1, a.row - by2 - 1))
  return Math.max(gapX, gapY)
}

export function followsRuleOfThreeSpacing(candidate: OccupiedRect, occupied: OccupiedRect[]): boolean {
  const minGap = SMART_HARD_TUNING.ruleOfThreeMinGapTiles
  for (const other of occupied) {
    if (getRectGapTiles(candidate, other) < minGap) {
      return false
    }
  }
  return true
}
