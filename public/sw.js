// Bump this whenever the caching rules change — activate() purges everything else.
const CACHE = 'shelf-v2'

self.addEventListener('install', e => {
  // Don't precache index.html: it's fetched network-first below, and a precached
  // copy is exactly what used to pin people to the previous deploy.
  e.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Requests that must never be served from cache: live data, file bytes, and
// share-link downloads (which are also far too big to keep).
function isBypass(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/s/')
}

// Vite emits content-hashed filenames, so those are immutable and safe to
// serve cache-first. Everything else changes in place and must not be.
function isImmutableAsset(url) {
  return /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(url.pathname)
}

self.addEventListener('fetch', e => {
  const { request } = e
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isBypass(url)) return

  // Navigations: network-first, so a deploy is picked up on the next load and
  // never a load after that. Cache is only the offline fallback.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put('/index.html', clone))
          return res
        })
        .catch(() => caches.match('/index.html').then(r => r || Response.error()))
    )
    return
  }

  // Hashed build assets: cache-first is correct, the URL changes when they do.
  if (isImmutableAsset(url)) {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(request, clone)) }
        return res
      }))
    )
    return
  }

  // Everything else (icons, manifest, banner): stale-while-revalidate.
  e.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(request, clone)) }
        return res
      }).catch(() => cached)
      return cached || network
    })
  )
})
