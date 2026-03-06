// ============================================================
// IRON COMMAND — Faction Definitions (RA2-Style Two-Bloc System)
// Iron Alliance (Allied) vs Red Collective (Soviet)
// Each country has ONE special unit/ability per RA2 multiplayer
// ============================================================

import type { FactionDef, FactionId, FactionSide } from '../types'

export const FACTIONS: Record<FactionId, FactionDef> = {

  // ════════════════════════════════════════════════════════════
  // IRON ALLIANCE (Allied equivalent)
  // ════════════════════════════════════════════════════════════

  usa: {
    id: 'usa',
    name: 'United States',
    side: 'alliance',
    color: 0x3366ff,
    colorStr: '#3366ff',
    flag: '🇺🇸',
    bonus: 'Paratroopers (free paradrop every 4 min with Airfield)',
    superweapon: 'Weather Control Device',
    uniqueUnits: ['Paratroopers'],
  },
  france: {
    id: 'france',
    name: 'France',
    side: 'alliance',
    color: 0x4488ff,
    colorStr: '#4488ff',
    flag: '🇫🇷',
    bonus: 'Grand Cannon (powerful base defense structure)',
    superweapon: 'Weather Control Device',
    uniqueUnits: ['Grand Cannon'],
  },
  germany: {
    id: 'germany',
    name: 'Germany',
    side: 'alliance',
    color: 0x444444,
    colorStr: '#444444',
    flag: '🇩🇪',
    bonus: 'Tank Destroyer (anti-armor vehicle, weak vs infantry)',
    superweapon: 'Weather Control Device',
    uniqueUnits: ['Tank Destroyer'],
  },
  uk: {
    id: 'uk',
    name: 'United Kingdom',
    side: 'alliance',
    color: 0x0044aa,
    colorStr: '#0044aa',
    flag: '🇬🇧',
    bonus: 'Sniper (long-range infantry killer)',
    superweapon: 'Weather Control Device',
    uniqueUnits: ['Sniper'],
  },
  korea: {
    id: 'korea',
    name: 'Korea',
    side: 'alliance',
    color: 0x6644cc,
    colorStr: '#6644cc',
    flag: '🇰🇷',
    bonus: 'Black Eagle (enhanced fighter jet)',
    superweapon: 'Weather Control Device',
    uniqueUnits: ['Black Eagle'],
  },
  japan: {
    id: 'japan',
    name: 'Japan',
    side: 'alliance',
    color: 0xff4466,
    colorStr: '#ff4466',
    flag: '🇯🇵',
    bonus: 'Mecha Walker (versatile all-terrain unit)',
    superweapon: 'Weather Control Device',
    uniqueUnits: ['Mecha Walker'],
  },
  italy: {
    id: 'italy',
    name: 'Italy',
    side: 'alliance',
    color: 0x00aa00,
    colorStr: '#00aa00',
    flag: '🇮🇹',
    bonus: 'Prism Tank (beam weapon, chains to nearby enemies)',
    superweapon: 'Weather Control Device',
    uniqueUnits: ['Prism Tank'],
  },
  south_africa: {
    id: 'south_africa',
    name: 'South Africa',
    side: 'alliance',
    color: 0x00aa88,
    colorStr: '#00aa88',
    flag: '🇿🇦',
    bonus: 'Recon Drone (reveals large map area)',
    superweapon: 'Weather Control Device',
    uniqueUnits: ['Recon Drone'],
  },

  // ════════════════════════════════════════════════════════════
  // RED COLLECTIVE (Soviet equivalent)
  // ════════════════════════════════════════════════════════════

  russia: {
    id: 'russia',
    name: 'Russia',
    side: 'collective',
    color: 0x884422,
    colorStr: '#884422',
    flag: '🇷🇺',
    bonus: 'Tesla Tank (electrical charge, effective vs all)',
    superweapon: 'Nuclear Missile Silo',
    uniqueUnits: ['Tesla Tank'],
  },
  china: {
    id: 'china',
    name: 'China',
    side: 'collective',
    color: 0xcc0000,
    colorStr: '#cc0000',
    flag: '🇨🇳',
    bonus: 'Dragon Tank (area denial flamethrower)',
    superweapon: 'Nuclear Missile Silo',
    uniqueUnits: ['Dragon Tank'],
  },
  iran: {
    id: 'iran',
    name: 'Iran',
    side: 'collective',
    color: 0x00aa44,
    colorStr: '#00aa44',
    flag: '🇮🇷',
    bonus: 'Desolator (irradiates ground, area denial infantry)',
    superweapon: 'Nuclear Missile Silo',
    uniqueUnits: ['Desolator'],
  },
  iraq: {
    id: 'iraq',
    name: 'Iraq',
    side: 'collective',
    color: 0x886600,
    colorStr: '#886600',
    flag: '🇮🇶',
    bonus: 'Demolition Truck (suicide vehicle, nuclear charge)',
    superweapon: 'Nuclear Missile Silo',
    uniqueUnits: ['Demolition Truck'],
  },
  mexico: {
    id: 'mexico',
    name: 'Mexico',
    side: 'collective',
    color: 0x008844,
    colorStr: '#008844',
    flag: '🇲🇽',
    bonus: 'Terrorist (suicide infantry with C4)',
    superweapon: 'Nuclear Missile Silo',
    uniqueUnits: ['Terrorist'],
  },
  india: {
    id: 'india',
    name: 'India',
    side: 'collective',
    color: 0xff8800,
    colorStr: '#ff8800',
    flag: '🇮🇳',
    bonus: 'Brahmos Battery (long-range rocket launcher like V3)',
    superweapon: 'Nuclear Missile Silo',
    uniqueUnits: ['Brahmos Battery'],
  },
  spain: {
    id: 'spain',
    name: 'Spain',
    side: 'collective',
    color: 0xcc6600,
    colorStr: '#cc6600',
    flag: '🇪🇸',
    bonus: 'Conquistador Mech (heavy assault walker)',
    superweapon: 'Nuclear Missile Silo',
    uniqueUnits: ['Conquistador Mech'],
  },
}

export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[]

/** Get the faction side for a given faction ID */
export function getFactionSide(factionId: FactionId): FactionSide {
  return FACTIONS[factionId].side
}

/** Get all faction IDs for a given side */
export function getFactionIdsBySide(side: FactionSide): FactionId[] {
  return FACTION_IDS.filter(id => FACTIONS[id].side === side)
}
