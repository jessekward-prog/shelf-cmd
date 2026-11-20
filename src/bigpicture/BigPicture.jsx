import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createEngine } from './engine'
import './bigpicture.css'

// Big Picture Mode: the same desktop UI, sized for across the room and driven by a remote
// or controller. The setting is per device (a phone shouldn't follow the TV into it), so it
// lives in localStorage, and `?bigpicture=1` / `?bigpicture=0` flips it from a bookmark.

const KEY = 'bigpicture'
const SCALE_KEY = 'bigpicture-scale'
const TV_UA = /\b(SMART-?TV|SmartTV|GoogleTV|Android TV|AFT[A-Z]|BRAVIA|Tizen|Web0S|webOS|NetCast|HbbTV|CrKey|Roku|Viera|AQUOS|PhilipsTV|VIDAA)\b/i
export const SCALES = [['auto', 'Auto'], [1, '100%'], [1.25, '125%'], [1.5, '150%'], [1.75, '175%'], [2, '200%']]

const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }

function initialEnabled() {
  try {
    const q = new URLSearchParams(location.search).get('bigpicture')
    if (q === '1' || q === '0') { write(KEY, q); return q === '1' }
  } catch {}
  const saved = read(KEY)
  if (saved === '1' || saved === '0') return saved === '1'
  // Never chosen on this device: start in Big Picture on a TV browser, the way Steam does.
  return TV_UA.test(navigator.userAgent || '')
}

const Ctx = createContext({ enabled: false, setEnabled() {}, scale: 'auto', setScale() {}, openActions() {}, focusZone() {}, isTV: false, handlers: { current: {} } })
export const useBigPicture = () => useContext(Ctx)

// Props for a tile that is one remote stop, with its buttons moved to an options sheet.
// OK runs `onActivate`; hold OK (or Menu, or X on a controller) opens `actions()`, built
// only when the sheet opens. A mouse click on the tile's own children still does what it
// always did, since only a click aimed at the tile itself counts as OK.
export function tvTile(bp, { title, onActivate, actions }) {
  if (!bp.enabled) return {}
  return {
    'data-tv-item': '',
    'data-tv-menu': actions ? '' : undefined,
    tabIndex: 0,
    ...(onActivate && { onClick: (e) => { if (e.target === e.currentTarget) onActivate() } }),
    ...(actions && { onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); bp.openActions(title, actions()) } }),
  }
}

// The app tells Big Picture what Back and Search mean on the current screen.
// onBack returns true when it handled Back; otherwise focus falls back to the nav zone.
export function useTvHandlers(h) {
  const { handlers } = useBigPicture()
  handlers.current = h
  useEffect(() => () => { handlers.current = {} }, [handlers])
}

