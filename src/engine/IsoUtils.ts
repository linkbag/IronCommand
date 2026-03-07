// ============================================================
// IRON COMMAND — Isometric Coordinate Utilities
// Core transform functions for 2.5D isometric projection (RA2-style)
// All game logic stays in Cartesian; transforms happen at render/input boundary.
// ============================================================

import Phaser from 'phaser'
import { TILE_SIZE } from '../types'

// Isometric tile dimensions (2:1 ratio like RA2)
export const ISO_TILE_W = 64   // diamond width
export const ISO_TILE_H = 32   // diamond height

// ── Tile ↔ Screen conversions ──────────────────────────────────

/** Convert tile grid position (col, row) to isometric screen position */
export function tileToScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * (ISO_TILE_W / 2),
    y: (col + row) * (ISO_TILE_H / 2),
  }
}

/** Convert isometric screen position back to fractional tile coordinates */
export function screenToTile(screenX: number, screenY: number): { col: number; row: number } {
  return {
    col: (screenX / (ISO_TILE_W / 2) + screenY / (ISO_TILE_H / 2)) / 2,
    row: (screenY / (ISO_TILE_H / 2) - screenX / (ISO_TILE_W / 2)) / 2,
  }
}

// ── Cartesian ↔ Isometric conversions ──────────────────────────

/** Convert Cartesian world position (pixels) to isometric screen position */
export function cartToIso(cartX: number, cartY: number): { x: number; y: number } {
  const col = cartX / TILE_SIZE
  const row = cartY / TILE_SIZE
  return tileToScreen(col, row)
}

/** Convert isometric screen position to Cartesian world position (pixels) */
export function isoToCart(isoX: number, isoY: number): { x: number; y: number } {
  const { col, row } = screenToTile(isoX, isoY)
  return { x: col * TILE_SIZE, y: row * TILE_SIZE }
}

// ── Drawing helpers ────────────────────────────────────────────

/** Draw an isometric diamond path on a Phaser Graphics object */
export function drawIsoDiamond(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number = ISO_TILE_W,
  h: number = ISO_TILE_H,
): void {
  g.beginPath()
  g.moveTo(x + w / 2, y)         // top
  g.lineTo(x + w, y + h / 2)     // right
  g.lineTo(x + w / 2, y + h)     // bottom
  g.lineTo(x, y + h / 2)         // left
  g.closePath()
}

// ── Map bounds ─────────────────────────────────────────────────

/** Get isometric world bounds for a map of given tile dimensions */
export function getIsoWorldBounds(mapCols: number, mapRows: number): {
  width: number
  height: number
  offsetX: number
} {
  // The isometric map extends diagonally
  const width = (mapCols + mapRows) * (ISO_TILE_W / 2)
  const height = (mapCols + mapRows) * (ISO_TILE_H / 2)
  // Offset needed because row 0 starts at the right side
  const offsetX = mapRows * (ISO_TILE_W / 2)
  return { width, height, offsetX }
}
