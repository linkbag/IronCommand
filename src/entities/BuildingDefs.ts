// ============================================================
// IRON COMMAND — Building Definitions (RA2-Style Asymmetric)
// Iron Alliance vs Red Collective — different buildings per side
// Build time formula: Math.ceil(cost / 100), min 3, max 45 seconds
// ============================================================

import type { BuildingDef, FactionSide } from '../types'
import { DamageType, ArmorType } from '../types'
import { FACTIONS } from '../data/factions'
import type { FactionId } from '../types'
import { UNIT_DEFS } from './UnitDefs'

export const BUILDING_DEFS: Record<string, BuildingDef> = {

  // ════════════════════════════════════════════════════════════
  // SHARED BUILDINGS (both sides)
  // ════════════════════════════════════════════════════════════

  construction_yard: {
    id: 'construction_yard',
    name: 'Construction Yard',
    category: 'base',
    armorType: ArmorType.STEEL,
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
    armorType: ArmorType.STEEL,
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_barracks',
    footprint: { w: 3, h: 2 },
    providespower: -10,
    produces: [], // populated dynamically
    stats: {
      maxHp: 500,
      armor: 0.1,
      speed: 0,
      sightRange: 4,
      cost: 500,
      buildTime: 5,
      prerequisites: ['construction_yard', 'power_plant', 'tesla_reactor'],
    },
    attack: null,
  },

  war_factory: {
    id: 'war_factory',
    name: 'War Factory',
    category: 'production',
    armorType: ArmorType.WOOD,
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_war_factory',
    footprint: { w: 4, h: 3 },
    providespower: -30,
    produces: [], // populated dynamically
    stats: {
      maxHp: 1000,
      armor: 0.2,
      speed: 0,
      sightRange: 4,
      cost: 2000,
      buildTime: 20,
      prerequisites: ['barracks', 'ore_refinery'],
    },
    attack: null,
  },

  ore_refinery: {
    id: 'ore_refinery',
    name: 'Ore Refinery',
    category: 'production',
    armorType: ArmorType.WOOD,
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_ore_refinery',
    footprint: { w: 3, h: 2 },
    providespower: -20,
    produces: [], // populated dynamically (Chrono Miner or War Miner)
    stats: {
      maxHp: 1000,
      armor: 0.15,
      speed: 0,
      sightRange: 4,
      cost: 2000,
      buildTime: 20,
      prerequisites: ['construction_yard', 'barracks', 'power_plant', 'tesla_reactor'],
    },
    attack: null,
  },

  naval_shipyard: {
    id: 'naval_shipyard',
    name: 'Naval Shipyard',
    category: 'production',
    armorType: ArmorType.WOOD,
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_naval_yard',
    footprint: { w: 4, h: 3 },
    providespower: -20,
    produces: [], // populated dynamically
    stats: {
      maxHp: 800,
      armor: 0.15,
      speed: 0,
      sightRange: 5,
      cost: 1000,
      buildTime: 10,
      prerequisites: ['ore_refinery'],
    },
    attack: null,
  },

  service_depot: {
    id: 'service_depot',
    name: 'Service Depot',
    category: 'tech',
    armorType: ArmorType.WOOD,
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_service_depot',
    footprint: { w: 3, h: 3 },
    providespower: -10,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.1,
      speed: 0,
      sightRange: 3,
      cost: 800,
      buildTime: 8,
      prerequisites: ['war_factory', 'ore_refinery'],
    },
    attack: null,
  },

  battle_lab: {
    id: 'battle_lab',
    name: 'Battle Lab',
    category: 'tech',
    armorType: ArmorType.WOOD,
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_tech_center',
    footprint: { w: 3, h: 3 },
    providespower: -40,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.15,
      speed: 0,
      sightRange: 6,
      cost: 2000,
      buildTime: 20,
      prerequisites: ['war_factory', 'radar_tower', 'air_force_command'], // OR branch handled by side filtering
    },
    attack: null,
  },

  fortress_wall: {
    id: 'fortress_wall',
    name: 'Fortress Wall',
    category: 'defense',
    armorType: ArmorType.CONCRETE,
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_wall',
    footprint: { w: 1, h: 1 },
    providespower: 0,
    produces: [],
    stats: {
      maxHp: 300,
      armor: 0.8,
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
    armorType: ArmorType.WOOD,
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_power_plant',
    footprint: { w: 2, h: 2 },
    providespower: 100,
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
    armorType: ArmorType.WOOD,
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
      buildTime: 10,
      prerequisites: ['war_factory', 'ore_refinery'],
    },
    attack: null,
  },

  ore_purifier: {
    id: 'ore_purifier',
    name: 'Ore Purifier',
    category: 'tech',
    armorType: ArmorType.WOOD,
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
      buildTime: 25,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  spy_satellite: {
    id: 'spy_satellite',
    name: 'Spy Satellite Uplink',
    category: 'tech',
    armorType: ArmorType.WOOD,
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'bld_spy_satellite',
    footprint: { w: 2, h: 2 },
    providespower: -75,
    produces: [],
    stats: {
      maxHp: 400,
      armor: 0.1,
      speed: 0,
      sightRange: 5,
      cost: 1500,
      buildTime: 15,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── Alliance Defenses ──────────────────────────────────────

  pillbox: {
    id: 'pillbox',
    name: 'Pillbox',
    category: 'defense',
    armorType: ArmorType.STEEL,
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
      buildTime: 5,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 20,
      range: 5.5,
      fireRate: 1.2,
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
    armorType: ArmorType.STEEL,
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
      sightRange: 8.5,
      cost: 1500,
      buildTime: 15,
      prerequisites: ['battle_lab'],
    },
    attack: {
      damage: 150,
      range: 8.5,
      fireRate: 0.25,
      projectileSpeed: 0, // hitscan beam
      damageType: DamageType.ELECTRIC,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.6,
    },
  },

  patriot_missile: {
    id: 'patriot_missile',
    name: 'Patriot Missile',
    category: 'defense',
    armorType: ArmorType.STEEL,
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
      buildTime: 10,
      prerequisites: ['air_force_command'],
    },
    attack: {
      damage: 60,
      range: 10,
      fireRate: 0.8,
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
    armorType: ArmorType.STEEL,
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
      buildTime: 10,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── Alliance Superweapons ──────────────────────────────────

  weather_device: {
    id: 'weather_device',
    name: 'Weather Control Device',
    category: 'superweapon',
    armorType: ArmorType.CONCRETE,
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
      buildTime: 45,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  chronosphere: {
    id: 'chronosphere',
    name: 'Chronosphere',
    category: 'superweapon',
    armorType: ArmorType.CONCRETE,
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
    armorType: ArmorType.STEEL,
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
      buildTime: 20,
      prerequisites: ['battle_lab'],
    },
    attack: {
      damage: 200,
      range: 12,
      fireRate: 0.2,
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
    armorType: ArmorType.STEEL,
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
      buildTime: 8,
      prerequisites: ['construction_yard'],
    },
    attack: null,
  },

  radar_tower: {
    id: 'radar_tower',
    name: 'Radar Tower',
    category: 'tech',
    armorType: ArmorType.WOOD,
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
      buildTime: 10,
      prerequisites: ['barracks', 'ore_refinery'],
    },
    attack: null,
  },

  nuclear_reactor: {
    id: 'nuclear_reactor',
    name: 'Nuclear Reactor',
    category: 'power',
    armorType: ArmorType.STEEL,
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'bld_nuclear_reactor',
    footprint: { w: 3, h: 3 },
    providespower: 200,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.15,
      speed: 0,
      sightRange: 4,
      cost: 1000,
      buildTime: 10,
      prerequisites: ['radar_tower'],
    },
    attack: null,
  },

  cloning_vats: {
    id: 'cloning_vats',
    name: 'Cloning Vats',
    category: 'tech',
    armorType: ArmorType.WOOD,
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
      buildTime: 25,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── Collective Defenses ────────────────────────────────────

  sentry_gun: {
    id: 'sentry_gun',
    name: 'Sentry Gun',
    category: 'defense',
    armorType: ArmorType.STEEL,
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
      buildTime: 5,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 20,
      range: 5.5,
      fireRate: 1.4,
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
    armorType: ArmorType.STEEL,
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
      buildTime: 15,
      prerequisites: ['radar_tower', 'nuclear_reactor'],
    },
    attack: {
      damage: 160,
      range: 7.5,
      fireRate: 0.25,
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
    armorType: ArmorType.STEEL,
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
      buildTime: 10,
      prerequisites: ['radar_tower'],
    },
    attack: {
      damage: 30,
      range: 9,
      fireRate: 0.9,
      projectileSpeed: 700,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: false,
      splash: 0.2,
    },
  },

  psychic_sensor: {
    id: 'psychic_sensor',
    name: 'Psychic Sensor',
    category: 'defense',
    armorType: ArmorType.STEEL,
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
      buildTime: 10,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  // ── Collective Superweapons ────────────────────────────────

  nuclear_silo: {
    id: 'nuclear_silo',
    name: 'Nuclear Missile Silo',
    category: 'superweapon',
    armorType: ArmorType.CONCRETE,
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
      buildTime: 45,
      prerequisites: ['battle_lab'],
    },
    attack: null,
  },

  iron_curtain: {
    id: 'iron_curtain',
    name: 'Iron Curtain',
    category: 'superweapon',
    armorType: ArmorType.CONCRETE,
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

  // ════════════════════════════════════════════════════════════
  // NEUTRAL / CAPTURABLE BUILDINGS
  // These spawn on the map as neutral (playerId = -1).
  // Any player's Engineer can capture them by walking into them.
  // ════════════════════════════════════════════════════════════

  oil_derrick: {
    id: 'oil_derrick',
    name: 'Oil Derrick',
    category: 'tech',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_oil_derrick',
    footprint: { w: 2, h: 2 },
    providespower: 0,
    produces: [],
    stats: {
      maxHp: 500,
      armor: 0.1,
      speed: 0,
      sightRange: 4,
      cost: 0,
      buildTime: 0,
      prerequisites: [],
    },
    attack: null,
  },

  tech_center: {
    id: 'tech_center',
    name: 'Tech Center',
    category: 'tech',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_tech_center',
    footprint: { w: 2, h: 2 },
    providespower: 0,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.15,
      speed: 0,
      sightRange: 5,
      cost: 0,
      buildTime: 0,
      prerequisites: [],
    },
    attack: null,
  },

  neutral_hospital: {
    id: 'neutral_hospital',
    name: 'Hospital',
    category: 'tech',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_hospital',
    footprint: { w: 2, h: 2 },
    providespower: 0,
    produces: [],
    stats: {
      maxHp: 500,
      armor: 0.1,
      speed: 0,
      sightRange: 4,
      cost: 0,
      buildTime: 0,
      prerequisites: [],
    },
    attack: null,
  },

  neutral_repair_depot: {
    id: 'neutral_repair_depot',
    name: 'Repair Depot',
    category: 'tech',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_repair_depot',
    footprint: { w: 3, h: 3 },
    providespower: 0,
    produces: [],
    stats: {
      maxHp: 600,
      armor: 0.15,
      speed: 0,
      sightRange: 4,
      cost: 0,
      buildTime: 0,
      prerequisites: [],
    },
    attack: null,
  },

  neutral_bridge: {
    id: 'neutral_bridge',
    name: 'Bridge',
    category: 'tech',
    side: null,
    factionExclusive: null,
    spriteKey: 'bld_neutral_bridge',
    footprint: { w: 1, h: 1 },
    providespower: 0,
    produces: [],
    stats: {
      maxHp: 700,
      armor: 0.25,
      speed: 0,
      sightRange: 1,
      cost: 0,
      buildTime: 0,
      prerequisites: [],
    },
    attack: null,
  },
}

