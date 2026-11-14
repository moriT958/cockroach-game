// サーバ (internal/game, internal/server) とやり取りする JSON の型。

export type Phase = 'lobby' | 'playing' | 'result'

export interface Player {
  id: number
  name: string
  color: string
  x: number
  y: number
  angle: number
  score: number
  stamina: number
  dashing: boolean
  moving: boolean
  connected: boolean
}

export interface Food {
  id: number
  x: number
  y: number
  kind: string
}

export interface GameState {
  type: 'state'
  phase: Phase
  timeLeft: number
  players: Player[]
  foods: Food[]
}

export interface Status {
  type: 'status'
  phase: Phase
  timeLeft: number
  rank: number
  total: number
  me: Player
}

// internal/game の WorldW / WorldH と揃える。
export const WORLD = { w: 1600, h: 900 }

// internal/game の FoodKinds と揃える。
export const FOODS: Record<string, { emoji: string; label: string; points: number }> = {
  crumb: { emoji: '🍞', label: 'パンくず', points: 1 },
  rice: { emoji: '🍙', label: 'ごはん', points: 2 },
  chip: { emoji: '🍟', label: 'ポテト', points: 3 },
  cookie: { emoji: '🍪', label: 'クッキー', points: 5 },
  cake: { emoji: '🍰', label: 'ケーキ', points: 10 },
}

export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${path}`
}

export function formatTime(sec: number): string {
  const s = Math.ceil(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
