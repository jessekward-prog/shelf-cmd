import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import * as api from '../api.js'

// Shares a file by default; pass getLink to share something else (e.g. a folder).
export default function ShareModal({ file, onClose, getLink, note }) {
  const [url, setUrl] = useState(null)
  const [qr, setQr] = useState(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const resolve = getLink
      ? getLink()
      : api.shareFile(file.id).then(({ token }) => api.shareUrl(token))
    resolve
      .then(async (link) => {
        if (!alive) return
        setUrl(link)
        const QRCode = (await import('qrcode')).default
        const data = await QRCode.toDataURL(link, {
          margin: 1, width: 320,
          color: { dark: '#e8840a', light: '#0e0a00' }
        })
        if (alive) setQr(data)
      })
      .catch(() => alive && setError('could not make a share link'))
    return () => { alive = false }
  }, [file.id, file.name])

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
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
        className="w-full max-w-sm rounded-xl p-5"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--s-accent)' }}>share this file</p>
        <p className="text-xs mb-4 truncate" style={{ color: 'var(--s-text-3)' }}>{file.name}</p>

        {error ? (
          <p className="text-xs" style={{ color: '#c0392b' }}>{error}</p>
        ) : (
          <>
            <div className="flex justify-center mb-4" style={{ minHeight: 200 }}>
              {qr
                ? <img src={qr} alt="QR code" width={200} height={200}
                    style={{ border: '1px solid var(--s-border)', borderRadius: 8 }} />
                : <div className="flex items-center justify-center" style={{ width: 200, height: 200 }}>
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                      style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--s-border)', borderTopColor: 'var(--s-accent)' }} />
                  </div>}
            </div>

            <div className="flex items-center gap-2">
              <input readOnly value={url || 'making link…'} onFocus={(e) => e.target.select()}
                className="flex-1 px-2 py-1.5 text-xs rounded truncate"
                style={{ background: 'var(--s-bg)', border: '1px solid var(--s-border)', color: 'var(--s-text-1)', outline: 'none' }} />
              <button onClick={copy} disabled={!url}
                className="text-xs px-3 py-1.5 rounded flex-shrink-0"
                style={{ background: 'var(--s-accent)', color: 'var(--s-bg)' }}>
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--s-text-3)', lineHeight: 1.5 }}>
              {note || 'Anyone with this link can download the file.'} Scan the code to open it on a phone.
            </p>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
