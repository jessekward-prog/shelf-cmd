import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

function fmtBytes(b) {
  if (!b) return '0 B'
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), s.length - 1)
  return `${(b / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${s[i]}`
}

const KIND_LABEL = { image: 'Image', video: 'Video', audio: 'Audio', pdf: 'PDF', doc: 'Document', archive: 'Archive', other: 'File' }

export default function FileCard({ file, onDelete, onShare }) {
  const [confirm, setConfirm] = useState(false)
  const pending = file.status === 'pending'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.03, zIndex: 5 }}
      transition={{ type: 'spring', damping: 24, stiffness: 320 }}
      className="rounded-xl overflow-hidden relative"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      {/* Thumbnail — opens the file in a new tab */}
      <a
        href={pending ? undefined : api.fileRawUrl(file.id)}
        target="_blank" rel="noreferrer"
        className="block relative group overflow-hidden"
        style={{ aspectRatio: '3 / 2', background: 'var(--s-surface-2)', cursor: pending ? 'default' : 'pointer' }}
      >
        {pending ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--s-border)', borderTopColor: 'var(--s-accent)' }} />
          </div>
        ) : file.has_thumb ? (
          <img src={api.fileThumbUrl(file.id)} alt="" loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            style={{ filter: 'brightness(0.9)' }} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: 'var(--s-border)' }}>
            {KIND_LABEL[file.kind] || 'File'}
          </div>
        )}
        <div className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded font-medium z-10"
          style={{ background: 'rgba(0,0,0,0.65)', color: 'var(--s-text-1)' }}>
          {KIND_LABEL[file.kind] || 'File'}
        </div>
        <div className="absolute bottom-2 right-2 text-xs px-2 py-0.5 rounded z-10"
          style={{ background: 'rgba(0,0,0,0.65)', color: 'var(--s-text-1)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtBytes(Number(file.size))}
        </div>
      </a>

      <div className="p-3">
        {/* The breadcrumb already says which folder you're in, so show the leaf
            name here and keep the full path on hover. */}
        <p className="text-sm font-medium leading-snug mb-1 line-clamp-1" style={{ color: 'var(--s-text-0)' }} title={file.name}>
          {file.name.split('/').pop()}
        </p>

        {pending ? (
          <p className="text-xs" style={{ color: 'var(--s-text-3)' }}>scanning…</p>
        ) : file.blurb ? (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--s-text-2)' }}>{file.blurb}</p>
        ) : (
          <p className="text-xs" style={{ color: 'var(--s-text-3)' }}>{KIND_LABEL[file.kind] || 'File'}</p>
        )}

        <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: '1px solid var(--s-surface-2)' }}>
          <div className="flex items-center gap-3">
            <a href={pending ? undefined : api.fileRawUrl(file.id, true)}
              className="text-xs" style={{ color: pending ? 'var(--s-border)' : 'var(--s-text-3)' }}>
              download
            </a>
            <button onClick={() => onShare(file)} disabled={pending}
              className="text-xs" style={{ color: pending ? 'var(--s-border)' : 'var(--s-accent)' }}>
              share
            </button>
          </div>

          <AnimatePresence mode="wait">
            {!confirm ? (
              <motion.button key="del" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setConfirm(true)} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--s-text-3)' }}>
                delete
              </motion.button>
            ) : (
              <motion.button key="ok" initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => onDelete(file.id)} className="text-xs px-2 py-1 rounded font-medium"
                style={{ background: 'rgba(180,40,0,0.85)', color: '#fff' }}>
                confirm
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
