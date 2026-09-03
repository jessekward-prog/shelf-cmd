import { useEffect, useRef, useCallback, useState } from 'react'

// Chunky dithered ripple ring — same bitmap technique as reverb's CrtBackdrop
// dither field (Bayer-thresholded dot grid), without the skull sample. Used
// as a subtle "something's working" pulse behind a card while it's busy.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const REF_W = 390

function useMeasure(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setSize({ w: Math.round(width), h: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function resolveColor(color) {
  if (!color) return '#000'
  if (color.startsWith('var(')) {
    const name = color.slice(4, -1).split(',')[0].trim()
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000'
  }
  return color
}

export default function RippleField({ ambientMs = 2800, color = '#000' }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const ripples = useRef([])
  const { w: W, h: H } = useMeasure(wrapRef)

  const push = useCallback(() => {
    if (!W || !H) return
    ripples.current.push({ t0: performance.now(), x: W / 2, y: H / 2 })
  }, [W, H])

  useEffect(() => {
    if (!W || !H) return
    push()
    const amb = setInterval(push, ambientMs)
    return () => clearInterval(amb)
  }, [W, H, push, ambientMs])

  useEffect(() => {
    if (!W || !H) return
    const S = W / REF_W
    const step = Math.max(3, Math.round(6 * S))
    const dot = Math.max(2, Math.round(4 * S))
    const c = canvasRef.current
    c.width = W; c.height = H
    const ctx = c.getContext('2d')
    ctx.fillStyle = resolveColor(color)

    let raf
    const draw = (now) => {
      ctx.clearRect(0, 0, W, H)
      ripples.current = ripples.current.filter(r => now - r.t0 < 4200)

      for (let y = 2; y < H; y += step) {
        for (let x = 2; x < W; x += step) {
          let v = 0
          for (const r of ripples.current) {
            const t = (now - r.t0) / 1000
            const R = t * 60 * S
            const d = Math.hypot(x - r.x, y - r.y)
            const g = Math.exp(-Math.pow((d - R) / (22 * S), 2))
            v += g * Math.exp(-t * 0.5)
          }
          const bx = ((x / step) | 0) & 3, by = ((y / step) | 0) & 3
          const thr = BAYER[by * 4 + bx] / 16
          if (v <= thr * 1.1 + 0.05) continue
          ctx.globalAlpha = Math.min(0.5, v)
          ctx.fillRect(x, y, dot, dot)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [W, H, color])

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  )
}
