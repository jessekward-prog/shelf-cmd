import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

const inputStyle = {
  width: '100%', padding: '6px 8px', borderRadius: 4,
  background: 'var(--s-bg)', border: '1px solid var(--s-border)',
  color: 'var(--s-text-1)', fontFamily: 'inherit', fontSize: 11, outline: 'none'
}

// Every local runner worth listing speaks the same OpenAI-compatible shape
// (/v1/models, /v1/chat/completions) at its own default port, so a base URL
// for any of them just drops straight in here — nothing else in the backend
// needs to know or care which one it's talking to.
const LM_PRESETS = [
  { label: 'LM Studio', port: 1234, tab: 'Developer', field: '"Reachable at"' },
  { label: 'Ollama', port: 11434, tab: null, field: null },
  { label: 'text-generation-webui', port: 5000, tab: null, field: null }
]

function AiIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h.01M15 9h.01M9 15c.7.7 1.9 1 3 1s2.3-.3 3-1" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

// How to find each app's own address — the LM Studio steps name its actual UI
// (Developer tab, Status toggle, "Reachable at" field) so this reads as a
// real walkthrough, not a guess.
function Tutorial() {
  return (
    <div style={{
      fontSize: 10, lineHeight: 1.6, color: 'var(--s-text-2)',
      background: 'var(--s-bg)', border: '1px solid var(--s-border)', borderLeft: '2px solid var(--s-accent)',
      borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6
    }}>
      <div>
        <b style={{ color: 'var(--s-text-0)' }}>LM Studio</b> — open the app, go to the <b>Developer</b> tab,
        toggle <b>Status</b> to Running, then copy the address next to <b>"Reachable at"</b>.
      </div>
      <div>
        <b style={{ color: 'var(--s-text-0)' }}>Ollama</b> — runs on port 11434 automatically once it's
        installed; nothing to turn on.
      </div>
      <div>
        <b style={{ color: 'var(--s-text-0)' }}>text-generation-webui</b> — launch it with the <code>--api</code>{' '}
        flag; it listens on port 5000 by default, shown in its own console output.
      </div>
      <div style={{ borderTop: '1px solid var(--s-border)', paddingTop: 6 }}>
        That address is usually on <b>your computer</b>, not this server. If this instance runs in Docker,
        swap <code>localhost</code>/<code>127.0.0.1</code> for <code>host.docker.internal</code> so it can
        reach out of its container — or use your machine's real LAN IP if that doesn't resolve.
      </div>
    </div>
  )
}

// Own sidebar row (promoted out of the theme popover so a fresh self-host
// isn't hunting for it) — collapsed by default, opens upward since it sits
// near the bottom of the sidebar. Every field starts genuinely blank: this
// instance's own saved address only ever shows up here for its own admin to
// edit, never a guess and never anyone else's.
export default function MyAiPanel({ isAdmin }) {
  const [open, setOpen] = useState(false)
  const [lm, setLm] = useState(null)
  const [urlInput, setUrlInput] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [preset, setPreset] = useState(null)
  const [showTutorial, setShowTutorial] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (isAdmin) api.getLm().then(setLm).catch(err => setLm({ models: [], error: err.message }))
  }, [isAdmin])

  if (!isAdmin) return null

  const pick = async (model) => {
    const { selected } = await api.setLmModel(model)
    setLm(prev => ({ ...prev, selected }))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const saveConnection = async () => {
    if (!urlInput.trim()) return
    const updated = await api.setLmConnection(urlInput.trim(), apiKeyInput.trim())
    setApiKeyInput('')
    setPreset(null)
    setUrlInput('')
    setLm({ ...updated, models: [], selected: '' })
    api.getLm().then(setLm)
  }

  const connected = !!(lm && !lm.error)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="glow-focus"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 10px', borderRadius: 6, background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
          color: open ? 'var(--s-accent)' : 'var(--s-text-2)'
        }}
      >
        <AiIcon />
        <span className="flex-1" style={{ textAlign: 'left' }}>MY AI</span>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: connected ? '#3fb37f' : 'var(--s-border)'
        }} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'absolute', left: 8, right: 8, bottom: '100%', marginBottom: 6, zIndex: 50,
                background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 10,
                padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
                maxHeight: '70vh', overflowY: 'auto'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--s-text-3)', letterSpacing: '0.12em' }}>MY AI</span>
                <button
                  onClick={() => setShowTutorial(v => !v)}
                  title="how do I find my address?"
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: showTutorial ? 'var(--s-accent)' : 'var(--s-text-3)'
                  }}
                >
                  <InfoIcon />
                </button>
              </div>

              <span style={{ fontSize: 9, color: 'var(--s-text-3)', lineHeight: 1.4 }}>
                Powers scrape, plans, guides and the legend — points at your own local LM Studio, Ollama, or
                similar. Nothing is set here until you set it yourself.
              </span>

              {showTutorial && <Tutorial />}

              {lm && (
                <span style={{ fontSize: 9, color: 'var(--s-text-3)', lineHeight: 1.4 }}>
                  currently: {lm.url}
                  {lm.error && <span style={{ color: 'var(--s-text-2)' }}> — can't reach it: {lm.error}
                    {/401/.test(lm.error) && ' (wants an API key, below)'}</span>}
                </span>
              )}

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {LM_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => setPreset(p)}
                    style={{
                      fontSize: 9, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                      background: preset?.label === p.label ? 'var(--s-accent)' : 'var(--s-surface-2)',
                      border: '1px solid var(--s-border)', color: preset?.label === p.label ? 'var(--s-bg)' : 'var(--s-text-2)'
                    }}
                  >{p.label}</button>
                ))}
              </div>
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveConnection()}
                placeholder={preset ? `its address, e.g. http://host.docker.internal:${preset.port}` : 'its address — pick one above for an example'}
                style={inputStyle}
              />
              <input
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveConnection()}
                type="password"
                placeholder={lm?.apiKeySet ? 'API key (leave blank to keep current)' : 'API key (only if it needs one)'}
                style={inputStyle}
              />
              <button
                onClick={saveConnection}
                disabled={!urlInput.trim()}
                style={{
                  fontSize: 10, padding: '6px 10px', borderRadius: 4, cursor: urlInput.trim() ? 'pointer' : 'default',
                  background: 'var(--s-accent)', color: 'var(--s-bg)', opacity: urlInput.trim() ? 1 : 0.5
                }}
              >save</button>

              {connected && lm.models.length > 0 && (
                <>
                  <div style={{ borderTop: '1px solid var(--s-border)', margin: '2px 0' }} />
                  <span style={{ fontSize: 9, color: 'var(--s-text-3)', letterSpacing: '0.1em' }}>MODEL</span>
                  <select value={lm.selected || ''} onChange={(e) => pick(e.target.value)} style={inputStyle}>
                    <option value="">{lm.env_default ? `default (${lm.env_default})` : 'endpoint default'}</option>
                    {lm.models.map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                  {saved && <span style={{ fontSize: 9, color: 'var(--s-accent)' }}>model set</span>}
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
