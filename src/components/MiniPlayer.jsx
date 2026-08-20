import { useRef } from 'react'
import { motion } from 'framer-motion'

// A YouTube-style pop-out: a card's media lifted to a floating, draggable player
// that keeps going while you move around the app. Rendered at the App root so it
// survives shelf/tab changes that unmount the original card.
export default function MiniPlayer({ card, onClose }) {
  const constraints = useRef(null)
  if (!card) return null

  const embedUrl = card.metadata?.embed_url
  const aspect = card.metadata?.aspect
  const isAudio = aspect === 'audio'
  const isPortrait = aspect === '9:16'
  const isSquare = aspect === '1:1'
  const paddingBottom = isPortrait ? '177.78%' : isSquare ? '100%' : '56.25%'

  // Portrait clips would be far too tall floating — cap the width so they fit.
  const width = isPortrait ? 210 : isAudio ? 320 : 340

  return (
    // Full-viewport layer the player can be dragged around within, but that lets
    // clicks through everywhere except the player itself.
    <div ref={constraints} className="fixed inset-0 z-50" style={{ pointerEvents: 'none' }}
      // Keep it clear of the mobile dock / safe area
      >
      <motion.div
        drag
        dragConstraints={constraints}
        dragMomentum={false}
        dragElastic={0.04}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="absolute rounded-xl overflow-hidden"
        style={{
          pointerEvents: 'auto',
          right: 16,
          bottom: 'var(--s-dock, 16px)',
          width,
          maxWidth: 'calc(100vw - 2rem)',
          background: 'var(--s-surface)',
          border: '1px solid var(--s-accent)',
          boxShadow: '0 0 24px var(--s-accent-glow), 0 12px 32px rgba(0,0,0,0.5)'
        }}
      >
        {/* Drag handle / title bar */}
        <div className="flex items-center gap-2 px-2.5 py-1.5"
          style={{ background: 'var(--s-bg)', borderBottom: '1px solid var(--s-border)', cursor: 'grab' }}>
          <svg viewBox="0 0 24 24" width="12" height="12" style={{ flexShrink: 0, opacity: 0.6 }} fill="var(--s-text-2)">
            <circle cx="7" cy="7" r="1.4" /><circle cx="7" cy="12" r="1.4" /><circle cx="7" cy="17" r="1.4" />
            <circle cx="13" cy="7" r="1.4" /><circle cx="13" cy="12" r="1.4" /><circle cx="13" cy="17" r="1.4" />
          </svg>
          <span className="text-xs truncate flex-1" style={{ color: 'var(--s-text-1)' }} title={card.title}>
            {card.title || 'playing'}
          </span>
          <button onClick={onClose} aria-label="Close mini player"
            className="flex items-center justify-center w-6 h-6 rounded flex-shrink-0"
            style={{ color: 'var(--s-text-2)' }}
            onPointerDownCapture={(e) => e.stopPropagation()}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* The media itself */}
        {isAudio ? (
          <div style={{ height: 90, position: 'relative' }}>
            <iframe src={embedUrl} allow="autoplay" style={{ width: '100%', height: '100%', border: 0 }} />
          </div>
        ) : (
          <div style={{ position: 'relative', paddingBottom }}>
            <iframe
              src={embedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            />
          </div>
        )}
      </motion.div>
    </div>
  )
}
