import type { FactionId, MapTemplate } from '../types'
import { STARTING_CREDITS } from '../types'

export type MapVisibility = 'fog' | 'allVisible'

export interface SkirmishConfig {
  playerFaction: FactionId
  mapSize: 'small' | 'medium' | 'large'
  mapVisibility: MapVisibility
  // Legacy compatibility for older config payloads.
  revealMap?: boolean
  mapTemplate: MapTemplate
  mapSeed: number
  playerSpawn: number           // -1 = random, 0-7 = specific spawn index
  aiCount: number
  aiDifficulty: 'easy' | 'medium' | 'hard'
  startingCredits: number
  allyPlayerIds: number[] // AI player IDs allied with human player (player 0)
}

export const MAP_VISIBILITY_OPTIONS: Array<{ label: string; value: MapVisibility }> = [
  { label: 'FOG OF WAR', value: 'fog' },
  { label: 'REVEALED', value: 'allVisible' },
]

export function createDefaultSkirmishConfig(): SkirmishConfig {
  return {
    playerFaction: 'usa',
    mapSize: 'medium',
    mapVisibility: 'fog',
    mapTemplate: 'continental',
    mapSeed: Math.floor(Math.random() * 99999) + 1,
    playerSpawn: -1,
    aiCount: 1,
    aiDifficulty: 'medium',
    startingCredits: STARTING_CREDITS,
    allyPlayerIds: [],
  }
}

export function isMapRevealEnabled(config: Pick<SkirmishConfig, 'mapVisibility' | 'revealMap'>): boolean {
  return config.mapVisibility === 'allVisible' || config.revealMap === true
}
