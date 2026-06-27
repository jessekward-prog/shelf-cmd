import { AnimatePresence, motion } from 'framer-motion'
import Card from './Card.jsx'

export default function CardGrid({ cards, onDelete, onUpdate, search }) {
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
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--s-border)' }}>nothing here yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--s-surface-2)' }}>tap + to add your first card</p>
          </>
        )}
      </motion.div>
    )
  }

  return (
    <div className="grid gap-3 px-4 pb-24" style={{
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))'
    }}>
      <AnimatePresence mode="popLayout">
        {cards.map((card, i) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: i * 0.03 }}
          >
            <Card card={card} onDelete={onDelete} onUpdate={onUpdate} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
