import { AnimatePresence, motion } from 'framer-motion'
import Card from './Card.jsx'

/* Empty states are dead ends unless they carry the action that fills them. */
function EmptyAction({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="glow-focus mt-4"
      style={{
        padding: '7px 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12,
        color: 'var(--s-accent)', border: '1px solid var(--s-accent)',
        background: 'transparent', transition: 'background 0.15s'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--s-accent-faint)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

export default function CardGrid({ cards, onDelete, onUpdate, search, onAdd, onClearSearch, nowPlayingId, onPlay, onPop, poppedId, canEdit = () => true, canServerAI = true }) {
  if (cards.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-24 text-center px-4"
      >
        <p className="text-2xl mb-3" style={{ opacity: 0.2 }}>◻</p>
        {search ? (
          <>
            <p className="text-sm" style={{ color: 'var(--s-border)' }}>no results for "{search}"</p>
            <p className="text-xs mt-1" style={{ color: 'var(--s-surface-2)' }}>try different words</p>
            {onClearSearch && <EmptyAction onClick={onClearSearch}>clear search</EmptyAction>}
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--s-border)' }}>nothing here yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--s-surface-2)' }}>links, videos and notes all live on a shelf</p>
            {onAdd && <EmptyAction onClick={onAdd}>+ add your first card</EmptyAction>}
          </>
        )}
      </motion.div>
    )
  }

  return (
    <div className="grid gap-3 px-4 pb-24 lg:gap-5 lg:px-8 lg:pb-10" style={{
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))'
    }}>
      <AnimatePresence mode="popLayout">
        {cards.map((card, i) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: Math.min(i, 12) * 0.03 }}
          >
            <Card card={card} onDelete={onDelete} onUpdate={onUpdate} nowPlayingId={nowPlayingId} onPlay={onPlay} onPop={onPop} isPopped={poppedId === card.id} canEdit={canEdit(card)} canServerAI={canServerAI} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
