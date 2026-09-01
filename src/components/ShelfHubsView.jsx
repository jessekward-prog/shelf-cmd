import { useState, useEffect } from 'react'
import * as api from '../api.js'

const inputStyle = {
  padding: '7px 10px', borderRadius: 6,
  background: 'var(--s-bg)', border: '1px solid var(--s-border)',
  color: 'var(--s-text-1)', fontFamily: 'inherit', fontSize: 13, outline: 'none'
}

const cardStyle = {
  border: '1px solid var(--s-border)', borderRadius: 10, padding: 16,
  background: 'var(--s-surface)', marginBottom: 16
}

const codeStyle = {
  fontFamily: 'inherit', background: 'var(--s-surface-2)', border: '1px solid var(--s-border)',
  borderRadius: 4, padding: '1px 5px', fontSize: '0.92em', color: 'var(--s-text-0)'
}

const smallBtn = {
  padding: '7px 14px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
  background: 'var(--s-accent)', color: 'var(--s-bg)', flexShrink: 0
}

function CopyField({ value }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input readOnly value={value} onFocus={(e) => e.target.select()} style={{ ...inputStyle, flex: 1 }} />
      <button onClick={copy} style={smallBtn}>{copied ? 'copied' : 'copy'}</button>
    </div>
  )
}

