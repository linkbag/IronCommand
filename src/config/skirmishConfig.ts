import { FACTION_IDS } from '../data/factions'
import type { AIDifficulty } from '../combat/AI'
import type { FactionId, MapTemplate } from '../types'
import { STARTING_CREDITS } from '../types'

export interface SkirmishConfig {
  playerFaction: FactionId
  mapSize: 'small' | 'medium' | 'large'
  revealMap: boolean
  mapTemplate: MapTemplate
  mapSeed: number
  playerSpawn: number
  aiCount: number
  aiDifficulty: AIDifficulty
  startingCredits: number
  allyPlayerIds: number[]
}

const VALID_MAP_SIZES: SkirmishConfig['mapSize'][] = ['small', 'medium', 'large']
const VALID_MAP_TEMPLATES: MapTemplate[] = ['continental', 'islands', 'desert', 'arctic', 'urban', 'random']
const VALID_AI_DIFFICULTIES: AIDifficulty[] = ['easy', 'medium', 'hard']
const LEGACY_DIFFICULTY_MAP: Record<string, AIDifficulty> = {
  normal: 'medium',
  expert: 'hard',
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function randomSeed(): number {
  return Math.floor(Math.random() * 99999) + 1
}

function toIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return Math.min(max, Math.max(min, rounded))
}

function toFactionId(value: unknown, fallback: FactionId): FactionId {
  if (typeof value !== 'string') return fallback
  return (FACTION_IDS as readonly string[]).includes(value) ? (value as FactionId) : fallback
}

function toMapSize(value: unknown, fallback: SkirmishConfig['mapSize']): SkirmishConfig['mapSize'] {
  if (typeof value !== 'string') return fallback
  return (VALID_MAP_SIZES as readonly string[]).includes(value)
    ? (value as SkirmishConfig['mapSize'])
    : fallback
}

function toMapTemplate(value: unknown, fallback: MapTemplate): MapTemplate {
  if (typeof value !== 'string') return fallback
  return (VALID_MAP_TEMPLATES as readonly string[]).includes(value) ? (value as MapTemplate) : fallback
}

export function normalizeAIDifficulty(value: unknown, fallback: AIDifficulty = 'medium'): AIDifficulty {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if ((VALID_AI_DIFFICULTIES as readonly string[]).includes(normalized)) {
    return normalized as AIDifficulty
  }
  return LEGACY_DIFFICULTY_MAP[normalized] ?? fallback
}

function toAllyIds(value: unknown, aiCount: number): number[] {
  if (!Array.isArray(value)) return []
  const maxAllies = Math.max(0, aiCount - 1)
  const normalized = value
    .map(v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN))
    .filter(id => Number.isInteger(id) && id >= 1 && id <= aiCount)
  return [...new Set(normalized)].sort((a, b) => a - b).slice(0, maxAllies)
}

function readDifficulty(raw: Record<string, unknown>): unknown {
  if ('aiDifficulty' in raw) return raw.aiDifficulty
  if ('difficulty' in raw) return raw.difficulty
  return undefined
}

export function createDefaultSkirmishConfig(): SkirmishConfig {
  return {
    playerFaction: 'usa',
    mapSize: 'medium',
    revealMap: false,
    mapTemplate: 'continental',
    mapSeed: randomSeed(),
    playerSpawn: -1,
    aiCount: 1,
    aiDifficulty: 'medium',
    startingCredits: STARTING_CREDITS,
    allyPlayerIds: [],
  }
}

export function migrateSkirmishConfig(rawConfig: unknown): SkirmishConfig {
  const defaults = createDefaultSkirmishConfig()
  const raw = toRecord(rawConfig)
  if (!raw) return defaults

  const aiCount = toIntInRange(raw.aiCount, defaults.aiCount, 1, 3)
  const nextConfig: SkirmishConfig = {
    playerFaction: toFactionId(raw.playerFaction, defaults.playerFaction),
    mapSize: toMapSize(raw.mapSize, defaults.mapSize),
    revealMap: typeof raw.revealMap === 'boolean' ? raw.revealMap : defaults.revealMap,
    mapTemplate: toMapTemplate(raw.mapTemplate, defaults.mapTemplate),
    mapSeed: toIntInRange(raw.mapSeed, defaults.mapSeed, 1, 99999),
    playerSpawn: toIntInRange(raw.playerSpawn, defaults.playerSpawn, -1, 7),
    aiCount,
    aiDifficulty: normalizeAIDifficulty(readDifficulty(raw), defaults.aiDifficulty),
    startingCredits: toIntInRange(raw.startingCredits, defaults.startingCredits, 1000, 100000),
    allyPlayerIds: toAllyIds(raw.allyPlayerIds, aiCount),
  }

  return nextConfig
}

export function getBehaviorAIDifficulty(selectedDifficulty: AIDifficulty): AIDifficulty {
  return selectedDifficulty === 'medium' ? 'hard' : selectedDifficulty
}
