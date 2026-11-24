// How the page was opened: an Android launcher shortcut, the share sheet, or neither.

export function launchIntent(search) {
  const q = new URLSearchParams(search)
  const shared = ['share_url', 'share_text', 'share_title'].map(k => q.get(k) || '').filter(Boolean)
  if (shared.length) {
    const url = shared.join(' ').match(/https?:\/\/[^\s<>"]+/)?.[0]
    return url ? { add: true, url } : { view: 'notes', note: shared.join('\n') }
  }
  if (q.has('add')) return { add: true, url: '' }
  const view = q.get('view')
  if (view === 'notes' || view === 'guides') return { view }
  if (view === 'drive') return { mode: 'drive' }
  return {}
}

// Only Android sets this referrer, and only for a page opened by an app. Navigating
// inside the app loses it, so it is kept for the life of the tab.
const APP_KEY = 'shelf_in_app'
if (document.referrer.startsWith('android-app://xyz.cmdward.shelf')) sessionStorage.setItem(APP_KEY, '1')
export const inApp = () => sessionStorage.getItem(APP_KEY) === '1'

// The APK shares localStorage with the phone's browser, so a saved unlock counts
// only inside the app. Otherwise it would skip the PIN in ordinary tabs too.
const KEEP_KEY = 'shelf_keep_unlocked'
export const keepsUnlocked = () => inApp() && localStorage.getItem(KEEP_KEY) === '1'
export const setKeepUnlocked = (on) =>
  on ? localStorage.setItem(KEEP_KEY, '1') : localStorage.removeItem(KEEP_KEY)
