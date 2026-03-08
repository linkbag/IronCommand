// ============================================================
// IRON COMMAND — Shared Type Definitions
// All agents must use these types. Do not duplicate.
// ============================================================

// ── Coordinates & Grid ────────────────────────────────────────

export interface Position {
  x: number
  y: number
}

export interface TileCoord {
  col: number
  row: number
}

// ── Factions ──────────────────────────────────────────────────

export type FactionId =
  | 'china' | 'japan' | 'usa' | 'russia' | 'iran'
  | 'mexico' | 'france' | 'uk' | 'germany' | 'india'
  | 'iraq' | 'south_africa' | 'spain' | 'italy' | 'korea'

export type FactionSide = 'alliance' | 'collective'
export type TeamId = 'A' | 'B' | 'C' | 'D'

export interface FactionDef {
  id: FactionId
  name: string
  side: FactionSide       // Iron Alliance or Red Collective
  color: number          // hex color for units/buildings
  colorStr: string       // CSS color string
  flag: string           // emoji flag
  bonus: string          // faction bonus description
  superweapon: string    // superweapon name
  uniqueUnits: string[]  // names of faction-unique units (one per country)
}

// ── Terrain ───────────────────────────────────────────────────

export enum TerrainType {
  GRASS = 0,
  WATER = 1,
  ORE = 2,
  ROCK = 3,
  SAND = 4,
  ROAD = 5,
  BRIDGE = 6,
  FOREST = 7,
  GEMS = 8,
}

export interface TileData {
  terrain: TerrainType
  height: 0 | 1 | 2      // visual elevation only (0=low, 1=normal, 2=high)
  passable: boolean
  buildable: boolean
  oreAmount: number       // 0-2000 total ore value (0 = depleted)
  fogState: FogState
  occupiedBy: string | null  // entity ID
}

export enum FogState {
  HIDDEN = 0,
  EXPLORED = 1,
  VISIBLE = 2,
}

export interface GameMap {
  name: string
  width: number           // in tiles
  height: number          // in tiles
  tileSize: number        // pixels per tile (32)
  tiles: TileData[][]
  startPositions: Position[]  // per-player spawn points
}

// ── Entities (Units & Buildings) ──────────────────────────────

export type EntityType = 'unit' | 'building'
export type UnitCategory = 'infantry' | 'vehicle' | 'aircraft' | 'naval' | 'harvester'
export type BuildingCategory = 'base' | 'power' | 'production' | 'defense' | 'tech' | 'superweapon'

export interface EntityStats {
  maxHp: number
  armor: number           // damage reduction (0-1)
  speed: number           // tiles per second (0 for buildings)
  sightRange: number      // tiles
  cost: number            // credits
  buildTime: number       // seconds
  prerequisites: string[] // building IDs required
}

export interface AttackStats {
  damage: number
  range: number           // tiles
  fireRate: number        // attacks per second
  projectileSpeed: number // pixels per second (0 = hitscan)
  damageType: DamageType
  canAttackAir: boolean
  canAttackGround: boolean
  splash: number          // splash radius in tiles (0 = none)
}

export enum DamageType {
  BULLET = 'bullet',
  EXPLOSIVE = 'explosive',
  HE = 'he',
  AP = 'ap',
  FIRE = 'fire',
  ELECTRIC = 'electric',
  RADIATION = 'radiation',
  MISSILE = 'missile',
}

export enum ArmorType {
  NONE = 'none',
  LIGHT = 'light',
  MEDIUM = 'medium',
  HEAVY = 'heavy',
  WOOD = 'wood',
  STEEL = 'steel',
  CONCRETE = 'concrete',
}

export interface UnitDef {
  id: string
  name: string
  category: UnitCategory
  armorType?: ArmorType
  side: FactionSide | null    // null = available to both sides (e.g. Engineer, MCV)
  stats: EntityStats
  attack: AttackStats | null  // null = non-combat (e.g. harvester)
  factionExclusive: FactionId | null  // null = available to all of that side
  spriteKey: string
}

export interface BuildingDef {
  id: string
  name: string
  category: BuildingCategory
  armorType?: ArmorType
  side: FactionSide | null    // null = available to both sides
  stats: EntityStats
  attack: AttackStats | null  // null = non-defensive
  footprint: { w: number; h: number }  // in tiles
  produces: string[]          // unit/building IDs this can produce
  providespower: number       // power generated (negative = consumes)
  factionExclusive: FactionId | null
  spriteKey: string
}

// ── Game State ────────────────────────────────────────────────

export interface Player {
  id: number
  name: string
  faction: FactionId
  teamId: TeamId
  color: number
  credits: number
  power: number           // current power balance
  powerGenerated: number
  powerConsumed: number
  isAI: boolean
  isDefeated: boolean
  entities: string[]      // entity IDs owned
  buildQueue: BuildQueueItem[]
}

export interface BuildQueueItem {
  defId: string           // unit or building def ID
  progress: number        // 0-1
  producerId: string      // building entity ID producing this
}

export type GamePhase = 'menu' | 'setup' | 'playing' | 'paused' | 'victory' | 'defeat'

export interface GameState {
  phase: GamePhase
  tick: number
  players: Player[]
  localPlayerId: number
  selectedEntityIds: string[]
  map: GameMap
}

// ── Orders & Commands ─────────────────────────────────────────

export type OrderType = 'move' | 'attack' | 'attackMove' | 'guard' | 'patrol' | 'harvest' | 'build' | 'repair' | 'stop'

export interface Order {
  type: OrderType
  target?: Position
  targetEntityId?: string
  buildingDefId?: string  // for build orders
}

// ── Events ────────────────────────────────────────────────────

export type GameEvent =
  | { type: 'unit_created'; entityId: string; playerId: number }
  | { type: 'unit_destroyed'; entityId: string; playerId: number; killedBy: number }
  | { type: 'building_placed'; entityId: string; playerId: number }
  | { type: 'building_destroyed'; entityId: string; playerId: number }
  | { type: 'credits_changed'; playerId: number; amount: number }
  | { type: 'superweapon_ready'; playerId: number; weapon: string }
  | { type: 'player_defeated'; playerId: number }
  | { type: 'game_over'; winnerId: number }

// ── Config ────────────────────────────────────────────────────

export const TILE_SIZE = 32
export const ISO_TILE_W = 64   // isometric diamond width (2:1 ratio)
export const ISO_TILE_H = 32   // isometric diamond height
export const MAP_DEFAULT_WIDTH = 128
export const MAP_DEFAULT_HEIGHT = 128
export const STARTING_CREDITS = 10000
export const ORE_PER_LOAD = 25
export const GEMS_PER_LOAD = 50
export const HARVESTER_CAPACITY = 20
export const REFINERY_PROCESS_RATE = 1 // loads/sec
export const POWER_LOW_THRESHOLD = 0.5  // build/production slows below this

// ── Ore system constants ─────────────────────────────────────
export const ORE_TILE_MAX = 2000        // max ore amount per tile
export const GEMS_TILE_MAX = 3000       // max gems amount per tile
export const ORE_HARVEST_VALUE = ORE_PER_LOAD
export const GEMS_HARVEST_VALUE = GEMS_PER_LOAD
export const ORE_HARVEST_RATE = 100     // ore units extracted per load
export const ORE_REGEN_RATE = 10        // ore units regenerated per tick (10% of mining speed)
export const NEUTRAL_PLAYER_ID = -1     // neutral/capturable buildings

export type MapTemplate = 'continental' | 'islands' | 'desert' | 'arctic' | 'urban' | 'random'
