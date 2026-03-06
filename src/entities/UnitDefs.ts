// ============================================================
// IRON COMMAND — Unit Definitions (RA2-Style Asymmetric Rosters)
// Iron Alliance vs Red Collective — different shared units per side
// Each country gets ONE special unit via factionExclusive
// ============================================================

import type { UnitDef, FactionId, FactionSide } from '../types'
import { DamageType } from '../types'
import { FACTIONS } from '../data/factions'

export const UNIT_DEFS: Record<string, UnitDef> = {

  // ════════════════════════════════════════════════════════════
  // IRON ALLIANCE — Shared Units
  // ════════════════════════════════════════════════════════════

  // ── Alliance Infantry ──────────────────────────────────────

  gi: {
    id: 'gi',
    name: 'GI',
    category: 'infantry',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_gi',
    stats: {
      maxHp: 125,
      armor: 0,
      speed: 2.5,
      sightRange: 5,
      cost: 200,
      buildTime: 5,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 15,
      range: 5,
      fireRate: 1.5,
      projectileSpeed: 400,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  engineer: {
    id: 'engineer',
    name: 'Engineer',
    category: 'infantry',
    side: null, // available to both sides
    factionExclusive: null,
    spriteKey: 'unit_engineer',
    stats: {
      maxHp: 75,
      armor: 0,
      speed: 2,
      sightRange: 4,
      cost: 500,
      buildTime: 10,
      prerequisites: ['barracks'],
    },
    attack: null,
  },

  rocketeer: {
    id: 'rocketeer',
    name: 'Rocketeer',
    category: 'aircraft',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_rocketeer',
    stats: {
      maxHp: 125,
      armor: 0.05,
      speed: 5,
      sightRange: 6,
      cost: 600,
      buildTime: 10,
      prerequisites: ['barracks', 'air_force_command'],
    },
    attack: {
      damage: 25,
      range: 5,
      fireRate: 1.2,
      projectileSpeed: 500,
      damageType: DamageType.BULLET,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0,
    },
  },

  spy: {
    id: 'spy',
    name: 'Spy',
    category: 'infantry',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_spy',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 3,
      sightRange: 6,
      cost: 1000,
      buildTime: 15,
      prerequisites: ['barracks', 'battle_lab'],
    },
    attack: null,
  },

  attack_dog: {
    id: 'attack_dog',
    name: 'Attack Dog',
    category: 'infantry',
    side: null, // available to both sides
    factionExclusive: null,
    spriteKey: 'unit_attack_dog',
    stats: {
      maxHp: 60,
      armor: 0,
      speed: 4.5,
      sightRange: 7,
      cost: 200,
      buildTime: 4,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 100, // instant kill vs infantry
      range: 1,
      fireRate: 2,
      projectileSpeed: 0,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── Alliance Vehicles ──────────────────────────────────────

  grizzly_tank: {
    id: 'grizzly_tank',
    name: 'Grizzly Tank',
    category: 'vehicle',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_grizzly_tank',
    stats: {
      maxHp: 300,
      armor: 0.3,
      speed: 3,
      sightRange: 6,
      cost: 700,
      buildTime: 15,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 65,
      range: 5.5,
      fireRate: 0.8,
      projectileSpeed: 600,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  ifv: {
    id: 'ifv',
    name: 'IFV',
    category: 'vehicle',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_ifv',
    stats: {
      maxHp: 200,
      armor: 0.15,
      speed: 4,
      sightRange: 7,
      cost: 600,
      buildTime: 12,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 30,
      range: 6,
      fireRate: 1.5,
      projectileSpeed: 700,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0,
    },
  },

  chrono_miner: {
    id: 'chrono_miner',
    name: 'Chrono Miner',
    category: 'harvester',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_chrono_miner',
    stats: {
      maxHp: 600,
      armor: 0.2,
      speed: 1.5,
      sightRange: 4,
      cost: 1400,
      buildTime: 20,
      prerequisites: ['ore_refinery'],
    },
    attack: null,
  },

  mcv: {
    id: 'mcv',
    name: 'MCV',
    category: 'vehicle',
    side: null, // both sides
    factionExclusive: null,
    spriteKey: 'unit_mcv',
    stats: {
      maxHp: 1000,
      armor: 0.3,
      speed: 1,
      sightRange: 5,
      cost: 3000,
      buildTime: 60,
      prerequisites: ['war_factory', 'service_depot'],
    },
    attack: null,
  },

  // ── Alliance Aircraft ──────────────────────────────────────

  harrier: {
    id: 'harrier',
    name: 'Harrier',
    category: 'aircraft',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_harrier',
    stats: {
      maxHp: 150,
      armor: 0.1,
      speed: 8,
      sightRange: 8,
      cost: 1200,
      buildTime: 20,
      prerequisites: ['air_force_command'],
    },
    attack: {
      damage: 75,
      range: 7,
      fireRate: 0.6,
      projectileSpeed: 700,
      damageType: DamageType.MISSILE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  nighthawk: {
    id: 'nighthawk',
    name: 'Night Hawk',
    category: 'aircraft',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_nighthawk',
    stats: {
      maxHp: 175,
      armor: 0.1,
      speed: 6,
      sightRange: 6,
      cost: 1000,
      buildTime: 18,
      prerequisites: ['air_force_command'],
    },
    attack: {
      damage: 20,
      range: 5,
      fireRate: 1,
      projectileSpeed: 500,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── Alliance Naval ─────────────────────────────────────────

  destroyer: {
    id: 'destroyer',
    name: 'Destroyer',
    category: 'naval',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_destroyer',
    stats: {
      maxHp: 600,
      armor: 0.25,
      speed: 2.5,
      sightRange: 8,
      cost: 1000,
      buildTime: 20,
      prerequisites: ['naval_shipyard'],
    },
    attack: {
      damage: 50,
      range: 7,
      fireRate: 0.8,
      projectileSpeed: 550,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  aegis_cruiser: {
    id: 'aegis_cruiser',
    name: 'Aegis Cruiser',
    category: 'naval',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_aegis_cruiser',
    stats: {
      maxHp: 800,
      armor: 0.3,
      speed: 2,
      sightRange: 10,
      cost: 1200,
      buildTime: 25,
      prerequisites: ['naval_shipyard'],
    },
    attack: {
      damage: 40,
      range: 10,
      fireRate: 2,
      projectileSpeed: 900,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: false,
      splash: 0,
    },
  },

  aircraft_carrier: {
    id: 'aircraft_carrier',
    name: 'Aircraft Carrier',
    category: 'naval',
    side: 'alliance',
    factionExclusive: null,
    spriteKey: 'unit_aircraft_carrier',
    stats: {
      maxHp: 1200,
      armor: 0.35,
      speed: 1.5,
      sightRange: 12,
      cost: 2000,
      buildTime: 40,
      prerequisites: ['naval_shipyard', 'battle_lab'],
    },
    attack: {
      damage: 80,
      range: 14,
      fireRate: 0.3,
      projectileSpeed: 600,
      damageType: DamageType.MISSILE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1,
    },
  },

  // ════════════════════════════════════════════════════════════
  // RED COLLECTIVE — Shared Units
  // ════════════════════════════════════════════════════════════

  // ── Collective Infantry ────────────────────────────────────

  conscript: {
    id: 'conscript',
    name: 'Conscript',
    category: 'infantry',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_conscript',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 2.5,
      sightRange: 5,
      cost: 100,
      buildTime: 3,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 12,
      range: 4,
      fireRate: 1.8,
      projectileSpeed: 400,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  flak_trooper: {
    id: 'flak_trooper',
    name: 'Flak Trooper',
    category: 'infantry',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_flak_trooper',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 2.5,
      sightRange: 6,
      cost: 300,
      buildTime: 6,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 25,
      range: 6,
      fireRate: 1,
      projectileSpeed: 600,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  tesla_trooper: {
    id: 'tesla_trooper',
    name: 'Tesla Trooper',
    category: 'infantry',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_tesla_trooper',
    stats: {
      maxHp: 130,
      armor: 0.15,
      speed: 2,
      sightRange: 5,
      cost: 500,
      buildTime: 10,
      prerequisites: ['barracks', 'radar_tower'],
    },
    attack: {
      damage: 80,
      range: 3,
      fireRate: 0.8,
      projectileSpeed: 0, // hitscan electric arc
      damageType: DamageType.ELECTRIC,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  crazy_ivan: {
    id: 'crazy_ivan',
    name: 'Crazy Ivan',
    category: 'infantry',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_crazy_ivan',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 2.5,
      sightRange: 5,
      cost: 600,
      buildTime: 10,
      prerequisites: ['barracks', 'radar_tower'],
    },
    attack: {
      damage: 200,
      range: 1,
      fireRate: 0.2,
      projectileSpeed: 0,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 2,
    },
  },

  // ── Collective Vehicles ────────────────────────────────────

  rhino_tank: {
    id: 'rhino_tank',
    name: 'Rhino Tank',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_rhino_tank',
    stats: {
      maxHp: 400,
      armor: 0.35,
      speed: 2.5,
      sightRange: 6,
      cost: 900,
      buildTime: 18,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 90,
      range: 5.5,
      fireRate: 0.7,
      projectileSpeed: 550,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  flak_track: {
    id: 'flak_track',
    name: 'Flak Track',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_flak_track',
    stats: {
      maxHp: 180,
      armor: 0.1,
      speed: 3.5,
      sightRange: 7,
      cost: 500,
      buildTime: 10,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 20,
      range: 6,
      fireRate: 2,
      projectileSpeed: 600,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  v3_launcher: {
    id: 'v3_launcher',
    name: 'V3 Launcher',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_v3_launcher',
    stats: {
      maxHp: 150,
      armor: 0.05,
      speed: 1.5,
      sightRange: 5,
      cost: 800,
      buildTime: 16,
      prerequisites: ['war_factory', 'radar_tower'],
    },
    attack: {
      damage: 200,
      range: 14,
      fireRate: 0.15,
      projectileSpeed: 800,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 2.5,
    },
  },

  war_miner: {
    id: 'war_miner',
    name: 'War Miner',
    category: 'harvester',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_war_miner',
    stats: {
      maxHp: 800,
      armor: 0.3,
      speed: 1.2,
      sightRange: 4,
      cost: 1400,
      buildTime: 20,
      prerequisites: ['ore_refinery'],
    },
    attack: {
      damage: 20,
      range: 4,
      fireRate: 1.5,
      projectileSpeed: 400,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  apocalypse_tank: {
    id: 'apocalypse_tank',
    name: 'Apocalypse Tank',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_apocalypse_tank',
    stats: {
      maxHp: 800,
      armor: 0.5,
      speed: 1.5,
      sightRange: 7,
      cost: 1750,
      buildTime: 40,
      prerequisites: ['war_factory', 'battle_lab'],
    },
    attack: {
      damage: 120,
      range: 6,
      fireRate: 0.6,
      projectileSpeed: 600,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 1,
    },
  },

  // ── Collective Aircraft ────────────────────────────────────

  kirov: {
    id: 'kirov',
    name: 'Kirov Airship',
    category: 'aircraft',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_kirov',
    stats: {
      maxHp: 2000,
      armor: 0.2,
      speed: 1.5,
      sightRange: 8,
      cost: 2000,
      buildTime: 45,
      prerequisites: ['war_factory', 'battle_lab'],
    },
    attack: {
      damage: 250,
      range: 3,
      fireRate: 0.3,
      projectileSpeed: 200,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 3,
    },
  },

  // ── Collective Naval ───────────────────────────────────────

  typhoon_sub: {
    id: 'typhoon_sub',
    name: 'Typhoon Sub',
    category: 'naval',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_typhoon_sub',
    stats: {
      maxHp: 600,
      armor: 0.2,
      speed: 2.5,
      sightRange: 6,
      cost: 1000,
      buildTime: 20,
      prerequisites: ['naval_shipyard'],
    },
    attack: {
      damage: 75,
      range: 6,
      fireRate: 0.5,
      projectileSpeed: 500,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  dreadnought: {
    id: 'dreadnought',
    name: 'Dreadnought',
    category: 'naval',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_dreadnought',
    stats: {
      maxHp: 1000,
      armor: 0.35,
      speed: 1.5,
      sightRange: 10,
      cost: 1500,
      buildTime: 30,
      prerequisites: ['naval_shipyard', 'battle_lab'],
    },
    attack: {
      damage: 200,
      range: 16,
      fireRate: 0.2,
      projectileSpeed: 600,
      damageType: DamageType.MISSILE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 3,
    },
  },

  giant_squid: {
    id: 'giant_squid',
    name: 'Giant Squid',
    category: 'naval',
    side: 'collective',
    factionExclusive: null,
    spriteKey: 'unit_giant_squid',
    stats: {
      maxHp: 200,
      armor: 0.1,
      speed: 3,
      sightRange: 6,
      cost: 1000,
      buildTime: 18,
      prerequisites: ['naval_shipyard'],
    },
    attack: {
      damage: 50,
      range: 1,
      fireRate: 0.5,
      projectileSpeed: 0,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ════════════════════════════════════════════════════════════
  // COUNTRY SPECIALS — One per country
  // ════════════════════════════════════════════════════════════

  // ── Alliance Country Specials ──────────────────────────────

  // USA — Paratroopers is an ability, not a unit. No unit entry needed.

  // France — Grand Cannon is a building, defined in BuildingDefs.ts

  tank_destroyer: {
    id: 'tank_destroyer',
    name: 'Tank Destroyer',
    category: 'vehicle',
    side: 'alliance',
    factionExclusive: 'germany',
    spriteKey: 'unit_tank_destroyer',
    stats: {
      maxHp: 250,
      armor: 0.25,
      speed: 3.5,
      sightRange: 7,
      cost: 900,
      buildTime: 16,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 100,
      range: 7,
      fireRate: 0.7,
      projectileSpeed: 700,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  sniper: {
    id: 'sniper',
    name: 'Sniper',
    category: 'infantry',
    side: 'alliance',
    factionExclusive: 'uk',
    spriteKey: 'unit_sniper',
    stats: {
      maxHp: 80,
      armor: 0,
      speed: 2,
      sightRange: 10,
      cost: 600,
      buildTime: 12,
      prerequisites: ['barracks', 'battle_lab'],
    },
    attack: {
      damage: 150,
      range: 10,
      fireRate: 0.3,
      projectileSpeed: 0, // hitscan
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  black_eagle: {
    id: 'black_eagle',
    name: 'Black Eagle',
    category: 'aircraft',
    side: 'alliance',
    factionExclusive: 'korea',
    spriteKey: 'unit_black_eagle',
    stats: {
      maxHp: 200,
      armor: 0.15,
      speed: 10,
      sightRange: 9,
      cost: 1200,
      buildTime: 20,
      prerequisites: ['air_force_command'],
    },
    attack: {
      damage: 90,
      range: 8,
      fireRate: 0.7,
      projectileSpeed: 800,
      damageType: DamageType.MISSILE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  mecha_walker: {
    id: 'mecha_walker',
    name: 'Mecha Walker',
    category: 'vehicle',
    side: 'alliance',
    factionExclusive: 'japan',
    spriteKey: 'unit_mecha_walker',
    stats: {
      maxHp: 500,
      armor: 0.35,
      speed: 2.5,
      sightRange: 7,
      cost: 1600,
      buildTime: 25,
      prerequisites: ['war_factory', 'battle_lab'],
    },
    attack: {
      damage: 80,
      range: 6,
      fireRate: 0.9,
      projectileSpeed: 500,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  prism_tank: {
    id: 'prism_tank',
    name: 'Prism Tank',
    category: 'vehicle',
    side: 'alliance',
    factionExclusive: 'italy',
    spriteKey: 'unit_prism_tank',
    stats: {
      maxHp: 200,
      armor: 0.15,
      speed: 2.5,
      sightRange: 7,
      cost: 1200,
      buildTime: 22,
      prerequisites: ['war_factory', 'battle_lab'],
    },
    attack: {
      damage: 100,
      range: 8,
      fireRate: 0.5,
      projectileSpeed: 0, // hitscan beam
      damageType: DamageType.ELECTRIC,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1.5,
    },
  },

  recon_drone: {
    id: 'recon_drone',
    name: 'Recon Drone',
    category: 'aircraft',
    side: 'alliance',
    factionExclusive: 'south_africa',
    spriteKey: 'unit_recon_drone',
    stats: {
      maxHp: 80,
      armor: 0,
      speed: 7,
      sightRange: 14,
      cost: 400,
      buildTime: 8,
      prerequisites: ['air_force_command'],
    },
    attack: null, // unarmed scout
  },

  // ── Collective Country Specials ────────────────────────────

  tesla_tank: {
    id: 'tesla_tank',
    name: 'Tesla Tank',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: 'russia',
    spriteKey: 'unit_tesla_tank',
    stats: {
      maxHp: 300,
      armor: 0.25,
      speed: 2.5,
      sightRange: 6,
      cost: 1200,
      buildTime: 20,
      prerequisites: ['war_factory', 'radar_tower'],
    },
    attack: {
      damage: 90,
      range: 5,
      fireRate: 0.7,
      projectileSpeed: 0, // hitscan electric
      damageType: DamageType.ELECTRIC,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  dragon_tank: {
    id: 'dragon_tank',
    name: 'Dragon Tank',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: 'china',
    spriteKey: 'unit_dragon_tank',
    stats: {
      maxHp: 300,
      armor: 0.2,
      speed: 2.5,
      sightRange: 5,
      cost: 800,
      buildTime: 14,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 60,
      range: 3,
      fireRate: 1,
      projectileSpeed: 0, // flame stream
      damageType: DamageType.FIRE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1.5,
    },
  },

  desolator: {
    id: 'desolator',
    name: 'Desolator',
    category: 'infantry',
    side: 'collective',
    factionExclusive: 'iran',
    spriteKey: 'unit_desolator',
    stats: {
      maxHp: 150,
      armor: 0.1,
      speed: 2,
      sightRange: 5,
      cost: 600,
      buildTime: 12,
      prerequisites: ['barracks', 'radar_tower'],
    },
    attack: {
      damage: 50,
      range: 4,
      fireRate: 0.6,
      projectileSpeed: 0,
      damageType: DamageType.FIRE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 2,
    },
  },

  demo_truck: {
    id: 'demo_truck',
    name: 'Demolition Truck',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: 'iraq',
    spriteKey: 'unit_demo_truck',
    stats: {
      maxHp: 150,
      armor: 0,
      speed: 4,
      sightRange: 4,
      cost: 1500,
      buildTime: 15,
      prerequisites: ['war_factory', 'radar_tower'],
    },
    attack: {
      damage: 500,
      range: 0,
      fireRate: 0.1,
      projectileSpeed: 0,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 4,
    },
  },

  terrorist: {
    id: 'terrorist',
    name: 'Terrorist',
    category: 'infantry',
    side: 'collective',
    factionExclusive: 'mexico',
    spriteKey: 'unit_terrorist',
    stats: {
      maxHp: 50,
      armor: 0,
      speed: 4,
      sightRange: 4,
      cost: 200,
      buildTime: 5,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 400,
      range: 0,
      fireRate: 0.1,
      projectileSpeed: 0,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 3,
    },
  },

  brahmos_battery: {
    id: 'brahmos_battery',
    name: 'Brahmos Battery',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: 'india',
    spriteKey: 'unit_brahmos_battery',
    stats: {
      maxHp: 200,
      armor: 0.1,
      speed: 1,
      sightRange: 6,
      cost: 800,
      buildTime: 18,
      prerequisites: ['war_factory', 'radar_tower'],
    },
    attack: {
      damage: 250,
      range: 16,
      fireRate: 0.15,
      projectileSpeed: 1000,
      damageType: DamageType.MISSILE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 2,
    },
  },

  conquistador_mech: {
    id: 'conquistador_mech',
    name: 'Conquistador Mech',
    category: 'vehicle',
    side: 'collective',
    factionExclusive: 'spain',
    spriteKey: 'unit_conquistador_mech',
    stats: {
      maxHp: 700,
      armor: 0.4,
      speed: 2,
      sightRange: 6,
      cost: 1800,
      buildTime: 30,
      prerequisites: ['war_factory', 'battle_lab'],
    },
    attack: {
      damage: 110,
      range: 6,
      fireRate: 0.7,
      projectileSpeed: 560,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1,
    },
  },
}

// ── Helpers ──────────────────────────────────────────────────

/** Get the faction side for a given faction ID */
function getSide(factionId: string): FactionSide {
  return FACTIONS[factionId as FactionId]?.side ?? 'alliance'
}

/** All shared unit IDs for a given side (non-faction-exclusive) */
export function getSideUnitIds(side: FactionSide): string[] {
  return Object.keys(UNIT_DEFS).filter(id => {
    const def = UNIT_DEFS[id]
    return def.factionExclusive === null && (def.side === side || def.side === null)
  })
}

/** Get the unique unit IDs for a given faction (country specials) */
export function getFactionUnitIds(factionId: string): string[] {
  return Object.keys(UNIT_DEFS).filter(
    id => UNIT_DEFS[id].factionExclusive === factionId
  )
}

/** All unit IDs available to a specific faction: side shared + country special */
export function getAvailableUnitIds(factionId: string): string[] {
  const side = getSide(factionId)
  return Object.keys(UNIT_DEFS).filter(id => {
    const def = UNIT_DEFS[id]
    // Side match (or null = both sides) AND (no exclusive OR exclusive matches)
    const sideMatch = def.side === side || def.side === null
    const exclusiveMatch = def.factionExclusive === null || def.factionExclusive === factionId
    return sideMatch && exclusiveMatch
  })
}

/** Get available unit IDs by side directly */
export function getAvailableUnitIdsBySide(side: FactionSide, factionId?: string): string[] {
  return Object.keys(UNIT_DEFS).filter(id => {
    const def = UNIT_DEFS[id]
    const sideMatch = def.side === side || def.side === null
    const exclusiveMatch = def.factionExclusive === null ||
      (factionId && def.factionExclusive === factionId)
    return sideMatch && exclusiveMatch
  })
}

/** Backwards-compatible: all shared units (both sides, non-exclusive) */
export const SHARED_UNIT_IDS = Object.keys(UNIT_DEFS).filter(
  id => UNIT_DEFS[id].factionExclusive === null && UNIT_DEFS[id].side === null
)

/** Get the harvester def ID for a given side */
export function getHarvesterDefId(side: FactionSide): string {
  return side === 'alliance' ? 'chrono_miner' : 'war_miner'
}

/** Get the basic infantry def ID for a given side */
export function getBasicInfantryDefId(side: FactionSide): string {
  return side === 'alliance' ? 'gi' : 'conscript'
}

/** Get the main battle tank def ID for a given side */
export function getMainTankDefId(side: FactionSide): string {
  return side === 'alliance' ? 'grizzly_tank' : 'rhino_tank'
}