const NEUTRAL_IDS = ['oil_derrick', 'tech_center', 'neutral_hospital', 'neutral_repair_depot', 'neutral_bridge']
const BUILDABLE_BUILDING_IDS = Object.keys(BUILDING_DEFS).filter(id =>
  !['construction_yard', ...NEUTRAL_IDS].includes(id)
)
const INFANTRY_UNIT_IDS = Object.keys(UNIT_DEFS).filter(id => UNIT_DEFS[id].category === 'infantry')
const VEHICLE_UNIT_IDS = Object.keys(UNIT_DEFS).filter(id => UNIT_DEFS[id].category === 'vehicle')
const HARVESTER_UNIT_IDS = Object.keys(UNIT_DEFS).filter(id => UNIT_DEFS[id].category === 'harvester')
const AIR_UNIT_IDS = Object.keys(UNIT_DEFS).filter(id => UNIT_DEFS[id].category === 'aircraft')
const NAVAL_UNIT_IDS = Object.keys(UNIT_DEFS).filter(id => UNIT_DEFS[id].category === 'naval')

BUILDING_DEFS.construction_yard.produces = BUILDABLE_BUILDING_IDS
BUILDING_DEFS.barracks.produces = INFANTRY_UNIT_IDS
BUILDING_DEFS.war_factory.produces = [...VEHICLE_UNIT_IDS, ...HARVESTER_UNIT_IDS, 'kirov']
BUILDING_DEFS.ore_refinery.produces = HARVESTER_UNIT_IDS
BUILDING_DEFS.air_force_command.produces = AIR_UNIT_IDS.filter(id => id !== 'kirov')
BUILDING_DEFS.naval_shipyard.produces = NAVAL_UNIT_IDS

