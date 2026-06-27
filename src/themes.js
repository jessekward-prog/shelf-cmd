export const THEMES = [
  // CRT
  { id: 'phosphor',  name: 'Phosphor',  swatch: '#e8840a', group: 'crt' },
  { id: 'synthwave', name: 'Synthwave', swatch: '#ff2eaa', group: 'crt' },
  { id: 'matrix',    name: 'Matrix',    swatch: '#00ff00', group: 'crt' },
  { id: 'ice',       name: 'Ice',       swatch: '#00bcd4', group: 'crt' },
  { id: 'void',      name: 'Void',      swatch: '#a855f7', group: 'crt' },
  { id: 'ember',     name: 'Ember',     swatch: '#ff4500', group: 'crt' },
  { id: 'vapor',     name: 'Vaporwave', swatch: '#ff2d9b', group: 'crt' },
  // Clean
  { id: 'cmd',       name: 'CMD',       swatch: '#ffffff', group: 'clean' },
  { id: 'slate',     name: 'Slate',     swatch: '#5b8dee', group: 'clean' },
  { id: 'nord',      name: 'Nord',      swatch: '#88c0d0', group: 'clean' },
  { id: 'rose',      name: 'Rose',      swatch: '#e8829a', group: 'clean' },
  { id: 'paper',     name: 'Paper',     swatch: '#2d6a4f', group: 'clean' },
]

export const FONTS = [
  { id: 'mono',     name: 'Mono',  family: "'JetBrains Mono', 'Fira Mono', monospace" },
  { id: 'orbitron', name: 'Orbit', family: "'Orbitron', sans-serif" },
  { id: 'vt323',    name: 'VT323', family: "'VT323', monospace" },
]

const THEME_KEY     = 'shelf-theme'
const INTENSITY_KEY = 'shelf-intensity'
const FONT_KEY      = 'shelf-font'
const OVERLAY_KEY   = 'shelf-overlay'

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

export function getSavedTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'cmd' } catch { return 'cmd' }
}

export function getSavedIntensity() {
  try { return parseInt(localStorage.getItem(INTENSITY_KEY) ?? '100') } catch { return 100 }
}

export function applyTheme(id) {
  const root = document.documentElement
  THEMES.forEach(t => root.classList.remove(`theme-${t.id}`))
  if (id !== 'phosphor') root.classList.add(`theme-${id}`)
  try { localStorage.setItem(THEME_KEY, id) } catch {}
}

const ACCENT_VARS = ['--s-accent', '--s-accent-faint', '--s-accent-glow', '--s-accent-strong']

export function getSavedFont() {
  try { return localStorage.getItem(FONT_KEY) || 'mono' } catch { return 'mono' }
}

export function applyFont(id) {
  const font = FONTS.find(f => f.id === id) || FONTS[0]
  document.documentElement.style.setProperty('--s-font', font.family)
  try { localStorage.setItem(FONT_KEY, id) } catch {}
}

export function getSavedOverlay() {
  try { return parseInt(localStorage.getItem(OVERLAY_KEY) ?? '100') } catch { return 100 }
}

export function applyOverlay(value) {
  document.documentElement.style.setProperty('--s-overlay', value / 100)
  try { localStorage.setItem(OVERLAY_KEY, String(value)) } catch {}
}

export function applyIntensity(value, themeId) {
  const root = document.documentElement
  // Always clear any old filter from previous implementation
  root.style.removeProperty('filter')

  if (value >= 100) {
    ACCENT_VARS.forEach(v => root.style.removeProperty(v))
    try { localStorage.setItem(INTENSITY_KEY, '100') } catch {}
    return
  }

  const id = themeId ?? getSavedTheme()
  const theme = THEMES.find(t => t.id === id) || THEMES[0]
  const { r, g, b } = hexToRgb(theme.swatch)
  const a = value / 100

  root.style.setProperty('--s-accent',        `rgba(${r},${g},${b},${a})`)
  root.style.setProperty('--s-accent-faint',  `rgba(${r},${g},${b},${(0.15 * a).toFixed(3)})`)
  root.style.setProperty('--s-accent-glow',   `rgba(${r},${g},${b},${(0.45 * a).toFixed(3)})`)
  root.style.setProperty('--s-accent-strong', `rgba(${r},${g},${b},${(0.9  * a).toFixed(3)})`)

  try { localStorage.setItem(INTENSITY_KEY, String(value)) } catch {}
}
