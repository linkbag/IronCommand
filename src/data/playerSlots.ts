export const PLAYER_SLOT_COLORS = [
  0x4488ff, // Slot 1: Human/default blue
  0xff4444, // Slot 2
  0xff8800, // Slot 3
  0xaa44ff, // Slot 4
  0x44cc44, // Slot 5
  0xffdd00, // Slot 6
  0x44dddd, // Slot 7
  0xff66aa, // Slot 8
] as const

export const MAX_TOTAL_PLAYERS = PLAYER_SLOT_COLORS.length
export const MAX_AI_PLAYERS = MAX_TOTAL_PLAYERS - 1

export function getPlayerSlotColor(playerId: number): number {
  if (!Number.isFinite(playerId) || playerId < 0) return PLAYER_SLOT_COLORS[0]
  return PLAYER_SLOT_COLORS[playerId % PLAYER_SLOT_COLORS.length]
}

export function playerColorToCss(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, '0')}`
}
