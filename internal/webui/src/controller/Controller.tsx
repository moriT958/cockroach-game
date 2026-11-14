import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Joystick } from '@/controller/Joystick'
import { formatTime, wsUrl, type Status } from '@/lib/protocol'
import { useSocket } from '@/lib/useSocket'

const NAME_KEY = 'roach.name'
const TOKEN_KEY = 'roach.token'
const SEND_HZ = 30

/** 再接続しても同じゴキブリに戻れるよう、端末ごとの合言葉を覚えておく。 */
function loadToken(): string {
  let token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    // crypto.randomUUID は http (LAN の IP 直打ち) では使えないので getRandomValues を使う。
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(TOKEN_KEY, token)
  }
  return token
}

/** スマホのコントローラー。 */
export function Controller() {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [joined, setJoined] = useState(false)

  if (!joined) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">🪳 ゴキブリゲーム</CardTitle>
            <CardDescription>名前を入れて参加しよう</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                localStorage.setItem(NAME_KEY, name.trim())
                setJoined(true)
              }}
            >
              <Input
                autoFocus
                value={name}
                maxLength={12}
                placeholder="なまえ (12文字まで)"
                className="h-12 text-lg"
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" size="lg" className="h-12 w-full text-lg">
                参加する
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }
  return <Pad name={name.trim()} onLeave={() => setJoined(false)} />
}

function Pad({ name, onLeave }: { name: string; onLeave: () => void }) {
  const [url] = useState(
    () => wsUrl(`/ws/play?token=${encodeURIComponent(loadToken())}&name=${encodeURIComponent(name)}`),
  )
  const [status, setStatus] = useState<Status | null>(null)
  const lastScore = useRef(0)

  const { connected, fatal, send } = useSocket<Status>(url, (msg) => {
    if (msg.type !== 'status') return
    // 食べた手応えを振動で返す (対応端末のみ)。
    if (msg.me.score > lastScore.current) navigator.vibrate?.(25)
    lastScore.current = msg.me.score
    setStatus(msg)
  })

  // 入力は変化があったときだけ、最大 SEND_HZ で送る。
  const input = useRef({ x: 0, y: 0, dash: false, dirty: false })
  const [dashHeld, setDashHeld] = useState(false)
  const setStick = useCallback((x: number, y: number) => {
    Object.assign(input.current, { x, y, dirty: true })
  }, [])
  const setDash = useCallback((dash: boolean) => {
    Object.assign(input.current, { dash, dirty: true })
    setDashHeld(dash)
  }, [])

  useEffect(() => {
    if (!connected) return
    input.current.dirty = true // つなぎ直したら今の入力を送り直す
    const timer = window.setInterval(() => {
      const { x, y, dash, dirty } = input.current
      if (!dirty) return
      input.current.dirty = false
      send({ type: 'input', x, y, dash })
    }, 1000 / SEND_HZ)
    return () => window.clearInterval(timer)
  }, [connected, send])

  // PC のブラウザで試すとき用: 矢印 / WASD で移動、スペースでダッシュ。
  useEffect(() => {
    const held = new Set<string>()
    const apply = () => {
      const x = Number(held.has('ArrowRight') || held.has('d')) - Number(held.has('ArrowLeft') || held.has('a'))
      const y = Number(held.has('ArrowDown') || held.has('s')) - Number(held.has('ArrowUp') || held.has('w'))
      setStick(x, y)
      setDash(held.has(' '))
    }
    const down = (e: KeyboardEvent) => {
      held.add(e.key)
      apply()
    }
    const up = (e: KeyboardEvent) => {
      held.delete(e.key)
      apply()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [setStick, setDash])

  if (fatal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-lg">{fatal}</p>
        <Button size="lg" onClick={onLeave}>
          もどる
        </Button>
      </div>
    )
  }

  const me = status?.me
  const color = me?.color ?? '#888'
  const stamina = me?.stamina ?? 1

  return (
    <div
      className="flex h-full touch-none flex-col bg-neutral-950 text-white select-none"
      style={{ WebkitTouchCallout: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="flex items-center gap-3 border-b-4 px-4 py-3" style={{ borderColor: color }}>
        <span className="size-5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate text-lg font-semibold">{me?.name ?? name}</span>
        {status?.phase === 'playing' && <span className="text-white/60 tabular-nums">{formatTime(status.timeLeft)}</span>}
        <span className="text-3xl font-black tabular-nums">{me?.score ?? 0}</span>
        {status && status.phase !== 'lobby' && (
          <span className="text-sm text-white/60 tabular-nums">
            {status.rank}位/{status.total}人
          </span>
        )}
      </header>

      <div className="px-4 py-2 text-center text-sm text-white/70">
        {!connected
          ? '接続中…'
          : status?.phase === 'playing'
            ? '食べ物をたくさん食べよう！'
            : status?.phase === 'result'
              ? `おしまい！ ${status.rank}位 (${me?.score ?? 0}点)`
              : '開始を待っています… (今のうちに練習できます)'}
      </div>

      <div className="flex min-h-0 flex-1 flex-col landscape:flex-row">
        <div className="min-h-0 min-w-0 flex-[3]">
          <Joystick onChange={setStick} />
        </div>
        <div className="flex flex-[2] flex-col items-center justify-center gap-3 p-4">
          <button
            type="button"
            className={`size-36 touch-none rounded-full border-4 text-2xl font-black transition-transform ${dashHeld ? 'scale-95 brightness-125' : ''}`}
            style={{ borderColor: color, background: `color-mix(in srgb, ${color} 35%, transparent)` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDash(true)
            }}
            onPointerUp={() => setDash(false)}
            onPointerCancel={() => setDash(false)}
          >
            ダッシュ
          </button>
          <div className="h-3 w-36 overflow-hidden rounded-full bg-white/15" aria-label="スタミナ">
            <div className="h-full rounded-full" style={{ width: `${stamina * 100}%`, background: color }} />
          </div>
        </div>
      </div>
    </div>
  )
}