// Toggleable hosting for THIS instance's own hub, a picker for which hub this
// instance shares through, and a directory of hubs known about (the one it's
// hosting, plus any external ones added by hand). Server side: hosted-hub.js
// (the embedded hub, gated by the hosted_hub_enabled setting) and the
// /api/hub-config + /api/known-hubs routes in index.js.
export default function ShelfHubsView({ isAdmin }) {
  const [config, setConfig] = useState(null) // null = loading
  const [hubs, setHubs] = useState(null)
  const [qr, setQr] = useState(null)
  const [toggling, setToggling] = useState(false)
  const [sharingInput, setSharingInput] = useState('')
  const [savedSharing, setSavedSharing] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const load = () => {
    api.getHubConfig().then((c) => { setConfig(c); setSharingInput(c.sharingHubUrl) }).catch(() => setConfig({ error: true }))
    api.getKnownHubs().then(setHubs).catch(() => setHubs([]))
  }
  useEffect(load, [])

  useEffect(() => {
    if (!config?.hostedHubEnabled || !config.hostedHubUrl) { setQr(null); return }
    let alive = true
    import('qrcode').then(({ default: QRCode }) =>
      QRCode.toDataURL(config.hostedHubUrl, { margin: 1, width: 240, color: { dark: '#e8840a', light: '#0e0a00' } })
        .then((data) => alive && setQr(data))
    )
    return () => { alive = false }
  }, [config?.hostedHubEnabled, config?.hostedHubUrl])

  const toggleHosting = async () => {
    setToggling(true)
    try { await api.setHubConfig({ hostedHubEnabled: !config.hostedHubEnabled }); load() }
    finally { setToggling(false) }
  }

  const saveSharing = async (url) => {
    await api.setHubConfig({ sharingHubUrl: url })
    setSavedSharing(true)
    setTimeout(() => setSavedSharing(false), 1500)
    load()
  }

  const addHub = async (e) => {
    e.preventDefault()
    if (!newLabel.trim() || !newUrl.trim()) return
    await api.addKnownHub(newLabel.trim(), newUrl.trim())
    setNewLabel(''); setNewUrl('')
    api.getKnownHubs().then(setHubs)
  }

  const removeHub = async (id) => {
    await api.deleteKnownHub(id)
    api.getKnownHubs().then(setHubs)
  }

  if (!isAdmin) {
    return (
      <div className="px-4 pb-24" style={{ maxWidth: '46rem', margin: '0 auto', textAlign: 'center', paddingTop: 48, color: 'var(--s-text-3)', fontSize: 12, letterSpacing: '0.05em' }}>
        only the instance admin can manage hubs
      </div>
    )
  }

  if (config === null) {
    return (
      <div className="px-4 pb-24" style={{ maxWidth: '46rem', margin: '0 auto', textAlign: 'center', paddingTop: 48, color: 'var(--s-text-3)', fontSize: 12, letterSpacing: '0.1em' }}>
        loading…
      </div>
    )
  }

  return (
    <div className="px-4 pb-24" style={{ maxWidth: '46rem', margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 15, color: 'var(--s-text-0)', fontWeight: 500 }}>Shelf Hubs</div>
        <div style={{ fontSize: 11, color: 'var(--s-text-3)', letterSpacing: '0.04em', marginTop: 2 }}>
          Sharing routes through a hub — a small always-online relay. Host your own here, or pick which one this instance uses.
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--s-text-0)', fontWeight: 500 }}>this instance's hub</div>
          <button
            onClick={toggleHosting}
            disabled={toggling}
            title={config.hostedHubEnabled ? 'turn off' : 'turn on'}
            style={{
              width: 40, height: 22, borderRadius: 999, position: 'relative', flexShrink: 0,
              background: config.hostedHubEnabled ? 'var(--s-accent)' : 'var(--s-border)',
              opacity: toggling ? 0.6 : 1, transition: 'background 0.15s'
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: config.hostedHubEnabled ? 20 : 2,
              width: 18, height: 18, borderRadius: '50%', background: 'var(--s-bg)', transition: 'left 0.15s'
            }} />
          </button>
        </div>

        {config.hostedHubEnabled ? (
          !config.publicUrlSet ? (
            <div style={{ fontSize: 12, color: 'var(--s-text-2)', lineHeight: 1.6 }}>
              on, but not reachable yet — set <code style={codeStyle}>PUBLIC_URL</code> to a real address in <code style={codeStyle}>.env</code> first.
            </div>
          ) : (
            <>
              <CopyField value={config.hostedHubUrl} />
              {qr && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                  <img src={qr} width={140} height={140} alt="hub QR code" style={{ border: '1px solid var(--s-border)', borderRadius: 8 }} />
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--s-text-3)', marginTop: 10, lineHeight: 1.5 }}>
                Hand this URL to anyone who wants to point their own instance at your hub instead of the default.
              </div>
            </>
          )
        ) : (
          <div style={{ fontSize: 12, color: 'var(--s-text-3)' }}>off — flip it on to let other people's instances share through this one.</div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--s-text-0)', fontWeight: 500, marginBottom: 10 }}>sharing through</div>
        <div style={{ fontSize: 11, color: 'var(--s-text-3)', marginBottom: 10, lineHeight: 1.5 }}>
          {config.isDefault ? 'using the built-in default hub.' : 'using a custom hub.'} Everyone you share a shelf with needs to be pointed at this same one.
        </div>
        <form onSubmit={(e) => { e.preventDefault(); saveSharing(sharingInput.trim()) }} style={{ display: 'flex', gap: 8 }}>
          <input value={sharingInput} onChange={(e) => setSharingInput(e.target.value)} placeholder="hub URL" style={{ ...inputStyle, flex: 1 }} />
          <button type="submit" style={smallBtn}>{savedSharing ? 'saved' : 'use this'}</button>
        </form>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--s-text-0)', fontWeight: 500, marginBottom: 10 }}>your hubs</div>
        {hubs === null ? (
          <div style={{ fontSize: 12, color: 'var(--s-text-3)' }}>loading…</div>
        ) : hubs.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--s-text-3)', marginBottom: 14 }}>none saved yet — add one below, or turn on hosting above.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {hubs.map((h) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, background: 'var(--s-surface-2)', border: '1px solid var(--s-border)' }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                  color: h.kind === 'hosted' ? 'var(--s-accent)' : 'var(--s-text-2)',
                  border: `1px solid ${h.kind === 'hosted' ? 'var(--s-accent)' : 'var(--s-border)'}`
                }}>{h.kind}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--s-text-0)' }}>{h.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--s-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.url}</div>
                </div>
                <button onClick={() => saveSharing(h.url)} style={{ fontSize: 11, color: 'var(--s-text-2)', padding: '4px 8px', flexShrink: 0 }}>use</button>
                {h.kind !== 'hosted' && (
                  <button onClick={() => removeHub(h.id)} style={{ fontSize: 14, color: 'var(--s-text-3)', padding: '4px 6px', flexShrink: 0 }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addHub} style={{ display: 'flex', gap: 8 }}>
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="label" style={{ ...inputStyle, flex: '0 0 30%' }} />
          <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://…" style={{ ...inputStyle, flex: 1 }} />
          <button type="submit" style={{ ...smallBtn, background: 'transparent', border: '1px solid var(--s-border)', color: 'var(--s-text-2)' }}>add</button>
        </form>

        <div style={{ fontSize: 11, color: 'var(--s-text-3)', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--s-border)', lineHeight: 1.6 }}>
          Want an always-on hub without hosting it yourself? Deploy{' '}
          <a href="https://github.com/jessekward-prog/shelf-hub" target="_blank" rel="noreferrer" style={{ color: 'var(--s-accent)' }}>shelf-hub</a>
          {' '}to Railway (or anywhere), then add its URL above.
        </div>
      </div>
    </div>
  )
}
