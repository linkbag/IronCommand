import type { FactionId, MapTemplate, TeamId, StartDistanceMode } from '../types'
import { STARTING_CREDITS } from '../types'

export type MapVisibility = 'fog' | 'allVisible'

export const DEFAULT_SLOT_TEAMS: TeamId[] = ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D']
export const MAX_PLAYER_SLOTS = 8

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
  aiDifficulty: 'easy' | 'medium' | 'hard' | 'smart_hard'
  startingCredits: number
  allyPlayerIds: number[]       // AI player IDs allied with human player (player 0)
  playerTeams?: TeamId[]        // team assignment per slot (0..7); if provided, overrides allyPlayerIds
  startDistanceMode?: StartDistanceMode  // spawn distance mode; defaults to 'long_range'
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
    startDistanceMode: 'long_range',
  }
}

export function isMapRevealEnabled(config: Pick<SkirmishConfig, 'mapVisibility' | 'revealMap'>): boolean {
  return config.mapVisibility === 'allVisible' || config.revealMap === true
}

/** Derive allied player ID pairs from playerTeams config.
 *  Players on the same team are allies. Returned as [playerA, playerB] pairs.
 */
export function deriveAlliancesFromTeams(
  playerTeams: TeamId[],
  playerIds: number[],
): Array<[number, number]> {
  const teamToPlayers = new Map<TeamId, number[]>()
  for (let i = 0; i < playerIds.length; i++) {
    const team = playerTeams[i]
    if (!team) continue
    const list = teamToPlayers.get(team) ?? []
    list.push(playerIds[i])
    teamToPlayers.set(team, list)
  }
  const pairs: Array<[number, number]> = []
  for (const members of teamToPlayers.values()) {
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        pairs.push([members[a], members[b]])
      }
    }
  }
  return pairs
}
