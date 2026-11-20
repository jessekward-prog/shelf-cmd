// Big Picture navigation engine: D-pad / remote / gamepad focus for a desktop UI on a TV.
//
// Framework-free on purpose; the same file lives in cmd-drive and shelf-cmd.
//
// The page opts in with a few attributes, so the markup decides what the remote can reach:
//   data-tv-zone="name"  a region (nav rail, top bar, main content). Each zone remembers the
//                        last thing focused in it, so leaving and coming back lands where you were.
//   data-tv-item         one focus stop for a whole tile. Nothing inside it is a stop of its own:
//                        its buttons move to the options sheet (hold OK / Menu / gamepad X).
//   data-tv-skip         this subtree is never a focus stop.
//   data-tv-menu         this stop has options; the hint bar says so, and hold OK opens them
//                        (a `contextmenu` event, which the component handles).
//   data-tv-modal        a layer that traps focus (role="dialog" and aria-modal work too).
//                        ="backdrop" means Back clicks the layer itself, for overlays that close
//                        when their backdrop is clicked.
//   data-tv-back         inside a layer: what Back presses.
//   data-tv-autofocus    inside a layer: where focus starts when it opens.
//   data-tv-arrows       on a layer that uses arrow keys itself ("horizontal" or "all"), like an
//                        image viewer's previous / next. Those keys go to the page, not to focus.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  '[data-tv-item]', '[contenteditable="true"]',
].join(',')
const LAYER = '[data-tv-modal], [role="dialog"], [aria-modal="true"]'
const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const BACK_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack', 'Back'])
const BACK_CODES = new Set([461, 10009, 166]) // webOS, Tizen, Android TV browsers
const HOLD_MS = 550
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }

const isTyping = (el) => !!el && (
  (el.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|color|file)$/i.test(el.type)) ||
  el.tagName === 'TEXTAREA' || el.isContentEditable
)

// `faded` counts an opacity-0 element as hidden: right for hover-only buttons, wrong for a
// dialog that is still fading in, so layers are checked without it.
function visible(el, faded = true) {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  if (el.checkVisibility) return el.checkVisibility({ opacityProperty: faded, visibilityProperty: true })
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && (!faded || cs.opacity !== '0')
}

