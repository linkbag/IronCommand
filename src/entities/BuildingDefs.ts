// ============================================================
// IRON COMMAND — Building Definitions
// Tech tree: Construction Yard → Power → Barracks →
//            War Factory + Refinery → Radar → Tech Center → Superweapon
// ============================================================

import type { BuildingDef } from '../types'
import { DamageType } from '../types'

export const BUILDING_DEFS: Record<string, BuildingDef> = {

  // ── Core Infrastructure ──────────────────────────────────────

  construction_yard: {
    id: 'construction_yard',
    name: 'Construction Yard',
    category: 'base',
    factionExclusive: null,
    spriteKey: 'bld_construction_yard',
    footprint: { w: 3, h: 3 },
    providespower: 0,
    produces: [
      'power_plant', 'advanced_power', 'barracks', 'war_factory',
      'airfield', 'naval_yard', 'ore_refinery', 'radar_tower',
      'tech_center', 'turret', 'aa_gun', 'wall', 'superweapon',
    ],
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

  power_plant: {
    id: 'power_plant',
    name: 'Power Plant',
    category: 'power',
    factionExclusive: null,
    spriteKey: 'bld_power_plant',
    footprint: { w: 2, h: 2 },
    providespower: 100,
    produces: [],
    stats: {
      maxHp: 400,
      armor: 0.1,
      speed: 0,
      sightRange: 3,
      cost: 500,
      buildTime: 15,
      prerequisites: ['construction_yard'],
    },
    attack: null,
  },

  advanced_power: {
    id: 'advanced_power',
    name: 'Advanced Power Plant',
    category: 'power',
    factionExclusive: null,
    spriteKey: 'bld_advanced_power',
    footprint: { w: 3, h: 2 },
    providespower: 250,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.15,
      speed: 0,
      sightRange: 3,
      cost: 1500,
      buildTime: 30,
      prerequisites: ['construction_yard', 'radar_tower'],
    },
    attack: null,
  },

  // ── Production Buildings ─────────────────────────────────────

  barracks: {
    id: 'barracks',
    name: 'Barracks',
    category: 'production',
    factionExclusive: null,
    spriteKey: 'bld_barracks',
    footprint: { w: 3, h: 2 },
    providespower: -10,
    produces: [
      'rifle_soldier', 'rocket_soldier', 'engineer', 'attack_dog',
      // faction exclusives are added by Production.ts based on faction
    ],
    stats: {
      maxHp: 600,
      armor: 0.1,
      speed: 0,
      sightRange: 4,
      cost: 500,
      buildTime: 20,
      prerequisites: ['construction_yard', 'power_plant'],
    },
    attack: null,
  },

  war_factory: {
    id: 'war_factory',
    name: 'War Factory',
    category: 'production',
    factionExclusive: null,
    spriteKey: 'bld_war_factory',
    footprint: { w: 4, h: 3 },
    providespower: -25,
    produces: [
      'light_tank', 'heavy_tank', 'artillery', 'apc', 'harvester',
    ],
    stats: {
      maxHp: 800,
      armor: 0.15,
      speed: 0,
      sightRange: 4,
      cost: 2000,
      buildTime: 40,
      prerequisites: ['barracks'],
    },
    attack: null,
  },

  airfield: {
    id: 'airfield',
    name: 'Airfield',
    category: 'production',
    factionExclusive: null,
    spriteKey: 'bld_airfield',
    footprint: { w: 4, h: 2 },
    providespower: -20,
    produces: ['fighter_jet', 'bomber'],
    stats: {
      maxHp: 600,
      armor: 0.1,
      speed: 0,
      sightRange: 5,
      cost: 2000,
      buildTime: 35,
      prerequisites: ['war_factory'],
    },
    attack: null,
  },

  naval_yard: {
    id: 'naval_yard',
    name: 'Naval Yard',
    category: 'production',
    factionExclusive: null,
    spriteKey: 'bld_naval_yard',
    footprint: { w: 4, h: 3 },
    providespower: -15,
    produces: ['gunboat'],
    stats: {
      maxHp: 700,
      armor: 0.15,
      speed: 0,
      sightRange: 5,
      cost: 1500,
      buildTime: 30,
      prerequisites: ['war_factory'],
    },
    attack: null,
  },

  ore_refinery: {
    id: 'ore_refinery',
    name: 'Ore Refinery',
    category: 'production',
    factionExclusive: null,
    spriteKey: 'bld_ore_refinery',
    footprint: { w: 3, h: 2 },
    providespower: -15,
    produces: ['harvester'],
    stats: {
      maxHp: 700,
      armor: 0.15,
      speed: 0,
      sightRange: 4,
      cost: 2000,
      buildTime: 30,
      prerequisites: ['power_plant'],
    },
    attack: null,
  },

  // ── Tech Buildings ───────────────────────────────────────────

  radar_tower: {
    id: 'radar_tower',
    name: 'Radar Tower',
    category: 'tech',
    factionExclusive: null,
    spriteKey: 'bld_radar_tower',
    footprint: { w: 2, h: 2 },
    providespower: -20,
    produces: [],
    stats: {
      maxHp: 400,
      armor: 0.1,
      speed: 0,
      sightRange: 16,
      cost: 1000,
      buildTime: 25,
      prerequisites: ['war_factory', 'ore_refinery'],
    },
    attack: null,
  },

  tech_center: {
    id: 'tech_center',
    name: 'Tech Center',
    category: 'tech',
    factionExclusive: null,
    spriteKey: 'bld_tech_center',
    footprint: { w: 3, h: 3 },
    providespower: -30,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.15,
      speed: 0,
      sightRange: 6,
      cost: 2500,
      buildTime: 50,
      prerequisites: ['radar_tower'],
    },
    attack: null,
  },

  // ── Defense Structures ───────────────────────────────────────

  turret: {
    id: 'turret',
    name: 'Guard Turret',
    category: 'defense',
    factionExclusive: null,
    spriteKey: 'bld_turret',
    footprint: { w: 1, h: 1 },
    providespower: -5,
    produces: [],
    stats: {
      maxHp: 300,
      armor: 0.2,
      speed: 0,
      sightRange: 7,
      cost: 600,
      buildTime: 15,
      prerequisites: ['power_plant'],
    },
    attack: {
      damage: 30,
      range: 7,
      fireRate: 1.5,
      projectileSpeed: 500,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  aa_gun: {
    id: 'aa_gun',
    name: 'AA Gun',
    category: 'defense',
    factionExclusive: null,
    spriteKey: 'bld_aa_gun',
    footprint: { w: 1, h: 1 },
    providespower: -5,
    produces: [],
    stats: {
      maxHp: 250,
      armor: 0.15,
      speed: 0,
      sightRange: 8,
      cost: 700,
      buildTime: 15,
      prerequisites: ['power_plant'],
    },
    attack: {
      damage: 20,
      range: 8,
      fireRate: 3,
      projectileSpeed: 700,
      damageType: DamageType.BULLET,
      canAttackAir: true,
      canAttackGround: false,
      splash: 0,
    },
  },

  wall: {
    id: 'wall',
    name: 'Wall',
    category: 'defense',
    factionExclusive: null,
    spriteKey: 'bld_wall',
    footprint: { w: 1, h: 1 },
    providespower: 0,
    produces: [],
    stats: {
      maxHp: 200,
      armor: 0.3,
      speed: 0,
      sightRange: 2,
      cost: 100,
      buildTime: 5,
      prerequisites: ['construction_yard'],
    },
    attack: null,
  },

  // ── Faction Superweapons ─────────────────────────────────────

  superweapon: {
    id: 'superweapon',
    name: 'Superweapon',
    category: 'superweapon',
    factionExclusive: null,  // each faction has one; this is the template
    spriteKey: 'bld_superweapon',
    footprint: { w: 3, h: 3 },
    providespower: -50,
    produces: [],
    stats: {
      maxHp: 800,
      armor: 0.2,
      speed: 0,
      sightRange: 5,
      cost: 5000,
      buildTime: 120,
      prerequisites: ['tech_center'],
    },
    attack: null,
  },
}

// ── Helpers ──────────────────────────────────────────────────

/** Tech tree order for prerequisite validation */
export const TECH_TREE_ORDER = [
  'construction_yard',
  'power_plant',
  'barracks',
  'war_factory',
  'ore_refinery',
  'airfield',
  'naval_yard',
  'radar_tower',
  'tech_center',
  'advanced_power',
  'turret',
  'aa_gun',
  'wall',
  'superweapon',
]

/** Power cost map for quick lookup */
export const BUILDING_POWER_COST: Record<string, number> = Object.fromEntries(
  Object.entries(BUILDING_DEFS).map(([id, def]) => [id, -def.providespower])
)
