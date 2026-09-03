import { useEffect, useRef } from 'react'

// Ported from hostess's mountWaveBackground (public/index.html), itself from
// chat-cmd's WaveBackground.jsx / apps-cmd's XMB wave — same sine-band +
// particle canvas, fixed to 'outline' style / 'normal' speed. Tinted with
// the four PlayStation symbol colours instead of one accent, at 50% opacity
// so it reads as ambient texture behind the sidebar, not a focal point.
const PS_GREEN = '0,166,80'   // triangle
const PS_RED   = '213,43,30'  // circle
const PS_BLUE  = '0,112,192'  // cross
const PS_PINK  = '214,51,132' // square

export default function WaveBackground() {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const ctx = canvas.getContext('2d')
    const parts = Array.from({ length: 20 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.3, s: 0.02 + Math.random() * 0.05
    }))
    const bands = [
      { amp: 40, len: 0.9, sp: 0.18, y: 0.5, a: 0.06, color: PS_GREEN },
      { amp: 65, len: 0.6, sp: 0.12, y: 0.6, a: 0.05, color: PS_BLUE },
      { amp: 85, len: 0.4, sp: 0.08, y: 0.7, a: 0.035, color: PS_RED },
    ]
    let t = 0
    let raf

    function size() {
      const d = window.devicePixelRatio || 1
      canvas.width = wrap.clientWidth * d
      canvas.height = wrap.clientHeight * d
      ctx.setTransform(d, 0, 0, d, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(wrap)

    function draw() {
      t += reduceMotion ? 0.00075 : 0.001
      const W = wrap.clientWidth, H = wrap.clientHeight
      ctx.clearRect(0, 0, W, H)

      bands.forEach((b) => {
        ctx.beginPath()
        for (let x = 0; x <= W; x += 8) {
          const p = x / W
          const y = H * b.y + Math.sin(p * 6.28 * b.len + t / b.sp) * b.amp + Math.sin(p * 15.7 * b.len - (t / b.sp) * 1.7) * b.amp * 0.3
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.strokeStyle = `rgba(${b.color},${Math.min(b.a * 5, 0.9)})`
        ctx.lineWidth = 1.5
        ctx.stroke()
      })

      parts.forEach((p) => {
        p.y -= p.s * 0.002
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random() }
        ctx.beginPath()
        ctx.arc(p.x * W, p.y * H, p.r, 0, 6.28)
        ctx.fillStyle = `rgba(${PS_PINK},0.16)`
        ctx.fill()
      })

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, zIndex: 0, opacity: 0.5, pointerEvents: 'none' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  )
}
