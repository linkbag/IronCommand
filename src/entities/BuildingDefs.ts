// ============================================================
// IRON COMMAND — Building Definitions (RA2-Style Asymmetric)
// Iron Alliance vs Red Collective — different buildings per side
// ============================================================

import type { BuildingDef, FactionSide } from '../types'
import { DamageType } from '../types'
import { FACTIONS } from '../data/factions'
import type { FactionId } from '../types'

export const BUILDING_DEFS: Record<string, BuildingDef> = {

  // ════════════════════════════════════════════════════════════
  // SHARED BUILDINGS (both sides)
  // ════════════════════════════════════════════════════════════

  construction_yard: {
    id: 'construction_yard',
    name: 'Construction Yard',
    category: 'base',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_construction_yard',
    footprint: { w: 3, h: 3 },
    providespower: 0,
    produces: [], // populated dynamically by getAvailableBuildingIds()
    stats: {
      maxHp: 1000,
      armor: 0.2,
      speed: 0,
      sightRange: 5,
      cost: 0,
      buildTime: 0,
      prerequisites: [],
    },
    attack: null,
  },

  barracks: {
    id: 'barracks',
    name: 'Barracks',
    category: 'production',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_barracks',
    footprint: { w: 3, h: 2 },
    providespower: -30,
    produces: [], // populated dynamically
    stats: {
      maxHp: 600,
      armor: 0.1,
      speed: 0,
      sightRange: 4,
      cost: 500,
      buildTime: 8,
      prerequisites: ['construction_yard', 'power_plant', 'tesla_reactor'],
    },
    attack: null,
  },

  war_factory: {
    id: 'war_factory',
    name: 'War Factory',
    category: 'production',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_war_factory',
    footprint: { w: 4, h: 3 },
    providespower: -50,
    produces: [], // populated dynamically
    stats: {
      maxHp: 1000,
      armor: 0.2,
      speed: 0,
      sightRange: 4,
      cost: 2000,
      buildTime: 15,
      prerequisites: ['barracks'],
    },
    attack: null,
  },

  ore_refinery: {
    id: 'ore_refinery',
    name: 'Ore Refinery',
    category: 'production',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_ore_refinery',
    footprint: { w: 3, h: 2 },
    providespower: -30,
    produces: [], // populated dynamically (Chrono Miner or War Miner)
    stats: {
      maxHp: 800,
      armor: 0.15,
      speed: 0,
      sightRange: 4,
      cost: 2000,
      buildTime: 12,
      prerequisites: ['construction_yard', 'power_plant', 'tesla_reactor'],
    },
    attack: null,
  },

  naval_shipyard: {
    id: 'naval_shipyard',
    name: 'Naval Shipyard',
    category: 'production',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_naval_yard',
    footprint: { w: 4, h: 3 },
    providespower: -30,
    produces: [], // populated dynamically
    stats: {
      maxHp: 800,
      armor: 0.15,
      speed: 0,
      sightRange: 5,
      cost: 1000,
      buildTime: 15,
      prerequisites: ['war_factory'],
    },
    attack: null,
  },

  service_depot: {
    id: 'service_depot',
    name: 'Service Depot',
    category: 'tech',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_service_depot',
    footprint: { w: 3, h: 3 },
    providespower: -20,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.1,
      speed: 0,
      sightRange: 3,
      cost: 800,
      buildTime: 10,
      prerequisites: ['war_factory'],
    },
    attack: null,
  },

  battle_lab: {
    id: 'battle_lab',
    name: 'Battle Lab',
    category: 'tech',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_tech_center',
    footprint: { w: 3, h: 3 },
    providespower: -100,
    produces: [],
    stats: {
      maxHp: 500,
      armor: 0.15,
      speed: 0,
      sightRange: 6,
      cost: 2000,
      buildTime: 20,
      prerequisites: ['radar_tower', 'air_force_command'], // OR: collective needs radar, alliance needs AFC
    },
    attack: null,
  },

  fortress_wall: {
    id: 'fortress_wall',
    name: 'Fortress Wall',
    category: 'defense',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_wall',
    footprint: { w: 1, h: 1 },
    providespower: 0,
    produces: [],
    stats: {
      maxHp: 300,
      armor: 0.4,
      speed: 0,
      sightRange: 1,
      cost: 100,
      buildTime: 3,
      prerequisites: ['construction_yard'],
    },
    attack: null,
  },

  // ════════════════════════════════════════════════════════════
  // IRON ALLIANCE BUILDINGS
  // ════════════════════════════════════════════════════════════

  power_plant: {
    id: 'power_plant',
    name: 'Power Plant',
    category: 'power',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_power_plant',
    footprint: { w: 2, h: 2 },
    providespower: 200,
    produces: [],
    stats: {
      maxHp: 500,
      armor: 0.1,
      speed: 0,
      sightRange: 3,
      cost: 800,
      buildTime: 8,
      prerequisites: ['construction_yard'],
    },
    attack: null,
  },

  air_force_command: {
    id: 'air_force_command',
    name: 'Air Force Command',
    category: 'production',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_airfield',
    footprint: { w: 4, h: 2 },
    providespower: -50,
    produces: [], // populated dynamically
    stats: {
      maxHp: 600,
      armor: 0.1,
      speed: 0,
      sightRange: 10,
      cost: 1000,
      buildTime: 12,
      prerequisites: ['war_factory'],
    },
    attack: null,
  },

  ore_purifier: {
    id: 'ore_purifier',
    name: 'Ore Purifier',
    category: 'tech',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_ore_purifier',
    footprint: { w: 3, h: 2 },
    providespower: -40,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.15,
      speed: 0,
      sightRange: 3,
      cost: 2500,
      buildTime: 20,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── Alliance Defenses ──────────────────────────────────────

  pillbox: {
    id: 'pillbox',
    name: 'Pillbox',
    category: 'defense',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_turret',
    footprint: { w: 1, h: 1 },
    providespower: -10,
    produces: [],
    stats: {
      maxHp: 400,
      armor: 0.3,
      speed: 0,
      sightRange: 6,
      cost: 500,
      buildTime: 6,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 30,
      range: 6,
      fireRate: 2,
      projectileSpeed: 500,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  prism_tower: {
    id: 'prism_tower',
    name: 'Prism Tower',
    category: 'defense',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_prism_tower',
    footprint: { w: 1, h: 1 },
    providespower: -30,
    produces: [],
    stats: {
      maxHp: 300,
      armor: 0.15,
      speed: 0,
      sightRange: 8,
      cost: 1500,
      buildTime: 25,
      prerequisites: ['power_plant', 'air_force_command'],
    },
    attack: {
      damage: 100,
      range: 8,
      fireRate: 0.5,
      projectileSpeed: 0, // hitscan beam
      damageType: DamageType.ELECTRIC,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  patriot_missile: {
    id: 'patriot_missile',
    name: 'Patriot Missile',
    category: 'defense',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_aa_gun',
    footprint: { w: 1, h: 1 },
    providespower: -20,
    produces: [],
    stats: {
      maxHp: 300,
      armor: 0.15,
      speed: 0,
      sightRange: 10,
      cost: 1000,
      buildTime: 18,
      prerequisites: ['air_force_command'],
    },
    attack: {
      damage: 50,
      range: 10,
      fireRate: 1.5,
      projectileSpeed: 800,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: false,
      splash: 0,
    },
  },

  gap_generator: {
    id: 'gap_generator',
    name: 'Gap Generator',
    category: 'defense',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_gap_generator',
    footprint: { w: 2, h: 2 },
    providespower: -100,
    produces: [],
    stats: {
      maxHp: 400,
      armor: 0.15,
      speed: 0,
      sightRange: 5,
      cost: 1000,
      buildTime: 25,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── Alliance Superweapons ──────────────────────────────────

  weather_device: {
    id: 'weather_device',
    name: 'Weather Control Device',
    category: 'superweapon',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_superweapon',
    footprint: { w: 3, h: 3 },
    providespower: -100,
    produces: [],
    stats: {
      maxHp: 800,
      armor: 0.2,
      speed: 0,
      sightRange: 5,
      cost: 5000,
      buildTime: 60,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  chronosphere: {
    id: 'chronosphere',
    name: 'Chronosphere',
    category: 'superweapon',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_chronosphere',
    footprint: { w: 3, h: 3 },
    providespower: -100,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.2,
      speed: 0,
      sightRange: 5,
      cost: 2500,
      buildTime: 25,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── France Country Special Building ────────────────────────

  grand_cannon: {
    id: 'grand_cannon',
    name: 'Grand Cannon',
    category: 'defense',
    side: 'alliance',
    factionExclusive: 'france',
    spriteKey: 'bld_grand_cannon',
    footprint: { w: 2, h: 2 },
    providespower: -50,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.3,
      speed: 0,
      sightRange: 12,
      cost: 2000,
      buildTime: 18,
      prerequisites: ['air_force_command'],
    },
    attack: {
      damage: 200,
      range: 12,
      fireRate: 0.3,
      projectileSpeed: 800,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 2,
    },
  },

  // ════════════════════════════════════════════════════════════
  // RED COLLECTIVE BUILDINGS
  // ════════════════════════════════════════════════════════════

  tesla_reactor: {
    id: 'tesla_reactor',
    name: 'Tesla Reactor',
    category: 'power',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_tesla_reactor',
    footprint: { w: 2, h: 2 },
    providespower: 150,
    produces: [],
    stats: {
      maxHp: 400,
      armor: 0.1,
      speed: 0,
      sightRange: 3,
      cost: 600,
      buildTime: 6,
      prerequisites: ['construction_yard'],
    },
    attack: null,
  },

  radar_tower: {
    id: 'radar_tower',
    name: 'Radar Tower',
    category: 'tech',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_radar_tower',
    footprint: { w: 2, h: 2 },
    providespower: -50,
    produces: [],
    stats: {
      maxHp: 500,
      armor: 0.1,
      speed: 0,
      sightRange: 16,
      cost: 1000,
      buildTime: 12,
      prerequisites: ['war_factory', 'ore_refinery'],
    },
    attack: null,
  },

  nuclear_reactor: {
    id: 'nuclear_reactor',
    name: 'Nuclear Reactor',
    category: 'power',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_nuclear_reactor',
    footprint: { w: 3, h: 3 },
    providespower: 500,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.15,
      speed: 0,
      sightRange: 4,
      cost: 1500,
      buildTime: 15,
      prerequisites: ['radar_tower'],
    },
    attack: null,
  },

  cloning_vats: {
    id: 'cloning_vats',
    name: 'Cloning Vats',
    category: 'tech',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_cloning_vats',
    footprint: { w: 4, h: 3 },
    providespower: -100,
    produces: [],
    stats: {
      maxHp: 800,
      armor: 0.2,
      speed: 0,
      sightRange: 3,
      cost: 2500,
      buildTime: 20,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── Collective Defenses ────────────────────────────────────

  sentry_gun: {
    id: 'sentry_gun',
    name: 'Sentry Gun',
    category: 'defense',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_turret',
    footprint: { w: 1, h: 1 },
    providespower: -10,
    produces: [],
    stats: {
      maxHp: 350,
      armor: 0.25,
      speed: 0,
      sightRange: 6,
      cost: 500,
      buildTime: 6,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 25,
      range: 6,
      fireRate: 2.5,
      projectileSpeed: 500,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  tesla_coil: {
    id: 'tesla_coil',
    name: 'Tesla Coil',
    category: 'defense',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_tesla_coil',
    footprint: { w: 1, h: 1 },
    providespower: -40,
    produces: [],
    stats: {
      maxHp: 350,
      armor: 0.2,
      speed: 0,
      sightRange: 8,
      cost: 1500,
      buildTime: 25,
      prerequisites: ['radar_tower'],
    },
    attack: {
      damage: 120,
      range: 7,
      fireRate: 0.5,
      projectileSpeed: 0, // hitscan electric
      damageType: DamageType.ELECTRIC,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  flak_cannon: {
    id: 'flak_cannon',
    name: 'Flak Cannon',
    category: 'defense',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_aa_gun',
    footprint: { w: 1, h: 1 },
    providespower: -20,
    produces: [],
    stats: {
      maxHp: 300,
      armor: 0.15,
      speed: 0,
      sightRange: 9,
      cost: 1000,
      buildTime: 18,
      prerequisites: ['radar_tower'],
    },
    attack: {
      damage: 35,
      range: 9,
      fireRate: 2,
      projectileSpeed: 700,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 1,
    },
  },

  psychic_sensor: {
    id: 'psychic_sensor',
    name: 'Psychic Sensor',
    category: 'defense',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_psychic_sensor',
    footprint: { w: 2, h: 2 },
    providespower: -50,
    produces: [],
    stats: {
      maxHp: 400,
      armor: 0.15,
      speed: 0,
      sightRange: 20,
      cost: 1000,
      buildTime: 25,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── Collective Superweapons ────────────────────────────────

  nuclear_silo: {
    id: 'nuclear_silo',
    name: 'Nuclear Missile Silo',
    category: 'superweapon',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_superweapon',
    footprint: { w: 3, h: 3 },
    providespower: -100,
    produces: [],
    stats: {
      maxHp: 800,
      armor: 0.2,
      speed: 0,
      sightRange: 5,
      cost: 5000,
      buildTime: 60,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  iron_curtain: {
    id: 'iron_curtain',
    name: 'Iron Curtain',
    category: 'superweapon',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_iron_curtain',
    footprint: { w: 3, h: 3 },
    providespower: -100,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.2,
      speed: 0,
      sightRange: 5,
      cost: 2500,
      buildTime: 25,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },
}

// ── Helpers ──────────────────────────────────────────────────

/** Tech tree order for prerequisite validation */
export const TECH_TREE_ORDER = [
  // Shared
  'construction_yard', 'barracks', 'war_factory', 'ore_refinery',
  'naval_shipyard', 'service_depot', 'battle_lab', 'fortress_wall',
  // Alliance
  'power_plant', 'air_force_command', 'ore_purifier',
  'pillbox', 'prism_tower', 'patriot_missile', 'gap_generator',
  'weather_device', 'chronosphere', 'grand_cannon',
  // Collective
  'tesla_reactor', 'radar_tower', 'nuclear_reactor', 'cloning_vats',
  'sentry_gun', 'tesla_coil', 'flak_cannon', 'psychic_sensor',
  'nuclear_silo', 'iron_curtain',
]

/** Power cost map for quick lookup */
export const BUILDING_POWER_COST: Record<string, number> = Object.fromEntries(
  Object.entries(BUILDING_DEFS).map(([id, def]) => [id, -def.providespower])
)

/** Get the power building def ID for a given side */
export function getPowerBuildingDefId(side: FactionSide): string {
  return side === 'alliance' ? 'power_plant' : 'tesla_reactor'
}

/** Get all building IDs available to a specific faction */
export function getAvailableBuildingIds(factionId: string): string[] {
  const side = FACTIONS[factionId as FactionId]?.side ?? 'alliance'
  return Object.keys(BUILDING_DEFS).filter(id => {
    const def = BUILDING_DEFS[id]
    const sideMatch = def.side === side || def.side === null
    const exclusiveMatch = def.factionExclusive === null || def.factionExclusive === factionId
    return sideMatch && exclusiveMatch
  })
}

/** Get all building IDs available to a given side */
export function getAvailableBuildingIdsBySide(side: FactionSide, factionId?: string): string[] {
  return Object.keys(BUILDING_DEFS).filter(id => {
    const def = BUILDING_DEFS[id]
    const sideMatch = def.side === side || def.side === null
    const exclusiveMatch = def.factionExclusive === null ||
      (factionId && def.factionExclusive === factionId)
    return sideMatch && exclusiveMatch
  })
}
