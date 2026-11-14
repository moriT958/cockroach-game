import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FOODS, WORLD, formatTime, wsUrl, type GameState, type Phase, type Player } from '@/lib/protocol'
import { useSocket } from '@/lib/useSocket'
import { Renderer } from '@/screen/render'

/** サイドバーに必要な分だけを取り出す。値が変わったときだけ React を再描画する。 */
interface Hud {
  phase: Phase
  seconds: number
  players: Pick<Player, 'id' | 'name' | 'color' | 'score' | 'connected'>[]
}

function toHud(s: GameState): Hud {
  return {
    phase: s.phase,
    seconds: Math.ceil(s.timeLeft),
    players: s.players
      .map(({ id, name, color, score, connected }) => ({ id, name, color, score, connected }))
      .sort((a, b) => b.score - a.score || a.id - b.id),
  }
}

/** PC に映す共有画面。 */
export function Screen() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<GameState | null>(null)
  const renderer = useMemo(() => new Renderer(), [])
  const [hud, setHud] = useState<Hud>({ phase: 'lobby', seconds: 0, players: [] })
  const hudKey = useRef('')
  const [joinUrl, setJoinUrl] = useState('')

  const { connected, send } = useSocket<GameState>(wsUrl('/ws/screen'), (msg) => {
    if (msg.type !== 'state') return
    stateRef.current = msg
    renderer.update(msg, performance.now())
    const next = toHud(msg)
    const key = JSON.stringify(next)
    if (key !== hudKey.current) {
      hudKey.current = key
      setHud(next)
    }
  })

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then((info: { joinUrl: string }) => setJoinUrl(info.joinUrl))
      .catch(() => setJoinUrl(`${window.location.origin}/play`))
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    const frame = (now: number) => {
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(canvas.clientWidth * scale)
      const h = Math.round(canvas.clientHeight * scale)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      renderer.draw(ctx, stateRef.current, now)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [renderer])

  const { phase, players } = hud
  const hurry = phase === 'playing' && hud.seconds <= 10

  return (
    <div className="flex h-full gap-4 bg-background p-4 text-foreground">
      <main className="relative flex min-w-0 flex-1 items-center justify-center">
        <div
          className="relative max-h-full w-full overflow-hidden rounded-xl ring-1 ring-border"
          style={{ aspectRatio: `${WORLD.w} / ${WORLD.h}`, maxWidth: `calc((100vh - 2rem) * ${WORLD.w / WORLD.h})` }}
        >
          <canvas ref={canvasRef} className="block size-full" />

          {phase === 'lobby' && (
            <Overlay>
              <h1 className="text-6xl font-black tracking-tight">🪳 ゴキブリゲーム</h1>
              <p className="text-xl text-white/80">
                家に落ちている食べ物をたくさん食べたゴキブリの勝ち。スマホがコントローラーになります。
              </p>
              <JoinCode url={joinUrl} size={220} />
              <StartButton players={players.length} onClick={() => send({ type: 'start' })}>
                ゲーム開始
              </StartButton>
            </Overlay>
          )}

          {phase === 'result' && (
            <Overlay>
              <h1 className="text-5xl font-black">結果発表</h1>
              <ol className="w-full max-w-md space-y-2">
                {players.slice(0, 5).map((p, i) => (
                  <li
                    key={p.id}
                    className={`flex items-center gap-3 rounded-lg bg-white/10 px-4 py-2 ${i === 0 ? 'text-3xl font-bold ring-2 ring-yellow-400' : 'text-xl'}`}
                  >
                    <span className="w-10 text-center">{['🥇', '🥈', '🥉'][i] ?? i + 1}</span>
                    <span className="size-4 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
                    <span className="tabular-nums">{p.score}</span>
                  </li>
                ))}
              </ol>
              <div className="flex gap-3">
                <StartButton players={players.length} onClick={() => send({ type: 'start' })}>
                  もう一度
                </StartButton>
                <Button size="lg" variant="secondary" className="h-14 px-8 text-xl" onClick={() => send({ type: 'reset' })}>
                  ロビーへ
                </Button>
              </div>
            </Overlay>
          )}

          {hurry && (
            <div className="pointer-events-none absolute inset-x-0 top-6 text-center text-8xl font-black text-red-500 tabular-nums drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">
              {hud.seconds}
            </div>
          )}
        </div>
      </main>

      <aside className="flex w-72 shrink-0 flex-col gap-4">
        <Card>
          <CardContent className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">のこり時間</div>
              <div className={`text-5xl font-bold tabular-nums ${hurry ? 'text-red-500' : ''}`}>
                {phase === 'playing' ? formatTime(hud.seconds) : '-:--'}
              </div>
            </div>
            <Badge variant={connected ? 'secondary' : 'destructive'}>{connected ? '接続中' : '切断'}</Badge>
          </CardContent>
        </Card>

        <Card className="min-h-0 flex-1">
          <CardHeader>
            <CardTitle>ランキング ({players.length}人)</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 overflow-y-auto">
            {players.length === 0 && <p className="text-sm text-muted-foreground">参加者を待っています…</p>}
            <ol className="space-y-1.5">
              {players.map((p, i) => (
                <li key={p.id} className={`flex items-center gap-2 text-lg ${p.connected ? '' : 'opacity-40'}`}>
                  <span className="w-5 text-right text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="font-semibold tabular-nums">{p.score}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {Object.values(FOODS).map((f) => (
                <span key={f.label} title={f.label}>
                  {f.emoji} <span className="text-muted-foreground tabular-nums">+{f.points}</span>
                </span>
              ))}
            </div>
            {phase !== 'lobby' && <JoinCode url={joinUrl} size={112} compact />}
            {phase === 'playing' && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => send({ type: 'reset' })}>
                中断してロビーへ
              </Button>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/70 p-8 text-center text-white backdrop-blur-sm">
      {children}
    </div>
  )
}

function StartButton({ players, onClick, children }: { players: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="lg" className="h-14 px-10 text-xl" disabled={players === 0} onClick={onClick}>
      {players === 0 ? '参加者を待っています…' : children}
    </Button>
  )
}

function JoinCode({ url, size, compact }: { url: string; size: number; compact?: boolean }) {
  if (!url) return null
  return (
    <div className={`flex items-center gap-4 ${compact ? '' : 'flex-col'}`}>
      <div className="shrink-0 rounded-lg bg-white p-2">
        <QRCodeSVG value={url} size={size} />
      </div>
      <div className={compact ? 'min-w-0 text-xs break-all text-muted-foreground' : 'font-mono text-2xl'}>{url}</div>
    </div>
  )
}