export function BigPictureProvider({ children }) {
  const [enabled, setEnabledState] = useState(initialEnabled)
  const [scale, setScaleState] = useState(() => { const s = read(SCALE_KEY); return s && s !== 'auto' ? Number(s) : 'auto' })
  const [sheet, setSheet] = useState(null)
  const [reader, setReader] = useState(null)
  const [player, setPlayer] = useState(null)
  const [hint, setHint] = useState({ hasMenu: false, layer: false, pad: false })
  const engine = useRef(null)
  const handlers = useRef({})

  const setEnabled = useCallback((v) => { write(KEY, v ? '1' : '0'); setEnabledState(!!v) }, [])
  const setScale = useCallback((v) => { write(SCALE_KEY, String(v)); setScaleState(v) }, [])
  const openActions = useCallback((title, items) => setSheet({ title, items: items.filter(Boolean) }), [])
  // Long text (a plan, a transcript) in a full-screen reader that up / down scroll.
  const openReader = useCallback((title, text) => setReader({ title, text }), [])
  // Media full screen: { title, src, kind: 'video' | 'iframe' }.
  const openPlayer = useCallback((p) => setPlayer(p), [])

  useEffect(() => {
    const root = document.documentElement
    if (!enabled) {
      root.removeAttribute('data-bp')
      root.style.zoom = ''
      root.style.removeProperty('--bpz')
      return
    }
    root.setAttribute('data-bp', '')
    // Many TV browsers report a phone-sized viewport (960px wide for 1080p), which would
    // drop the app into its phone layout. A wider layout viewport keeps the desktop UI and
    // lets the browser scale it to the screen. Desktop browsers ignore this and zoom instead.
    const meta = document.querySelector('meta[name="viewport"]')
    const prevMeta = meta?.getAttribute('content')
    if (meta && Math.max(screen.width, window.innerWidth) < 1280) meta.setAttribute('content', 'width=1280')
    const apply = () => {
      // Auto treats the screen as a 1280px desktop, so 1080p comes out at 150%.
      const z = scale === 'auto' ? Math.min(2, Math.max(1, Math.round((window.innerWidth / 1280) * 20) / 20)) : scale
      root.style.zoom = String(z)
      root.style.setProperty('--bpz', String(z))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      if (meta && prevMeta != null) meta.setAttribute('content', prevMeta)
    }
  }, [enabled, scale])

  useEffect(() => {
    if (!enabled) return
    const e = createEngine({
      onBack: (ctx) => handlers.current.onBack?.(ctx),
      onSearch: () => (handlers.current.onSearch ? handlers.current.onSearch() : e.focusSearch()),
      onChange: ({ hasMenu, layer }) => setHint({ hasMenu, layer: !!layer, pad: e.hasGamepad() }),
    })
    engine.current = e
    e.start()
    return () => { e.stop(); engine.current = null }
  }, [enabled])

  const focusZone = useCallback((z) => engine.current?.focusZone(z), [])
  const value = useMemo(() => ({
    enabled, setEnabled, scale, setScale, openActions, openReader, openPlayer, focusZone, handlers, isTV: TV_UA.test(navigator.userAgent || ''),
  }), [enabled, setEnabled, scale, setScale, openActions, openReader, openPlayer, focusZone])

  return (
    <Ctx.Provider value={value}>
      {children}
      {enabled && player && <Player player={player} onClose={() => setPlayer(null)} />}
      {enabled && reader && <Reader reader={reader} onClose={() => setReader(null)} />}
      {enabled && sheet && <ActionSheet sheet={sheet} onClose={() => setSheet(null)} />}
      {enabled && <HintBar {...hint} />}
    </Ctx.Provider>
  )
}

