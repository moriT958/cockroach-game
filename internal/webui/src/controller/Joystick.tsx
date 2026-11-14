import { useRef, useState } from 'react'

const RADIUS = 70 // つまみが動ける半径 (px)
const DEADZONE = 0.12

interface Point {
  x: number
  y: number
}

interface Props {
  /** x, y は -1..1。指を離すと (0, 0)。 */
  onChange: (x: number, y: number) => void
}

/** 触った場所が中心になるバーチャルスティック。画面を見ずに操作できる。 */
export function Joystick({ onChange }: Props) {
  // 操作中の指と、その指が最初に触れた位置 (クライアント座標)。
  const active = useRef<{ pointerId: number; origin: Point } | null>(null)
  const [base, setBase] = useState<Point | null>(null) // 要素内での土台の位置
  const [knob, setKnob] = useState<Point>({ x: 0, y: 0 })

  const move = (e: React.PointerEvent, origin: Point) => {
    let dx = (e.clientX - origin.x) / RADIUS
    let dy = (e.clientY - origin.y) / RADIUS
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    setKnob({ x: dx, y: dy })
    if (len < DEADZONE) onChange(0, 0)
    else onChange(dx, dy)
  }

  const release = (e: React.PointerEvent) => {
    if (e.pointerId !== active.current?.pointerId) return
    active.current = null
    setBase(null)
    setKnob({ x: 0, y: 0 })
    onChange(0, 0)
  }

  return (
    <div
      className="relative size-full touch-none"
      onPointerDown={(e) => {
        if (active.current) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const rect = e.currentTarget.getBoundingClientRect()
        const origin = { x: e.clientX, y: e.clientY }
        active.current = { pointerId: e.pointerId, origin }
        setBase({ x: origin.x - rect.left, y: origin.y - rect.top })
        move(e, origin)
      }}
      onPointerMove={(e) => {
        if (e.pointerId === active.current?.pointerId) move(e, active.current.origin)
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div
        className={`pointer-events-none absolute -translate-1/2 rounded-full border-2 border-white/25 bg-white/5 ${base ? '' : 'top-1/2 left-1/2 opacity-60'}`}
        style={{ width: RADIUS * 2 + 60, height: RADIUS * 2 + 60, ...(base && { left: base.x, top: base.y }) }}
      >
        <div
          className="absolute top-1/2 left-1/2 size-20 rounded-full bg-white/80 shadow-lg"
          style={{ transform: `translate(calc(-50% + ${knob.x * RADIUS}px), calc(-50% + ${knob.y * RADIUS}px))` }}
        />
      </div>
      {!base && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-sm text-white/40">
          ここをスライドして移動
        </div>
      )}
    </div>
  )
}
