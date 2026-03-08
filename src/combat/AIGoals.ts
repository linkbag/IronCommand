export type AIUltimateGoalId =
  | 'spend_money_efficiently'
  | 'exhaust_map_mines'
  | 'maximize_unit_production'
  | 'destroy_enemies'
  | 'scout_enemy_forces'
  | 'auto_engage_enemies'

export type AIUltimateGoalSignals = {
  credits: number
  reserveCredits: number
  mineExhaustionPressure: number
  hasUntappedMines: boolean
  armyCount: number
  armyCap: number
  hasAnyProduction: boolean
  idleProductionSlots: number
  knownEnemyForceCount: number
  nearbyEnemyForceCount: number
  idleCombatUnits: number
  scoutOverdue: boolean
  currentlyAttacking: boolean
}

export type AIUltimateGoalDirective = {
  id: AIUltimateGoalId
  priority: number
  rationale: string
}

const GOAL_ORDER: AIUltimateGoalId[] = [
  'auto_engage_enemies',
  'destroy_enemies',
  'spend_money_efficiently',
  'maximize_unit_production',
  'exhaust_map_mines',
  'scout_enemy_forces',
]

const BASE_PRIORITY: Record<AIUltimateGoalId, number> = {
  auto_engage_enemies: 100,
  destroy_enemies: 84,
  spend_money_efficiently: 78,
  maximize_unit_production: 70,
  exhaust_map_mines: 66,
  scout_enemy_forces: 50,
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

export function buildUltimateGoalPlan(signals: AIUltimateGoalSignals): AIUltimateGoalDirective[] {
  const reserve = Math.max(1, signals.reserveCredits)
  const spendPressure = clamp01((signals.credits - reserve) / (reserve * 2))
  const armyHeadroom = clamp01((signals.armyCap - signals.armyCount) / Math.max(1, signals.armyCap))
  const enemyPresence = Math.min(1, signals.knownEnemyForceCount / 24)
  const nearbyEnemyPressure = Math.min(1, signals.nearbyEnemyForceCount / 8)
  const idleProductionPressure = Math.min(1, signals.idleProductionSlots / 3)

  const scored: AIUltimateGoalDirective[] = [
    {
      id: 'auto_engage_enemies',
      priority:
        BASE_PRIORITY.auto_engage_enemies +
        nearbyEnemyPressure * 52 +
        (signals.idleCombatUnits > 0 ? 8 : 0),
      rationale: nearbyEnemyPressure > 0
        ? 'Nearby enemy forces detected near combat units.'
        : 'Keep combat units ready to engage visible threats.',
    },
    {
      id: 'destroy_enemies',
      priority:
        BASE_PRIORITY.destroy_enemies +
        enemyPresence * 30 +
        (signals.currentlyAttacking ? 9 : 0),
      rationale: enemyPresence > 0
        ? 'Known enemy forces and structures should be pressured continuously.'
        : 'No strong contact, keep offensive posture.',
    },
    {
      id: 'spend_money_efficiently',
      priority:
        BASE_PRIORITY.spend_money_efficiently +
        spendPressure * 45 +
        (signals.hasAnyProduction ? 6 : 0),
      rationale: spendPressure > 0
        ? 'Credits are floating above reserve; convert into assets.'
        : 'Maintain low idle credits and spend opportunistically.',
    },
    {
      id: 'maximize_unit_production',
      priority:
        BASE_PRIORITY.maximize_unit_production +
        armyHeadroom * 32 +
        idleProductionPressure * 22 +
        spendPressure * 10,
      rationale: armyHeadroom > 0.2
        ? 'Army is below cap; keep production lines busy.'
        : 'Army is near cap; top off production where possible.',
    },
    {
      id: 'exhaust_map_mines',
      priority:
        BASE_PRIORITY.exhaust_map_mines +
        clamp01(signals.mineExhaustionPressure) * 38 +
        (signals.hasUntappedMines ? 12 : 0),
      rationale: signals.hasUntappedMines
        ? 'Untapped ore fields remain; expand harvesting coverage.'
        : 'Preserve harvest flow and mine out local fields.',
    },
    {
      id: 'scout_enemy_forces',
      priority:
        BASE_PRIORITY.scout_enemy_forces +
        (signals.scoutOverdue ? 32 : 0) +
        (signals.knownEnemyForceCount === 0 ? 14 : 0) +
        Math.min(8, signals.idleCombatUnits * 2),
      rationale: signals.scoutOverdue
        ? 'Scouting cadence expired; refresh enemy intel.'
        : 'Continue map search to maintain enemy visibility.',
    },
  ]

  return scored
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return GOAL_ORDER.indexOf(a.id) - GOAL_ORDER.indexOf(b.id)
    })
}
