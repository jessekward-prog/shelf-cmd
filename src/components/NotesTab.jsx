import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

function isUrl(s) {
  try { return /^https?:\/\//.test(s.trim()) } catch { return false }
}

function NoteContent({ content }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--s-text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}>
      {content.split('\n').map((line, i, arr) => (
        <span key={i}>
          {isUrl(line.trim())
            ? <a href={line.trim()} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--s-accent)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                {line}
              </a>
            : line}
          {i < arr.length - 1 && '\n'}
        </span>
      ))}
    </div>
  )
}

export default function NotesTab() {
  const [notes, setNotes] = useState([])
  const [content, setContent] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => {
    api.getNotes().then(setNotes).catch(() => {})
  }, [])

  const showToast = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }

  const handleSave = async () => {
    if (!content.trim() || saving) return
    setSaving(true)
    try {
      const note = await api.createNote({ content, label })
      setNotes(prev => [note, ...prev])
      setContent('')
      setLabel('')
      showToast('Saved')
    } catch {
      showToast('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.deleteNote(id)
      setNotes(prev => prev.filter(n => n.id !== id))
    } catch {
      showToast('Failed to delete')
    }
  }

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text).then(() => showToast('Copied'))
  }

  return (
    <div className="px-4 pb-24" style={{ maxWidth: '42rem', margin: '0 auto' }}>

      {/* Input card */}
      <div style={{
        background: 'var(--s-surface)',
        border: '1px solid var(--s-border)',
        borderRadius: 10,
        padding: 14,
        display: 'flex', flexDirection: 'column', gap: 8,
        marginBottom: 16
      }}>
        <input
          type="text"
          placeholder="Label (optional)"
          value={label}
          onChange={e => setLabel(e.target.value)}
          style={{
            width: '100%', background: 'var(--s-surface-2)',
            border: '1px solid var(--s-border)', borderRadius: 6,
            padding: '7px 10px', fontSize: 12, color: 'var(--s-text-1)',
            fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box'
          }}
          onFocus={e => e.target.style.borderColor = 'var(--s-accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--s-border)'}
        />
        <textarea
          rows={4}
          placeholder="Paste text, links, notes… (⌘+Enter to save)"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave() }}
          style={{
            width: '100%', background: 'var(--s-surface-2)',
            border: '1px solid var(--s-border)', borderRadius: 6,
            padding: '7px 10px', fontSize: 13, color: 'var(--s-text-1)',
            fontFamily: 'inherit', outline: 'none', resize: 'none',
            lineHeight: 1.6, boxSizing: 'border-box'
          }}
          onFocus={e => e.target.style.borderColor = 'var(--s-accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--s-border)'}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSave}
            disabled={!content.trim() || saving}
            style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 12,
              background: content.trim() ? 'var(--s-accent)' : 'var(--s-surface-2)',
              color: content.trim() ? 'var(--s-bg)' : 'var(--s-text-3)',
              fontFamily: 'inherit', fontWeight: 500,
              opacity: saving ? 0.6 : 1,
              transition: 'background 0.15s, color 0.15s'
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 48, color: 'var(--s-text-3)', fontSize: 12, letterSpacing: '0.1em' }}>
          nothing saved yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <AnimatePresence initial={false}>
            {notes.map(note => (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                style={{
                  background: 'var(--s-surface)',
                  border: '1px solid var(--s-border)',
                  borderRadius: 10, padding: 14,
                  display: 'flex', flexDirection: 'column', gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {note.label && (
                      <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--s-accent)', marginBottom: 4 }}>
                        {note.label.toUpperCase()}
                      </div>
                    )}
                    <NoteContent content={note.content} />
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginTop: 2 }}>
                    <button
                      onClick={() => handleCopy(note.content)}
                      title="Copy"
                      style={{ padding: 6, borderRadius: 4, color: 'var(--s-text-3)', transition: 'color 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--s-text-1)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--s-text-3)'}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(note.id)}
                      title="Delete"
                      style={{ padding: 6, borderRadius: 4, color: 'var(--s-text-3)', transition: 'color 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#c0392b'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--s-text-3)'}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--s-text-3)', letterSpacing: '0.06em' }}>
                  {new Date(note.created_at).toLocaleString()}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', bottom: 'calc(2rem + env(safe-area-inset-bottom))',
              left: '50%', transform: 'translateX(-50%)',
              background: 'var(--s-surface-2)', border: '1px solid var(--s-border)',
              color: 'var(--s-text-1)', fontSize: 12, letterSpacing: '0.08em',
              padding: '8px 18px', borderRadius: 8, zIndex: 999, pointerEvents: 'none'
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
