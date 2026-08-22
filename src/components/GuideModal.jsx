import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import * as api from '../api.js'

// Paste a repo (or any) URL → the server writes a guide and hands back a
// standalone HTML document to open or download.
export default function GuideModal({ onClose, onSaved }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)   // { html, filename, title, chapters }
  const [blobUrl, setBlobUrl] = useState('')

  // Hold the generated file as an object URL for the open/download links.
  useEffect(() => {
    if (!result) return
    const u = URL.createObjectURL(new Blob([result.html], { type: 'text/html' }))
    setBlobUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [result])

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !/^https?:\/\/\S+$/.test(url.trim())) return
    setBusy(true); setError('')
    try {
      setResult(await api.generateGuide(url.trim()))
      onSaved && onSaved() // it's now saved to the Workspace — refresh the list
    } catch (err) {
      setError(err.message || 'could not generate a guide')
    }
    setBusy(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        className="w-full max-w-md rounded-xl p-5"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--s-accent)' }}>generate a guide</p>
        <p className="text-xs mb-4" style={{ color: 'var(--s-text-3)', lineHeight: 1.5 }}>
          Paste a GitHub repo — or any page — and ShelfStation writes a styled, standalone
          HTML user guide for it. It reads the README and fills sensible gaps.
        </p>

        {!result ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <input
              autoFocus type="url" inputMode="url"
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={(e) => { setError(''); setUrl(e.target.value) }}
              disabled={busy}
              className="w-full px-3 py-3 rounded-lg"
              style={{
                background: 'var(--s-bg)', border: '1px solid var(--s-border)',
                color: 'var(--s-text-1)', outline: 'none', fontFamily: 'inherit', fontSize: 14
              }}
            />

            {busy && (
              <div className="flex items-center gap-2 px-1 py-1" style={{ color: 'var(--s-text-2)' }}>
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                  style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--s-accent)', flexShrink: 0 }}
                />
                <span className="text-xs">Reading the source and writing your guide — a local model can take a minute or two.</span>
              </div>
            )}

            {error && <p className="text-xs" style={{ color: '#c0392b' }}>{error}</p>}

            <div className="flex gap-2 mt-1">
              <button
                type="button" onClick={onClose}
                className="flex-1 py-2 rounded-lg text-sm"
                style={{ border: '1px solid var(--s-border)', color: 'var(--s-text-2)' }}
              >
                cancel
              </button>
              <motion.button
                type="submit" disabled={busy || !/^https?:\/\/\S+$/.test(url.trim())}
                whileTap={{ scale: 0.96 }}
                className="flex-1 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: 'var(--s-accent)', color: 'var(--s-bg)',
                  opacity: !busy && /^https?:\/\/\S+$/.test(url.trim()) ? 1 : 0.4
                }}
              >
                {busy ? 'generating…' : 'generate'}
              </motion.button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg px-3 py-3" style={{ background: 'var(--s-bg)', border: '1px solid var(--s-border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--s-text-0)' }}>{result.title}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-3)' }}>
                {result.chapters} chapter{result.chapters === 1 ? '' : 's'} · standalone HTML
              </p>
            </div>

            <div className="flex gap-2">
              <a
                href={blobUrl} target="_blank" rel="noreferrer"
                className="flex-1 py-2 rounded-lg text-sm text-center"
                style={{ border: '1px solid var(--s-border)', color: 'var(--s-text-1)', textDecoration: 'none' }}
              >
                open
              </a>
              <a
                href={blobUrl} download={result.filename}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-center"
                style={{ background: 'var(--s-accent)', color: 'var(--s-bg)', textDecoration: 'none' }}
              >
                download
              </a>
            </div>

            <div className="flex gap-2 mt-1">
              <button
                type="button" onClick={() => { setResult(null); setError('') }}
                className="flex-1 py-2 rounded-lg text-sm"
                style={{ color: 'var(--s-text-3)' }}
              >
                make another
              </button>
              <button
                type="button" onClick={onClose}
                className="flex-1 py-2 rounded-lg text-sm"
                style={{ border: '1px solid var(--s-border)', color: 'var(--s-text-2)' }}
              >
                done
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
