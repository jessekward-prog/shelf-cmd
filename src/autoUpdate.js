// Keeps an installed app (a TV, a phone's home-screen icon) on the latest deploy without
// anyone clearing a cache. Every build gets an id: it's baked into this bundle, written to
// /version.json, and stamped into sw.js's cache name, so each deploy also replaces the
// service worker and wipes the previous deploy's caches.
//
// While the app is open it checks /version.json when it comes back to the foreground and
// every 15 minutes. A newer build reloads the page, but only at a moment that loses nothing:
// the app is in the background, or nothing is open and nobody is typing.

/* global __BUILD_ID__ */
const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
const GUARD = 'app-reloaded-for'

let pending = null
let reg = null

const busy = () => {
  const a = document.activeElement
  const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)
  const open = document.querySelector('[data-tv-modal], [role="dialog"], [aria-modal="true"]')
  const playing = [...document.querySelectorAll('video')].some(v => !v.paused)
  return typing || !!open || playing
}

function reloadWhenSafe() {
  if (!pending) return
  if (!document.hidden && busy()) return
  // Never loop: one reload per build, even if a stale copy is still being served somewhere.
  try { if (sessionStorage.getItem(GUARD) === pending) return; sessionStorage.setItem(GUARD, pending) } catch {}
  location.reload()
}

async function check() {
  if (BUILD === 'dev') return
  try {
    const r = await fetch('/version.json', { cache: 'no-store' })
    if (!r.ok) return
    const { build } = await r.json()
    if (!build || build === BUILD) return
    pending = build
    reg?.update().catch(() => {})
    reloadWhenSafe()
  } catch {}
}

export function startAutoUpdate() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(r => { reg = r })
      .catch(() => {})
  }
  document.addEventListener('visibilitychange', () => { document.hidden ? reloadWhenSafe() : check() })
  window.addEventListener('focus', check)
  // While waiting on a busy moment, keep looking for a quiet one.
  document.addEventListener('focusout', () => setTimeout(reloadWhenSafe, 500))
  setInterval(check, 15 * 60 * 1000)
  setInterval(reloadWhenSafe, 30 * 1000)
  setTimeout(check, 5000)
}