function ActionSheet({ sheet, onClose }) {
  const run = (item) => { onClose(); setTimeout(() => item.onSelect(), 0) }
  return (
    <div className="bp-sheet-backdrop" onClick={onClose}>
      <div className="bp-sheet" data-tv-modal role="dialog" aria-modal="true" aria-label={sheet.title} onClick={e => e.stopPropagation()}>
        <div className="bp-sheet-title">{sheet.title}</div>
        <div className="bp-sheet-list">
          {sheet.items.map((item, i) => (
            <button
              key={item.label}
              className={`bp-sheet-item${item.danger ? ' bp-danger' : ''}`}
              data-tv-autofocus={i === 0 ? '' : undefined}
              disabled={item.disabled}
              onClick={() => run(item)}
            >
              <span>{item.label}</span>
              {item.hint && <span className="bp-sheet-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
        <button className="bp-sheet-item bp-sheet-cancel" data-tv-back onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function Reader({ reader, onClose }) {
  const body = useRef(null)
  useEffect(() => {
    const h = (e) => {
      const d = { ArrowDown: 1, ArrowUp: -1, PageDown: 2, PageUp: -2 }[e.key]
      if (!d || !body.current) return
      e.preventDefault()
      body.current.scrollBy({ top: d * body.current.clientHeight * 0.45, behavior: 'smooth' })
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])
  return (
    <div className="bp-sheet-backdrop" onClick={onClose}>
      <div className="bp-reader" data-tv-modal data-tv-arrows="all" role="dialog" aria-modal="true" aria-label={reader.title} onClick={e => e.stopPropagation()}>
        <div className="bp-reader-head">
          <span className="bp-sheet-title">{reader.title}</span>
          <button className="bp-chip" data-tv-back data-tv-autofocus onClick={onClose}>Close</button>
        </div>
        <div ref={body} className="bp-reader-body">{reader.text}</div>
        <div className="bp-reader-foot">↑ ↓ scroll</div>
      </div>
    </div>
  )
}

function Player({ player, onClose }) {
  const video = useRef(null)
  const src = player.kind === 'iframe'
    ? player.src + (player.src.includes('?') ? '&' : '?') + 'autoplay=1'
    : player.src
  useEffect(() => {
    if (player.kind !== 'video') return
    const h = (e) => {
      const v = video.current
      if (!v) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 10) }
      if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10) }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [player.kind])
  const toggle = () => { const v = video.current; if (v) v.paused ? v.play() : v.pause() }
  return (
    <div className="bp-player" data-tv-modal data-tv-arrows={player.kind === 'video' ? 'horizontal' : undefined} role="dialog" aria-modal="true" aria-label={player.title}>
      {player.kind === 'video'
        ? <video ref={video} src={src} autoPlay controls playsInline />
        : <iframe src={src} title={player.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />}
      {player.kind === 'video' && <button className="bp-player-hit" aria-label="Play / pause" data-tv-autofocus onClick={toggle} />}
      <div className="bp-player-bar">
        <span className="bp-player-title">{player.title}</span>
        <button className="bp-chip" data-tv-back onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

function Glyph({ children, round }) {
  return <span className={`bp-glyph${round ? ' bp-round' : ''}`}>{children}</span>
}

function HintBar({ hasMenu, layer, pad }) {
  return (
    <div className="bp-hints" aria-hidden="true">
      <span><Glyph round={pad}>{pad ? 'A' : 'OK'}</Glyph>Select</span>
      {hasMenu && <span><Glyph round={pad}>{pad ? 'X' : 'Hold OK'}</Glyph>Options</span>}
      <span><Glyph round={pad}>{pad ? 'B' : '↩'}</Glyph>{layer ? 'Close' : 'Back'}</span>
      {pad && !layer && <span><Glyph round>Y</Glyph>Search</span>}
    </div>
  )
}

// The settings block, shared by both apps so Big Picture reads the same everywhere.
export function BigPictureSettings({ compact = false }) {
  const { enabled, setEnabled, scale, setScale, isTV } = useBigPicture()
  return (
    <div className={`bp-settings${compact ? ' bp-compact' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className="bp-switch-row"
        data-tv-autofocus={compact ? '' : undefined}
        onClick={() => setEnabled(!enabled)}
      >
        <span className="bp-switch-text">
          <span className="bp-switch-label">Big Picture Mode</span>
          <span className="bp-switch-desc">
            For the TV: bigger, and driven by a remote or controller. Each card is one stop;
            hold OK for its options. Saved on this device only.
          </span>
        </span>
        <span className={`bp-switch${enabled ? ' bp-on' : ''}`}><span /></span>
      </button>
      {enabled && (
        <div className="bp-scale">
          <span className="bp-scale-label">Size</span>
          <div className="bp-scale-opts">
            {SCALES.map(([v, label]) => (
              <button key={label} type="button" className={`bp-chip${scale === v ? ' bp-active' : ''}`} onClick={() => setScale(v)}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {!compact && (
        <p className="bp-tip">
          {isTV ? 'This looks like a TV, so Big Picture starts on its own here. ' : ''}
          Bookmark <code>?bigpicture=1</code> on the TV to always open in it. A gamepad works too:
          A select, B back, X options, Y search, bumpers page up and down.
        </p>
      )}
    </div>
  )
}
