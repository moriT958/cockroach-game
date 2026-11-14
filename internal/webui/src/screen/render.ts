import { FOODS, WORLD, type Food, type GameState, type Player } from '@/lib/protocol'

// 画面側の描画。サーバの状態 (30Hz) を毎フレーム補間して canvas に描く。

interface Sprite {
  x: number
  y: number
  angle: number
  legPhase: number
}

interface Popup {
  x: number
  y: number
  text: string
  born: number
}

const POPUP_MS = 800
const FOOD_POP_MS = 250

export class Renderer {
  private sprites = new Map<number, Sprite>()
  private foodSeen = new Map<number, { food: Food; born: number }>()
  private popups: Popup[] = []
  private floor = drawFloor()
  private last = performance.now()

  /** 新しい状態を受け取ったときに呼ぶ。消えた餌から得点ポップアップを作る。 */
  update(state: GameState, now: number) {
    const alive = new Set(state.foods.map((f) => f.id))
    for (const [id, { food }] of this.foodSeen) {
      if (alive.has(id)) continue
      this.foodSeen.delete(id)
      if (state.phase === 'playing') {
        this.popups.push({ x: food.x, y: food.y, text: `+${FOODS[food.kind]?.points ?? 1}`, born: now })
      }
    }
    for (const f of state.foods) {
      if (!this.foodSeen.has(f.id)) this.foodSeen.set(f.id, { food: f, born: now })
    }
    const ids = new Set(state.players.map((p) => p.id))
    for (const id of this.sprites.keys()) if (!ids.has(id)) this.sprites.delete(id)
  }

  draw(ctx: CanvasRenderingContext2D, state: GameState | null, now: number) {
    const dt = Math.min((now - this.last) / 1000, 0.1)
    this.last = now

    const { width, height } = ctx.canvas
    ctx.setTransform(width / WORLD.w, 0, 0, height / WORLD.h, 0, 0)
    ctx.drawImage(this.floor, 0, 0, WORLD.w, WORLD.h)
    if (!state) return

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const { food, born } of this.foodSeen.values()) {
      const pop = Math.min((now - born) / FOOD_POP_MS, 1)
      const size = 34 * (0.4 + 0.6 * pop) + Math.sin(now / 300 + food.id) * 1.5
      ctx.font = `${size}px sans-serif`
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.beginPath()
      ctx.ellipse(food.x, food.y + 14, 14, 5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#000'
      ctx.fillText(FOODS[food.kind]?.emoji ?? '🍞', food.x, food.y)
    }

    // 補間係数: サーバ更新の間を滑らかにつなぐ。
    const k = 1 - Math.exp(-dt * 25)
    for (const p of state.players) {
      let s = this.sprites.get(p.id)
      if (!s || Math.hypot(p.x - s.x, p.y - s.y) > 300) {
        s = { x: p.x, y: p.y, angle: p.angle, legPhase: 0 }
        this.sprites.set(p.id, s)
      }
      s.x += (p.x - s.x) * k
      s.y += (p.y - s.y) * k
      s.angle += shortestAngle(s.angle, p.angle) * k
      if (p.moving) s.legPhase += dt * (p.dashing ? 55 : 30)
      drawRoach(ctx, p, s)
    }
    for (const p of state.players) {
      const s = this.sprites.get(p.id)
      if (s) drawLabel(ctx, p, s)
    }

    this.popups = this.popups.filter((p) => now - p.born < POPUP_MS)
    ctx.font = 'bold 30px sans-serif'
    ctx.lineWidth = 5
    for (const p of this.popups) {
      const t = (now - p.born) / POPUP_MS
      ctx.globalAlpha = 1 - t * t
      ctx.strokeStyle = '#1c1917'
      ctx.fillStyle = '#fde047'
      ctx.strokeText(p.text, p.x, p.y - 20 - t * 40)
      ctx.fillText(p.text, p.x, p.y - 20 - t * 40)
    }
    ctx.globalAlpha = 1
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function drawRoach(ctx: CanvasRenderingContext2D, p: Player, s: Sprite) {
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.rotate(s.angle)
  ctx.globalAlpha = p.connected ? 1 : 0.35

  // 影
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.beginPath()
  ctx.ellipse(-2, 5, 30, 17, 0, 0, Math.PI * 2)
  ctx.fill()

  // 脚 (左右 3 本ずつ、交互に振る)
  ctx.strokeStyle = '#1c0f08'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const bx = 12 - i * 12
    const swing = Math.sin(s.legPhase + i * 2.1) * 7
    for (const side of [-1, 1]) {
      const sw = swing * side
      ctx.beginPath()
      ctx.moveTo(bx, side * 10)
      ctx.lineTo(bx + (i - 1) * -5 + sw * 0.5, side * 22)
      ctx.lineTo(bx + (i - 1) * -11 + sw, side * 31)
      ctx.stroke()
    }
  }

  // 触角
  ctx.lineWidth = 1.5
  const wave = Math.sin(s.legPhase * 0.5 + p.id) * 4
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(24, side * 4)
    ctx.quadraticCurveTo(40, side * (10 + wave), 54, side * (20 + wave))
    ctx.stroke()
  }

