import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

function fmtBytes(b) {
  if (!b) return '0 B'
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), s.length - 1)
  return `${(b / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${s[i]}`
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// The PlayStation triangle-button green — a deliberate one-off accent for
// this one piece of metadata, not a theme color, so it stays put across
// every CRT/clean palette instead of shifting with var(--s-accent).
const PS_GREEN = '#1FAA8C'

export default function FolderCard({ folder, onOpen, onDelete, onShare }) {
  const [confirm, setConfirm] = useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.03, zIndex: 5 }}
      transition={{ type: 'spring', damping: 24, stiffness: 320 }}
      className="rounded-xl overflow-hidden relative"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      <button
        onClick={() => onOpen(folder.prefix)}
        className="block w-full relative group overflow-hidden"
        style={{ aspectRatio: '3 / 2', background: 'var(--s-surface-2)', cursor: 'pointer' }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="var(--s-accent)"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            className="transition-transform duration-300 group-hover:scale-110">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--s-text-3)' }}>FOLDER</span>
        </div>
        <div className="absolute bottom-2 right-2 text-xs px-2 py-0.5 rounded z-10"
          style={{ background: 'rgba(0,0,0,0.65)', color: 'var(--s-text-1)', fontVariantNumeric: 'tabular-nums' }}>
          {folder.count} {folder.count === 1 ? 'file' : 'files'}
        </div>
      </button>

      <div className="p-3">
        <p className="text-sm font-medium leading-snug mb-1 line-clamp-1"
          style={{ color: 'var(--s-text-0)' }} title={folder.name}>
          {folder.name}
        </p>
        <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--s-text-2)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtBytes(folder.size)}
          {folder.updatedAt && (
            <>
              <span style={{ color: 'var(--s-border)' }}>·</span>
              <span style={{ color: PS_GREEN }}>updated {timeAgo(folder.updatedAt)}</span>
            </>
          )}
        </p>

        <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: '1px solid var(--s-surface-2)' }}>
          <div className="flex items-center gap-3">
            <a href={api.folderZipUrl(folder.categoryId, folder.prefix)}
              className="text-xs" style={{ color: 'var(--s-text-3)' }}>
              download zip
            </a>
            <button onClick={() => onShare(folder)} className="text-xs" style={{ color: 'var(--s-accent)' }}>
              share
            </button>
          </div>

          <AnimatePresence mode="wait">
            {!confirm ? (
              <motion.button key="del" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setConfirm(true)} title="Delete" className="p-1.5 rounded" style={{ color: '#c0392b' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </motion.button>
            ) : (
              <motion.button key="ok" initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => onDelete(folder)} className="text-xs px-2 py-1 rounded font-medium"
                style={{ background: 'rgba(180,40,0,0.85)', color: '#fff' }}>
                delete {folder.count}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