// ── Helpers ──────────────────────────────────────────────────

/** Tech tree order for prerequisite validation */
export const TECH_TREE_ORDER = [
  // Shared
  'construction_yard', 'barracks', 'war_factory', 'ore_refinery',
  'naval_shipyard', 'service_depot', 'battle_lab', 'fortress_wall',
  // Alliance
  'power_plant', 'air_force_command', 'ore_purifier', 'spy_satellite',
  'pillbox', 'prism_tower', 'patriot_missile', 'gap_generator',
  'weather_device', 'chronosphere', 'grand_cannon',
  // Collective
  'tesla_reactor', 'radar_tower', 'nuclear_reactor', 'cloning_vats',
  'sentry_gun', 'tesla_coil', 'flak_cannon', 'psychic_sensor',
  'nuclear_silo', 'iron_curtain',
  // Neutral (not buildable by players)
  'oil_derrick', 'tech_center', 'neutral_hospital', 'neutral_repair_depot', 'neutral_bridge',
]

/** IDs of neutral map structures (capturable unless special-cased in gameplay logic) */
export const NEUTRAL_BUILDING_IDS = ['oil_derrick', 'tech_center', 'neutral_hospital', 'neutral_repair_depot', 'neutral_bridge']
const NEUTRAL_BUILDING_ID_SET = new Set(NEUTRAL_BUILDING_IDS)

/** Superweapon building IDs (max 1 each) */
export const SUPERWEAPON_BUILDING_IDS = ['nuclear_silo', 'weather_device', 'iron_curtain', 'chronosphere']

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
    if (NEUTRAL_BUILDING_ID_SET.has(id)) return false
    const def = BUILDING_DEFS[id]
    const sideMatch = def.side === side || def.side === null
    const exclusiveMatch = def.factionExclusive === null || def.factionExclusive === factionId
    return sideMatch && exclusiveMatch
  })
}

/** Get all building IDs available to a given side */
export function getAvailableBuildingIdsBySide(side: FactionSide, factionId?: string): string[] {
  return Object.keys(BUILDING_DEFS).filter(id => {
    if (NEUTRAL_BUILDING_ID_SET.has(id)) return false
    const def = BUILDING_DEFS[id]
    const sideMatch = def.side === side || def.side === null
    const exclusiveMatch = def.factionExclusive === null ||
      (factionId && def.factionExclusive === factionId)
    return sideMatch && exclusiveMatch
  })
}