  // 頭
  ctx.fillStyle = '#2a1509'
  ctx.beginPath()
  ctx.ellipse(22, 0, 9, 10, 0, 0, Math.PI * 2)
  ctx.fill()

  // 胴体: プレイヤー色の縁取りで見分ける
  const body = ctx.createLinearGradient(0, -15, 0, 15)
  body.addColorStop(0, '#7a4420')
  body.addColorStop(0.5, '#4a2610')
  body.addColorStop(1, '#2a1509')
  ctx.fillStyle = body
  ctx.strokeStyle = p.color
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.ellipse(-4, 0, 24, 14, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // 羽の合わせ目とツヤ
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(10, 0)
  ctx.lineTo(-27, 0)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.beginPath()
  ctx.ellipse(0, -6, 13, 3, 0, 0, Math.PI * 2)
  ctx.fill()

  // ダッシュ中のスピード線
  if (p.dashing) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 2
    for (const y of [-10, 0, 10]) {
      ctx.beginPath()
      ctx.moveTo(-36, y)
      ctx.lineTo(-56 - Math.abs(y), y)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawLabel(ctx: CanvasRenderingContext2D, p: Player, s: Sprite) {
  ctx.globalAlpha = p.connected ? 1 : 0.35
  ctx.font = 'bold 20px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'
  ctx.fillStyle = p.color
  ctx.strokeText(p.name, s.x, s.y - 44)
  ctx.fillText(p.name, s.x, s.y - 44)
  ctx.globalAlpha = 1
}

// 家の床 (キッチン・リビング・和室) を一度だけ描いて使い回す。
// 当たり判定は無いので、障害物に見えるものは置かない。
function drawFloor(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = WORLD.w
  c.height = WORLD.h
  const ctx = c.getContext('2d')!
  const kitchenW = 520
  const washitsu = { x: 1040, y: 470 }

  // リビング: フローリング
  ctx.fillStyle = '#c99a63'
  ctx.fillRect(0, 0, WORLD.w, WORLD.h)
  for (let y = 0, row = 0; y < WORLD.h; y += 50, row++) {
    ctx.fillStyle = row % 2 ? 'rgba(90,50,20,0.08)' : 'rgba(255,255,255,0.05)'
    ctx.fillRect(0, y, WORLD.w, 50)
    ctx.fillStyle = 'rgba(70,40,15,0.35)'
    ctx.fillRect(0, y, WORLD.w, 2)
    for (let x = (row % 3) * 110; x < WORLD.w; x += 330) ctx.fillRect(x, y, 2, 50)
  }

  // ラグ
  ctx.fillStyle = '#9f4a3c'
  roundRect(ctx, 640, 110, 340, 240, 24)
  ctx.fill()
  ctx.strokeStyle = '#e7c9a0'
  ctx.lineWidth = 6
  roundRect(ctx, 660, 130, 300, 200, 14)
  ctx.stroke()

  // キッチン: 市松タイル
  const tile = 65
  for (let y = 0; y < WORLD.h; y += tile) {
    for (let x = 0; x < kitchenW; x += tile) {
      ctx.fillStyle = (x / tile + y / tile) % 2 ? '#e8e2d4' : '#cfd8d3'
      ctx.fillRect(x, y, Math.min(tile, kitchenW - x), tile)
    }
  }
  ctx.fillStyle = '#6b8f71'
  roundRect(ctx, 120, 360, 280, 110, 16)
  ctx.fill()

  // 和室: 畳
  ctx.fillStyle = '#b5b878'
  ctx.fillRect(washitsu.x, washitsu.y, WORLD.w - washitsu.x, WORLD.h - washitsu.y)
  ctx.strokeStyle = '#3f4a2a'
  ctx.lineWidth = 6
  const tw = (WORLD.w - washitsu.x) / 2
  const th = (WORLD.h - washitsu.y) / 2
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.strokeRect(washitsu.x + i * tw + 3, washitsu.y + j * th + 3, tw - 6, th - 6)
    }
  }
  ctx.strokeStyle = 'rgba(80,90,40,0.18)'
  ctx.lineWidth = 1
  for (let y = washitsu.y + 8; y < WORLD.h; y += 7) {
    ctx.beginPath()
    ctx.moveTo(washitsu.x, y)
    ctx.lineTo(WORLD.w, y)
    ctx.stroke()
  }

  // 敷居
  ctx.fillStyle = '#5c3b1e'
  ctx.fillRect(kitchenW - 5, 0, 10, WORLD.h)
  ctx.fillRect(washitsu.x - 5, washitsu.y - 5, 10, WORLD.h - washitsu.y + 5)
  ctx.fillRect(washitsu.x - 5, washitsu.y - 5, WORLD.w - washitsu.x + 5, 10)

  ctx.font = 'bold 34px sans-serif'
  ctx.fillStyle = 'rgba(0,0,0,0.13)'
  ctx.fillText('キッチン', 24, 50)
  ctx.fillText('リビング', kitchenW + 28, 50)
  ctx.fillText('和室', washitsu.x + 28, washitsu.y + 54)
  return c
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
