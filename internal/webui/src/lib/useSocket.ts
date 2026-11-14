import { useCallback, useEffect, useRef, useState } from 'react'

// サーバが「再接続しても無駄」と伝えるときの close code。
const CLOSE_REPLACED = 1008
const CLOSE_FULL = 1013

export interface Socket {
  connected: boolean
  /** 再接続しない理由で閉じられたときのメッセージ。 */
  fatal: string | null
  send: (msg: unknown) => void
}

/** 切れたら自動でつなぎ直す JSON WebSocket。url が null の間は接続しない。 */
export function useSocket<T>(url: string | null, onMessage: (msg: T) => void): Socket {
  const [connected, setConnected] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const handlerRef = useRef(onMessage)
  useEffect(() => {
    handlerRef.current = onMessage
  })

  useEffect(() => {
    if (!url) return
    let closed = false
    let retry: number | undefined

    const connect = () => {
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => {
        setFatal(null)
        setConnected(true)
      }
      ws.onmessage = (e) => handlerRef.current(JSON.parse(e.data) as T)
      ws.onclose = (e) => {
        if (closed) return
        setConnected(false)
        if (e.code === CLOSE_REPLACED || e.code === CLOSE_FULL) {
          setFatal(e.reason || '接続できませんでした')
          return
        }
        retry = window.setTimeout(connect, 1000)
      }
    }
    connect()

    return () => {
      closed = true
      window.clearTimeout(retry)
      wsRef.current?.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [url])

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  return { connected, fatal, send }
}
