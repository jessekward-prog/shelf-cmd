import { useEffect, useRef } from 'react'
import ThemePicker from './ThemePicker.jsx'
import { usePWAInstall } from '../hooks/usePWAInstall'

function SearchIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
      stroke={active ? 'var(--s-accent)' : 'var(--s-text-3)'} strokeWidth="2"
      strokeLinecap="round" style={{ flexShrink: 0, transition: 'stroke 0.15s' }}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

/* One keycap style, so `/` in search and `⌘K` on the button read as the same system. */
function Kbd({ children }) {
  return (
    <span style={{
      fontSize: 9, lineHeight: 1, padding: '3px 5px', borderRadius: 4,
      border: '1px solid var(--s-border)', color: 'var(--s-text-3)',
      fontFamily: 'inherit', flexShrink: 0
    }}>
      {children}
    </span>
  )
}

export default function Topbar({
  search, onSearch, onAdd, canAdd, theme, onTheme, user, onRenamed, searchRef
}) {
  const localRef = useRef(null)
  const ref = searchRef || localRef
  const { canInstall, install } = usePWAInstall()

  // `/` focuses search, ⌘/Ctrl+K opens add — the two things you do all day.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable
      if (e.key === '/' && !typing) {
        e.preventDefault()
        ref.current?.focus()
      } else if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (canAdd) onAdd()
      } else if (e.key === 'Escape' && document.activeElement === ref.current) {
        onSearch('')
        ref.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAdd, onSearch, canAdd, ref])

  return (
    <header
      className="hidden lg:flex items-center gap-4 shrink-0 sticky top-0 z-20"
      style={{
        height: 56, padding: '0 20px',
        background: 'var(--s-surface)',
        borderBottom: '1px solid var(--s-border)'
      }}
    >
      <div className="flex items-center gap-2.5 shrink-0">
        <img src="/logo.png" alt="" width="26" height="26" style={{ borderRadius: 6, objectFit: 'contain' }} />
        <span style={{ fontSize: 12, letterSpacing: '0.28em', color: 'var(--s-accent)' }}>SHELFSTATION</span>
      </div>

      <div
        className="flex items-center gap-2.5 flex-1"
        style={{
          maxWidth: 460, marginLeft: 12,
          padding: '7px 10px', borderRadius: 8,
          background: 'var(--s-bg)',
          border: `1px solid ${search ? 'var(--s-accent)' : 'var(--s-border)'}`,
          transition: 'border-color 0.15s'
        }}
      >
        <SearchIcon active={!!search} />
        <input
          ref={ref}
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search titles, descriptions, notes…"
          className="flex-1"
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 13, color: 'var(--s-text-1)', minWidth: 0
          }}
        />
        {search
          ? <button onClick={() => onSearch('')} title="Clear (Esc)" style={{ fontSize: 12, color: 'var(--s-text-3)', flexShrink: 0 }}>✕</button>
          : <Kbd>/</Kbd>}
      </div>

      <div className="flex items-center gap-3 ml-auto shrink-0">
        <button
          onClick={onAdd}
          disabled={!canAdd}
          title="Add a card (Ctrl+K)"
          className="glow-focus flex items-center gap-2"
          style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
            background: canAdd ? 'var(--s-accent)' : 'var(--s-surface-2)',
            color: canAdd ? 'var(--s-bg)' : 'var(--s-text-3)',
            cursor: canAdd ? 'pointer' : 'not-allowed',
            transition: 'opacity 0.15s'
          }}
          onMouseEnter={(e) => { if (canAdd) e.currentTarget.style.opacity = '0.88' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          Add card
        </button>

        {canInstall && (
          <button
            onClick={install}
            title="Install as an app — a real icon instead of a browser tab"
            className="glow-focus"
            style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit',
              border: '1px solid var(--s-border)', color: 'var(--s-text-2)', background: 'transparent'
            }}
          >
            Install as App
          </button>
        )}

        <ThemePicker current={theme} onChange={onTheme} user={user} onRenamed={onRenamed} placement="down" />
      </div>
    </header>
  )
}