export function createEngine({ onBack, onSearch, onChange } = {}) {
  const memory = new Map() // zone name -> last focused element
  let layerStack = []      // [{ layer, restore }]
  let current = null
  let lastCross = null // { from, to, dir } of the last move between zones
  let hold = null
  let raf = 0
  let pads = 0
  let padState = {}
  let observer = null

  const emit = () => onChange && onChange({ el: current, hasMenu: !!current?.closest?.('[data-tv-menu]'), layer: topLayer() })

  function topLayer() {
    const all = [...document.querySelectorAll(LAYER)].filter(l => l.isConnected && visible(l, false))
    return all[all.length - 1] || null
  }

  function stops(scope = topLayer() || document.body) {
    const faded = scope === document.body
    return [...scope.querySelectorAll(FOCUSABLE)].filter(el => {
      if (el.closest('[data-tv-skip]')) return false
      const item = el.parentElement?.closest('[data-tv-item]')
      if (item && scope.contains(item) && item !== scope) return false
      return visible(el, faded)
    })
  }

  const ACTIVE = '[data-active="true"], [aria-current]:not([aria-current="false"]), [aria-selected="true"]'
  // Entering a zone you haven't been in yet starts at its selected item: the shelf or
  // section you're on, not the first button in it.
  function entry(zone, scope = document.body) {
    const list = stops(scope).filter(el => zoneOf(el) === zone)
    return remembered(zone, scope) || list.find(el => el.matches(ACTIVE)) || list.find(el => el.hasAttribute('data-tv-item')) || list[0] || null
  }

  const zoneOf = (el) => el?.closest?.('[data-tv-zone]')?.getAttribute('data-tv-zone') || null

  // A TV pops its on-screen keyboard the moment a text box takes focus, so passing over one
  // would keep throwing it up. Boxes reached by the remote stay read-only until OK.
  function lock(el) {
    if (!isTyping(el) || el.isContentEditable || el.readOnly) return
    el.readOnly = true
    el.setAttribute('data-tv-locked', '')
  }
  function unlock(el) {
    if (!el?.hasAttribute?.('data-tv-locked')) return false
    el.readOnly = false
    el.removeAttribute('data-tv-locked')
    return true
  }

  function mark(el) {
    if (current && current !== el) { current.removeAttribute('data-tv-focused'); unlock(current) }
    current = el
    if (el) {
      el.setAttribute('data-tv-focused', '')
      const z = zoneOf(el)
      if (z) memory.set(z, el)
    }
    emit()
  }

  function focus(el, { scroll = true } = {}) {
    if (!el) return
    if (el !== document.activeElement) lock(el)
    el.focus({ preventScroll: true })
    // Tiles take tabindex from the component; anything else that didn't take focus still
    // gets the ring, so the remote never loses track of where it is.
    mark(el)
    if (scroll) {
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: el.hasAttribute('data-tv-item') ? 'center' : 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' })
    }
  }

  function remembered(zone, scope) {
    const el = memory.get(zone)
    return el && el.isConnected && scope.contains(el) && visible(el) && !el.closest('[data-tv-skip]') ? el : null
  }

  // Where focus goes when there isn't any: the main zone's last stop, then its first, then anything.
  function home(scope = topLayer() || document.body) {
    const list = stops(scope)
    const auto = scope.querySelector('[data-tv-autofocus]')
    if (auto && list.includes(auto)) return auto
    if (scope !== document.body) return list.find(el => !el.hasAttribute('data-tv-back')) || list[0] || null
    const main = list.filter(el => zoneOf(el) === 'main')
    return remembered('main', scope) || main.find(el => el.hasAttribute('data-tv-item')) || main[0] || list[0] || null
  }

  function best(from, dir, list, aligned = false) {
    const a = from.getBoundingClientRect()
    const acx = a.left + a.width / 2, acy = a.top + a.height / 2
    let win = null, score = Infinity
    const pass = (strict) => {
      for (const el of list) {
        if (el === from || el.contains(from) || from.contains(el)) continue
        const b = el.getBoundingClientRect()
        const bcx = b.left + b.width / 2, bcy = b.top + b.height / 2
        let main, gap, off
        // Strictly "beyond" means past the near edge, with a little slack for a focused
        // tile's zoom and for neighbours that overlap by a hair.
        if (dir === 'left' || dir === 'right') {
          const tol = Math.min(a.width, b.width) * 0.25
          const ahead = dir === 'right' ? (strict ? b.left >= a.right - tol : bcx > acx + 1) : (strict ? b.right <= a.left + tol : bcx < acx - 1)
          if (!ahead) continue
          main = Math.max(0, dir === 'right' ? b.left - a.right : a.left - b.right)
          gap = Math.max(0, b.top - a.bottom, a.top - b.bottom)
          off = Math.abs(Math.min(Math.max(bcy, a.top), a.bottom) - bcy)
        } else {
          const tol = Math.min(a.height, b.height) * 0.25
          const ahead = dir === 'down' ? (strict ? b.top >= a.bottom - tol : bcy > acy + 1) : (strict ? b.bottom <= a.top + tol : bcy < acy - 1)
          if (!ahead) continue
          main = Math.max(0, dir === 'down' ? b.top - a.bottom : a.top - b.bottom)
          gap = Math.max(0, b.left - a.right, a.left - b.right)
          off = Math.abs(Math.min(Math.max(bcx, a.left), a.right) - bcx)
        }
        // The loose pass is for overlapping layouts, not for wrapping round a corner, and
        // nothing far off to the side counts as being in that direction at all.
        if ((aligned || !strict) && gap > 0) continue
        if (gap > main * 1.5 + 48) continue
        // Rows and columns first: something lined up beats something nearer but off-axis.
        const s = main + gap * 3 + off * 0.15
        if (s < score) { score = s; win = el }
      }
    }
    pass(true)
    if (!win) pass(false)
    return win
  }

  function owns(layer, dir) {
    const a = layer?.getAttribute('data-tv-arrows')
    return a === 'all' || (a === 'horizontal' && (dir === 'left' || dir === 'right'))
  }

  function move(dir, fromPad) {
    const layer = topLayer()
    if (fromPad && owns(layer, dir)) {
      const key = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir]
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      return
    }
    const scope = layer || document.body
    const from = current && current.isConnected && scope.contains(current) && visible(current) ? current : null
    if (!from) { focus(home(scope)); return }
    const list = stops(scope)
    const zone0 = zoneOf(from)
    // Retracing a step goes back where you came from: down from the top bar returns to the
    // card you left, even if the sidebar happens to be nearer.
    if (lastCross && lastCross.to === zone0 && OPPOSITE[lastCross.dir] === dir && !best(from, dir, list.filter(el => zoneOf(el) === zone0))) {
      const back = entry(lastCross.from, scope)
      if (back) { lastCross = { from: zone0, to: lastCross.from, dir }; focus(back); return }
    }
    // Stay inside the current zone while it has somewhere to go; only its edge leads out.
    const zone = zoneOf(from)
    // Leaving it, something straight across beats something nearer on the diagonal: up from
    // the grid's top row is the top bar, not the corner of the sidebar.
    let next = (zone && best(from, dir, list.filter(el => zoneOf(el) === zone))) || best(from, dir, list, true) || best(from, dir, list)
    if (!next) return
    // Crossing into another zone resumes where you left it, the way a console menu does.
    const z = zoneOf(next)
    if (z && z !== zone) {
      next = remembered(z, scope) || (z === 'nav' && entry(z, scope)) || next
      lastCross = { from: zone, to: z, dir }
    }
    focus(next)
  }

  function back(fromKey) {
    const active = document.activeElement
    // Back from typing puts the keyboard away but stays on the box.
    if (isTyping(active) && !active.hasAttribute('data-tv-locked')) { active.blur(); lock(active); mark(active); return true }
    const layer = topLayer()
    if (layer) {
      const btn = layer.querySelector('[data-tv-back]')
      if (btn) { btn.click(); return true }
      if (layer.getAttribute('data-tv-modal') === 'backdrop') { layer.click(); return true }
      if (onBack && onBack({ layer })) return true
      if (fromKey !== 'Escape') (active || document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return fromKey !== 'Escape'
    }
    if (onBack && onBack({ layer: null })) return true
    if (zoneOf(current) !== 'nav') {
      const nav = entry('nav')
      if (nav) { focus(nav); return true }
    }
    return false
  }

  function openMenu(el = current) {
    if (!el) return false
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
    return true
  }

  function activate(el = current) {
    if (!el) return
    if (el.tagName === 'INPUT' && !isTyping(el)) { el.click(); return }
    if (isTyping(el)) {
      // OK on a text box: now it takes typing, and blur + focus brings the keyboard up.
      if (unlock(el)) { el.blur(); el.focus({ preventScroll: true }); mark(el) }
      else el.focus()
      return
    }
    el.click()
  }

  // ── Keys ──────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return
    const active = document.activeElement
    const dir = DIRS[e.key]
    if (active?.hasAttribute?.('data-tv-locked')) {
      if (e.key === 'Enter' || e.keyCode === 23) { e.preventDefault(); activate(active); return }
      // A real keyboard just types.
      if (e.key.length === 1) unlock(active)
    }
    const typing = isTyping(active) && !active.hasAttribute('data-tv-locked')

    if (dir) {
      if (owns(topLayer(), dir) && !typing) return
      if (typing) {
        if (active.tagName === 'TEXTAREA') {
          const atStart = active.selectionStart === 0, atEnd = active.selectionEnd === active.value.length
          if ((dir === 'up' && !atStart) || (dir === 'down' && !atEnd) || dir === 'left' || dir === 'right') return
        } else if (dir === 'left' || dir === 'right') {
          const atStart = active.selectionStart === 0 && active.selectionEnd === 0
          const atEnd = active.selectionStart === active.value?.length
          if (!((dir === 'left' && atStart) || (dir === 'right' && atEnd))) return
        }
      }
      if (active?.tagName === 'INPUT' && active.type === 'range' && (dir === 'left' || dir === 'right')) return
      if (active?.tagName === 'SELECT') return
      e.preventDefault()
      move(dir)
      return
    }

    const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 23
    if (isOk && !typing && current && (!active || active === document.body || current.contains(active) || active === current)) {
      if (e.key === ' ' && active?.tagName === 'INPUT') return
      e.preventDefault()
      if (e.repeat) return
      const el = current
      if (el.closest('[data-tv-menu]')) {
        hold = { el, fired: false, t: setTimeout(() => { hold.fired = true; openMenu(el) }, HOLD_MS) }
      } else {
        activate(el)
      }
      return
    }

    if (e.key === 'ContextMenu' || e.keyCode === 93) {
      if (current) { e.preventDefault(); openMenu() }
      return
    }

    if (BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode) || (e.key === 'Backspace' && !typing)) {
      if (back(e.key)) { e.preventDefault(); e.stopPropagation() }
    }
  }

  function onKeyUp(e) {
    if (!hold) return
    if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 23) {
      e.preventDefault()
      const h = hold
      hold = null
      clearTimeout(h.t)
      if (!h.fired) activate(h.el)
    }
  }

  function onFocusIn(e) {
    const el = e.target
    if (el === document.body || !(el instanceof Element)) return
    // A click on a tile's own child still means the tile.
    const item = el.closest('[data-tv-item]')
    mark(item || el)
  }

  function onPointer() {
    // A mouse on the TV is fine too; the ring just follows the last thing actually used.
    document.documentElement.setAttribute('data-tv-pointer', '')
  }
  const onKeyInput = () => document.documentElement.removeAttribute('data-tv-pointer')

  // ── Layers: focus moves into a layer when it opens and back out when it closes ──
  function syncLayers() {
    raf = 0
    const layer = topLayer()
    const top = layerStack[layerStack.length - 1]
    if (layer && (!top || top.layer !== layer)) {
      if (!layerStack.some(s => s.layer === layer)) {
        layerStack.push({ layer, restore: current })
        if (!layer.contains(document.activeElement)) {
          let tries = 0
          const enter = () => {
            if (!layer.isConnected || layer.contains(document.activeElement)) return
            const el = home(layer)
            if (el) focus(el, { scroll: false })
            else if (tries++ < 10) setTimeout(enter, 40)
          }
          setTimeout(enter, 20)
        }
      } else {
        while (layerStack.length && layerStack[layerStack.length - 1].layer !== layer) layerStack.pop()
      }
    }
    while (layerStack.length && !layerStack[layerStack.length - 1].layer.isConnected) {
      const gone = layerStack.pop()
      const now = layerStack[layerStack.length - 1]?.layer || null
      if (now !== topLayer()) continue
      const scope = now || document.body
      const target = gone.restore && gone.restore.isConnected && scope.contains(gone.restore) ? gone.restore : home(scope)
      if (target && (!scope.contains(document.activeElement) || document.activeElement === document.body)) focus(target, { scroll: false })
    }
    if (current && !current.isConnected) { current = null; emit(); recover() }
  }

  // The focused thing went away (a folder opened, a card was deleted): land somewhere sensible
  // once the new content is in, rather than leaving the remote pointing at nothing.
  let recovering = 0
  function recover() {
    clearTimeout(recovering)
    let tries = 0
    const go = () => {
      if (current && current.isConnected) return
      if (topLayer()) return
      const el = home()
      if (el && (el.hasAttribute('data-tv-item') || tries >= 12)) focus(el, { scroll: false })
      else if (tries++ < 12) recovering = setTimeout(go, 120)
    }
    recovering = setTimeout(go, 60)
  }
  const scheduleSync = () => { if (!raf) raf = requestAnimationFrame(syncLayers) }

  // ── Gamepad: the same moves, so a controller works like a remote ──
  const REPEAT_DELAY = 380, REPEAT_RATE = 110
  function pollPads(t) {
    const list = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []
    if (!list.length) { pads = 0; return }
    const p = list[0]
    const btn = (i) => !!p.buttons[i]?.pressed
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0
    const held = {
      up: btn(12) || ay < -0.55, down: btn(13) || ay > 0.55,
      left: btn(14) || ax < -0.55, right: btn(15) || ax > 0.55,
      a: btn(0), b: btn(1), x: btn(2), y: btn(3), lb: btn(4), rb: btn(5), start: btn(9),
    }
    for (const [k, on] of Object.entries(held)) {
      const s = padState[k] || (padState[k] = { on: false, next: 0 })
      if (on && !s.on) {
        s.on = true; s.next = t + REPEAT_DELAY; onKeyInput(); pad(k, false)
      } else if (on && ['up', 'down', 'left', 'right', 'lb', 'rb'].includes(k) && t >= s.next) {
        s.next = t + REPEAT_RATE; pad(k, true)
      } else if (!on && s.on) {
        s.on = false
      }
    }
    pads = requestAnimationFrame(pollPads)
  }
  function pad(k, repeat) {
    if (['up', 'down', 'left', 'right'].includes(k)) {
      const a = document.activeElement
      if (a?.tagName === 'INPUT' && a.type === 'range' && (k === 'left' || k === 'right')) {
        k === 'left' ? a.stepDown() : a.stepUp()
        a.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      move(k, true); return
    }
    if (repeat && k !== 'lb' && k !== 'rb') return
    if (k === 'a') { if (!current) focus(home()); else activate() }
    else if (k === 'b') back('pad')
    else if (k === 'x' || k === 'start') openMenu()
    else if (k === 'y') onSearch ? onSearch() : null
    else if (k === 'lb' || k === 'rb') {
      // Shoulder buttons page through long grids a screen at a time.
      const dir = k === 'lb' ? 'up' : 'down'
      for (let i = 0; i < 3; i++) move(dir)
    }
  }
  const onPadConnect = () => { if (!pads) pads = requestAnimationFrame(pollPads); emit() }

  return {
    start() {
      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('keyup', onKeyUp, true)
      window.addEventListener('keydown', onKeyInput, true)
      document.addEventListener('focusin', onFocusIn)
      document.addEventListener('pointermove', onPointer, { passive: true })
      window.addEventListener('gamepadconnected', onPadConnect)
      observer = new MutationObserver(scheduleSync)
      observer.observe(document.body, { childList: true, subtree: true })
      if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) onPadConnect()
      recover()
    },
    stop() {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('keydown', onKeyInput, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('pointermove', onPointer)
      window.removeEventListener('gamepadconnected', onPadConnect)
      observer?.disconnect()
      cancelAnimationFrame(pads); pads = 0
      cancelAnimationFrame(raf); raf = 0
      current?.removeAttribute('data-tv-focused')
      current = null
      document.documentElement.removeAttribute('data-tv-pointer')
    },
    focus, move, back, home, openMenu,
    focusSearch() {
      const el = [...document.querySelectorAll('[data-tv-search]')].find(el => visible(el))
      if (el) { focus(el); activate(el) }
    },
    hasGamepad: () => !!(navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)),
    focusZone(zone) {
      const el = entry(zone)
      if (el) focus(el)
    },
  }
}
