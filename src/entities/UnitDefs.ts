// ============================================================
// IRON COMMAND — Unit Definitions
// All shared units + 2 unique units per faction (30 total)
// ============================================================

import type { UnitDef } from '../types'
import { DamageType } from '../types'

// ── Shared Units (available to all factions) ─────────────────

export const UNIT_DEFS: Record<string, UnitDef> = {

  // ── Infantry ────────────────────────────────────────────────

  rifle_soldier: {
    id: 'rifle_soldier',
    name: 'Rifle Soldier',
    category: 'infantry',
    factionExclusive: null,
    spriteKey: 'unit_rifle_soldier',
    stats: {
      maxHp: 80,
      armor: 0,
      speed: 2.5,
      sightRange: 6,
      cost: 300,
      buildTime: 8,
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

  rocket_soldier: {
    id: 'rocket_soldier',
    name: 'Rocket Soldier',
    category: 'infantry',
    factionExclusive: null,
    spriteKey: 'unit_rocket_soldier',
    stats: {
      maxHp: 80,
      armor: 0,
      speed: 2,
      sightRange: 6,
      cost: 450,
      buildTime: 12,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 50,
      range: 6,
      fireRate: 0.5,
      projectileSpeed: 500,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  engineer: {
    id: 'engineer',
    name: 'Engineer',
    category: 'infantry',
    factionExclusive: null,
    spriteKey: 'unit_engineer',
    stats: {
      maxHp: 80,
      armor: 0,
      speed: 2,
      sightRange: 5,
      cost: 600,
      buildTime: 15,
      prerequisites: ['barracks'],
    },
    attack: null, // captures/repairs only
  },

  attack_dog: {
    id: 'attack_dog',
    name: 'Attack Dog',
    category: 'infantry',
    factionExclusive: null,
    spriteKey: 'unit_attack_dog',
    stats: {
      maxHp: 60,
      armor: 0,
      speed: 4.5,
      sightRange: 7,
      cost: 200,
      buildTime: 5,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 35,
      range: 1,
      fireRate: 2,
      projectileSpeed: 0, // hitscan / melee
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── Vehicles ────────────────────────────────────────────────

  light_tank: {
    id: 'light_tank',
    name: 'Light Tank',
    category: 'vehicle',
    factionExclusive: null,
    spriteKey: 'unit_light_tank',
    stats: {
      maxHp: 300,
      armor: 0.2,
      speed: 3.5,
      sightRange: 6,
      cost: 800,
      buildTime: 15,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 60,
      range: 6,
      fireRate: 0.8,
      projectileSpeed: 600,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  heavy_tank: {
    id: 'heavy_tank',
    name: 'Heavy Tank',
    category: 'vehicle',
    factionExclusive: null,
    spriteKey: 'unit_heavy_tank',
    stats: {
      maxHp: 700,
      armor: 0.4,
      speed: 2,
      sightRange: 6,
      cost: 1500,
      buildTime: 25,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 100,
      range: 6,
      fireRate: 0.6,
      projectileSpeed: 550,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  artillery: {
    id: 'artillery',
    name: 'Artillery',
    category: 'vehicle',
    factionExclusive: null,
    spriteKey: 'unit_artillery',
    stats: {
      maxHp: 200,
      armor: 0.1,
      speed: 1.5,
      sightRange: 5,
      cost: 1200,
      buildTime: 22,
      prerequisites: ['war_factory', 'radar_tower'],
    },
    attack: {
      damage: 150,
      range: 12,
      fireRate: 0.25,
      projectileSpeed: 800,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 2,
    },
  },

  apc: {
    id: 'apc',
    name: 'APC',
    category: 'vehicle',
    factionExclusive: null,
    spriteKey: 'unit_apc',
    stats: {
      maxHp: 200,
      armor: 0.15,
      speed: 3,
      sightRange: 6,
      cost: 800,
      buildTime: 15,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 20,
      range: 4,
      fireRate: 1,
      projectileSpeed: 400,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  harvester: {
    id: 'harvester',
    name: 'Harvester',
    category: 'harvester',
    factionExclusive: null,
    spriteKey: 'unit_harvester',
    stats: {
      maxHp: 400,
      armor: 0.2,
      speed: 1.5,
      sightRange: 4,
      cost: 1400,
      buildTime: 20,
      prerequisites: ['ore_refinery'],
    },
    attack: null,
  },

  // ── Aircraft ────────────────────────────────────────────────

  fighter_jet: {
    id: 'fighter_jet',
    name: 'Fighter Jet',
    category: 'aircraft',
    factionExclusive: null,
    spriteKey: 'unit_fighter_jet',
    stats: {
      maxHp: 150,
      armor: 0.1,
      speed: 8,
      sightRange: 8,
      cost: 1200,
      buildTime: 20,
      prerequisites: ['airfield'],
    },
    attack: {
      damage: 60,
      range: 7,
      fireRate: 1,
      projectileSpeed: 700,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0,
    },
  },

  bomber: {
    id: 'bomber',
    name: 'Bomber',
    category: 'aircraft',
    factionExclusive: null,
    spriteKey: 'unit_bomber',
    stats: {
      maxHp: 200,
      armor: 0.1,
      speed: 5,
      sightRange: 7,
      cost: 1800,
      buildTime: 30,
      prerequisites: ['airfield', 'radar_tower'],
    },
    attack: {
      damage: 200,
      range: 6,
      fireRate: 0.3,
      projectileSpeed: 600,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 2.5,
    },
  },

  // ── Naval ───────────────────────────────────────────────────

  gunboat: {
    id: 'gunboat',
    name: 'Gunboat',
    category: 'naval',
    factionExclusive: null,
    spriteKey: 'unit_gunboat',
    stats: {
      maxHp: 400,
      armor: 0.2,
      speed: 3,
      sightRange: 7,
      cost: 1200,
      buildTime: 20,
      prerequisites: ['naval_yard'],
    },
    attack: {
      damage: 70,
      range: 7,
      fireRate: 0.8,
      projectileSpeed: 550,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  // ── China Unique ─────────────────────────────────────────────

  dragon_tank: {
    id: 'dragon_tank',
    name: 'Dragon Tank',
    category: 'vehicle',
    factionExclusive: 'china',
    spriteKey: 'unit_dragon_tank',
    stats: {
      maxHp: 800,
      armor: 0.4,
      speed: 2,
      sightRange: 6,
      cost: 2000,
      buildTime: 30,
      prerequisites: ['war_factory', 'tech_center'],
    },
    attack: {
      damage: 120,
      range: 6,
      fireRate: 0.7,
      projectileSpeed: 0,
      damageType: DamageType.FIRE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1.5,
    },
  },

  red_guard_elite: {
    id: 'red_guard_elite',
    name: 'Red Guard Elite',
    category: 'infantry',
    factionExclusive: 'china',
    spriteKey: 'unit_red_guard_elite',
    stats: {
      maxHp: 120,
      armor: 0.1,
      speed: 3,
      sightRange: 6,
      cost: 500,
      buildTime: 10,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 30,
      range: 4,
      fireRate: 1.8,
      projectileSpeed: 400,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── Japan Unique ─────────────────────────────────────────────

  mecha_walker: {
    id: 'mecha_walker',
    name: 'Mecha Walker',
    category: 'vehicle',
    factionExclusive: 'japan',
    spriteKey: 'unit_mecha_walker',
    stats: {
      maxHp: 600,
      armor: 0.35,
      speed: 2.5,
      sightRange: 7,
      cost: 2200,
      buildTime: 32,
      prerequisites: ['war_factory', 'tech_center'],
    },
    attack: {
      damage: 90,
      range: 6,
      fireRate: 0.8,
      projectileSpeed: 500,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 1,
    },
  },

  shogun_battleship: {
    id: 'shogun_battleship',
    name: 'Shogun Battleship',
    category: 'naval',
    factionExclusive: 'japan',
    spriteKey: 'unit_shogun_battleship',
    stats: {
      maxHp: 1200,
      armor: 0.5,
      speed: 1.5,
      sightRange: 10,
      cost: 3500,
      buildTime: 50,
      prerequisites: ['naval_yard', 'tech_center'],
    },
    attack: {
      damage: 200,
      range: 14,
      fireRate: 0.4,
      projectileSpeed: 900,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 3,
    },
  },

  // ── USA Unique ───────────────────────────────────────────────

  raptor_fighter: {
    id: 'raptor_fighter',
    name: 'Raptor Fighter',
    category: 'aircraft',
    factionExclusive: 'usa',
    spriteKey: 'unit_raptor_fighter',
    stats: {
      maxHp: 200,
      armor: 0.15,
      speed: 10,
      sightRange: 9,
      cost: 1600,
      buildTime: 25,
      prerequisites: ['airfield', 'tech_center'],
    },
    attack: {
      damage: 90,
      range: 8,
      fireRate: 1.2,
      projectileSpeed: 800,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0,
    },
  },

  navy_seal: {
    id: 'navy_seal',
    name: 'Navy SEAL',
    category: 'infantry',
    factionExclusive: 'usa',
    spriteKey: 'unit_navy_seal',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 3.5,
      sightRange: 7,
      cost: 800,
      buildTime: 14,
      prerequisites: ['barracks', 'tech_center'],
    },
    attack: {
      damage: 30,
      range: 5,
      fireRate: 2,
      projectileSpeed: 450,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── Russia Unique ────────────────────────────────────────────

  apocalypse_tank: {
    id: 'apocalypse_tank',
    name: 'Apocalypse Tank',
    category: 'vehicle',
    factionExclusive: 'russia',
    spriteKey: 'unit_apocalypse_tank',
    stats: {
      maxHp: 1200,
      armor: 0.55,
      speed: 1.5,
      sightRange: 6,
      cost: 3000,
      buildTime: 45,
      prerequisites: ['war_factory', 'tech_center'],
    },
    attack: {
      damage: 150,
      range: 7,
      fireRate: 0.6,
      projectileSpeed: 600,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1.5,
    },
  },

  tesla_trooper: {
    id: 'tesla_trooper',
    name: 'Tesla Trooper',
    category: 'infantry',
    factionExclusive: 'russia',
    spriteKey: 'unit_tesla_trooper',
    stats: {
      maxHp: 80,
      armor: 0.1,
      speed: 2,
      sightRange: 5,
      cost: 700,
      buildTime: 14,
      prerequisites: ['barracks', 'tech_center'],
    },
    attack: {
      damage: 80,
      range: 3,
      fireRate: 0.8,
      projectileSpeed: 600,
      damageType: DamageType.ELECTRIC,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── Iran Unique ──────────────────────────────────────────────

  revolutionary_guard: {
    id: 'revolutionary_guard',
    name: 'Revolutionary Guard',
    category: 'infantry',
    factionExclusive: 'iran',
    spriteKey: 'unit_revolutionary_guard',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 2.5,
      sightRange: 5,
      cost: 350,
      buildTime: 7,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 20,
      range: 5,
      fireRate: 1.5,
      projectileSpeed: 400,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  shahab_launcher: {
    id: 'shahab_launcher',
    name: 'Shahab Launcher',
    category: 'vehicle',
    factionExclusive: 'iran',
    spriteKey: 'unit_shahab_launcher',
    stats: {
      maxHp: 300,
      armor: 0.1,
      speed: 1,
      sightRange: 5,
      cost: 2000,
      buildTime: 35,
      prerequisites: ['war_factory', 'radar_tower'],
    },
    attack: {
      damage: 300,
      range: 15,
      fireRate: 0.15,
      projectileSpeed: 1000,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 3,
    },
  },

  // ── Mexico Unique ────────────────────────────────────────────

  guerrilla_fighter: {
    id: 'guerrilla_fighter',
    name: 'Guerrilla Fighter',
    category: 'infantry',
    factionExclusive: 'mexico',
    spriteKey: 'unit_guerrilla_fighter',
    stats: {
      maxHp: 80,
      armor: 0,
      speed: 3.5,
      sightRange: 6,
      cost: 400,
      buildTime: 8,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 20,
      range: 4,
      fireRate: 1.8,
      projectileSpeed: 400,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  aztec_mech: {
    id: 'aztec_mech',
    name: 'Aztec Mech',
    category: 'vehicle',
    factionExclusive: 'mexico',
    spriteKey: 'unit_aztec_mech',
    stats: {
      maxHp: 500,
      armor: 0.3,
      speed: 2,
      sightRange: 6,
      cost: 1800,
      buildTime: 28,
      prerequisites: ['war_factory', 'tech_center'],
    },
    attack: {
      damage: 80,
      range: 5,
      fireRate: 0.9,
      projectileSpeed: 0,
      damageType: DamageType.FIRE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1,
    },
  },

  // ── France Unique ────────────────────────────────────────────

  foreign_legionnaire: {
    id: 'foreign_legionnaire',
    name: 'Foreign Legionnaire',
    category: 'infantry',
    factionExclusive: 'france',
    spriteKey: 'unit_foreign_legionnaire',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 2.5,
      sightRange: 6,
      cost: 600,
      buildTime: 12,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 25,
      range: 6,
      fireRate: 1.5,
      projectileSpeed: 450,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  mirage_tank: {
    id: 'mirage_tank',
    name: 'Mirage Tank',
    category: 'vehicle',
    factionExclusive: 'france',
    spriteKey: 'unit_mirage_tank',
    stats: {
      maxHp: 400,
      armor: 0.25,
      speed: 3,
      sightRange: 7,
      cost: 1600,
      buildTime: 26,
      prerequisites: ['war_factory', 'tech_center'],
    },
    attack: {
      damage: 70,
      range: 6,
      fireRate: 0.9,
      projectileSpeed: 0,
      damageType: DamageType.FIRE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1.5,
    },
  },

  // ── UK Unique ────────────────────────────────────────────────

  sas_operative: {
    id: 'sas_operative',
    name: 'SAS Operative',
    category: 'infantry',
    factionExclusive: 'uk',
    spriteKey: 'unit_sas_operative',
    stats: {
      maxHp: 120,
      armor: 0,
      speed: 3,
      sightRange: 7,
      cost: 700,
      buildTime: 13,
      prerequisites: ['barracks', 'tech_center'],
    },
    attack: {
      damage: 40,
      range: 5,
      fireRate: 1.8,
      projectileSpeed: 450,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  bulldog_tank: {
    id: 'bulldog_tank',
    name: 'Bulldog Tank',
    category: 'vehicle',
    factionExclusive: 'uk',
    spriteKey: 'unit_bulldog_tank',
    stats: {
      maxHp: 600,
      armor: 0.4,
      speed: 2.5,
      sightRange: 6,
      cost: 1800,
      buildTime: 28,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 90,
      range: 6,
      fireRate: 0.7,
      projectileSpeed: 580,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  // ── Germany Unique ───────────────────────────────────────────

  panzer_mk4: {
    id: 'panzer_mk4',
    name: 'Panzer Mk IV',
    category: 'vehicle',
    factionExclusive: 'germany',
    spriteKey: 'unit_panzer_mk4',
    stats: {
      maxHp: 900,
      armor: 0.5,
      speed: 2,
      sightRange: 6,
      cost: 2200,
      buildTime: 35,
      prerequisites: ['war_factory', 'tech_center'],
    },
    attack: {
      damage: 130,
      range: 7,
      fireRate: 0.65,
      projectileSpeed: 600,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1,
    },
  },

  feldmarschall: {
    id: 'feldmarschall',
    name: 'Feldmarschall',
    category: 'infantry',
    factionExclusive: 'germany',
    spriteKey: 'unit_feldmarschall',
    stats: {
      maxHp: 150,
      armor: 0.1,
      speed: 2,
      sightRange: 7,
      cost: 900,
      buildTime: 16,
      prerequisites: ['barracks', 'tech_center'],
    },
    attack: {
      damage: 35,
      range: 6,
      fireRate: 1.2,
      projectileSpeed: 420,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── India Unique ─────────────────────────────────────────────

  gurkha_warrior: {
    id: 'gurkha_warrior',
    name: 'Gurkha Warrior',
    category: 'infantry',
    factionExclusive: 'india',
    spriteKey: 'unit_gurkha_warrior',
    stats: {
      maxHp: 130,
      armor: 0,
      speed: 3,
      sightRange: 6,
      cost: 550,
      buildTime: 11,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 35,
      range: 4,
      fireRate: 2,
      projectileSpeed: 0,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  brahmos_battery: {
    id: 'brahmos_battery',
    name: 'Brahmos Battery',
    category: 'vehicle',
    factionExclusive: 'india',
    spriteKey: 'unit_brahmos_battery',
    stats: {
      maxHp: 350,
      armor: 0.15,
      speed: 1,
      sightRange: 6,
      cost: 2500,
      buildTime: 40,
      prerequisites: ['war_factory', 'radar_tower'],
    },
    attack: {
      damage: 250,
      range: 16,
      fireRate: 0.2,
      projectileSpeed: 1200,
      damageType: DamageType.MISSILE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 2,
    },
  },

  // ── Iraq Unique ──────────────────────────────────────────────

  desert_scorpion: {
    id: 'desert_scorpion',
    name: 'Desert Scorpion',
    category: 'vehicle',
    factionExclusive: 'iraq',
    spriteKey: 'unit_desert_scorpion',
    stats: {
      maxHp: 400,
      armor: 0.2,
      speed: 3.5,
      sightRange: 7,
      cost: 1200,
      buildTime: 20,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 70,
      range: 5,
      fireRate: 1,
      projectileSpeed: 550,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  fedayeen: {
    id: 'fedayeen',
    name: 'Fedayeen',
    category: 'infantry',
    factionExclusive: 'iraq',
    spriteKey: 'unit_fedayeen',
    stats: {
      maxHp: 70,
      armor: 0,
      speed: 4,
      sightRange: 5,
      cost: 300,
      buildTime: 6,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 15,
      range: 3,
      fireRate: 2,
      projectileSpeed: 380,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── South Africa Unique ──────────────────────────────────────

  rooikat_recon: {
    id: 'rooikat_recon',
    name: 'Rooikat Recon',
    category: 'vehicle',
    factionExclusive: 'south_africa',
    spriteKey: 'unit_rooikat_recon',
    stats: {
      maxHp: 250,
      armor: 0.15,
      speed: 5,
      sightRange: 10,
      cost: 900,
      buildTime: 16,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 50,
      range: 8,
      fireRate: 1.2,
      projectileSpeed: 600,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  ratel_ifv: {
    id: 'ratel_ifv',
    name: 'Ratel IFV',
    category: 'vehicle',
    factionExclusive: 'south_africa',
    spriteKey: 'unit_ratel_ifv',
    stats: {
      maxHp: 450,
      armor: 0.25,
      speed: 3,
      sightRange: 7,
      cost: 1400,
      buildTime: 22,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 60,
      range: 5,
      fireRate: 1.1,
      projectileSpeed: 500,
      damageType: DamageType.BULLET,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── Spain Unique ─────────────────────────────────────────────

  conquistador_mech: {
    id: 'conquistador_mech',
    name: 'Conquistador Mech',
    category: 'vehicle',
    factionExclusive: 'spain',
    spriteKey: 'unit_conquistador_mech',
    stats: {
      maxHp: 700,
      armor: 0.4,
      speed: 2,
      sightRange: 6,
      cost: 2000,
      buildTime: 32,
      prerequisites: ['war_factory', 'tech_center'],
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

  toro_drone: {
    id: 'toro_drone',
    name: 'Toro Drone',
    category: 'aircraft',
    factionExclusive: 'spain',
    spriteKey: 'unit_toro_drone',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 6,
      sightRange: 5,
      cost: 800,
      buildTime: 14,
      prerequisites: ['airfield'],
    },
    attack: {
      damage: 40,
      range: 4,
      fireRate: 1.5,
      projectileSpeed: 700,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 1,
    },
  },

  // ── Italy Unique ─────────────────────────────────────────────

  centurion_tank: {
    id: 'centurion_tank',
    name: 'Centurion Tank',
    category: 'vehicle',
    factionExclusive: 'italy',
    spriteKey: 'unit_centurion_tank',
    stats: {
      maxHp: 650,
      armor: 0.35,
      speed: 2.5,
      sightRange: 6,
      cost: 1700,
      buildTime: 27,
      prerequisites: ['war_factory'],
    },
    attack: {
      damage: 100,
      range: 6,
      fireRate: 0.75,
      projectileSpeed: 575,
      damageType: DamageType.EXPLOSIVE,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0.5,
    },
  },

  beretta_commando: {
    id: 'beretta_commando',
    name: 'Beretta Commando',
    category: 'infantry',
    factionExclusive: 'italy',
    spriteKey: 'unit_beretta_commando',
    stats: {
      maxHp: 110,
      armor: 0,
      speed: 3,
      sightRange: 6,
      cost: 600,
      buildTime: 12,
      prerequisites: ['barracks', 'tech_center'],
    },
    attack: {
      damage: 30,
      range: 5,
      fireRate: 2.2,
      projectileSpeed: 460,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },

  // ── Korea Unique ─────────────────────────────────────────────

  black_eagle_jet: {
    id: 'black_eagle_jet',
    name: 'Black Eagle Jet',
    category: 'aircraft',
    factionExclusive: 'korea',
    spriteKey: 'unit_black_eagle_jet',
    stats: {
      maxHp: 180,
      armor: 0.1,
      speed: 11,
      sightRange: 9,
      cost: 1800,
      buildTime: 28,
      prerequisites: ['airfield', 'tech_center'],
    },
    attack: {
      damage: 85,
      range: 8,
      fireRate: 1.3,
      projectileSpeed: 850,
      damageType: DamageType.MISSILE,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0,
    },
  },

  hwarang_soldier: {
    id: 'hwarang_soldier',
    name: 'Hwarang Soldier',
    category: 'infantry',
    factionExclusive: 'korea',
    spriteKey: 'unit_hwarang_soldier',
    stats: {
      maxHp: 100,
      armor: 0,
      speed: 3,
      sightRange: 6,
      cost: 500,
      buildTime: 10,
      prerequisites: ['barracks'],
    },
    attack: {
      damage: 25,
      range: 5,
      fireRate: 2.5,
      projectileSpeed: 440,
      damageType: DamageType.BULLET,
      canAttackAir: false,
      canAttackGround: true,
      splash: 0,
    },
  },
}

// ── Helpers ──────────────────────────────────────────────────

/** All shared unit IDs (non-faction-exclusive) */
export const SHARED_UNIT_IDS = Object.keys(UNIT_DEFS).filter(
  id => UNIT_DEFS[id].factionExclusive === null
)

/** Get the unique unit IDs for a given faction */
export function getFactionUnitIds(factionId: string): string[] {
  return Object.keys(UNIT_DEFS).filter(
    id => UNIT_DEFS[id].factionExclusive === factionId
  )
}

/** All unit IDs available to a specific faction (shared + exclusive) */
export function getAvailableUnitIds(factionId: string): string[] {
  return Object.keys(UNIT_DEFS).filter(
    id => UNIT_DEFS[id].factionExclusive === null || UNIT_DEFS[id].factionExclusive === factionId
  )
}
