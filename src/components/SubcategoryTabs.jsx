import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function SubcategoryTabs({ subcategories, activeId, onSelect, onAdd, onDelete }) {
  const [hoverId, setHoverId] = useState(null)
  const [confirmId, setConfirmId] = useState(null)

  return (
    <div className="flex items-center gap-2 px-4 pb-4 overflow-x-auto no-scrollbar">
      <button
        onClick={() => { setConfirmId(null); onSelect(null) }}
        className="text-xs px-3 py-1 rounded transition-colors flex-shrink-0"
        style={{
          background: activeId === null ? 'var(--s-border)' : 'transparent',
          color: activeId === null ? 'var(--s-accent)' : 'var(--s-text-2)'
        }}
      >
        all
      </button>

      {subcategories.map((sub) => (
        <div
          key={sub.id}
          className="relative flex-shrink-0"
          onMouseEnter={() => setHoverId(sub.id)}
          onMouseLeave={() => { setHoverId(null); setConfirmId(null) }}
        >
          <button
            onClick={() => { setConfirmId(null); onSelect(sub.id) }}
            className="text-xs px-3 py-1 rounded whitespace-nowrap transition-colors"
            style={{
              paddingRight: hoverId === sub.id ? '1.5rem' : undefined,
              background: activeId === sub.id ? 'var(--s-border)' : 'transparent',
              color: activeId === sub.id ? 'var(--s-accent)' : 'var(--s-text-2)'
            }}
          >
            {sub.name}
          </button>

          <AnimatePresence>
            {hoverId === sub.id && confirmId !== sub.id && (
              <motion.button
                key="x"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.1 }}
                onClick={(e) => { e.stopPropagation(); setConfirmId(sub.id) }}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded text-xs"
                style={{ color: 'var(--s-text-2)' }}
              >
                ✕
              </motion.button>
            )}

            {confirmId === sub.id && (
              <motion.button
                key="confirm"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                onClick={(e) => { e.stopPropagation(); onDelete(sub.id); setConfirmId(null); setHoverId(null) }}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
                style={{ background: 'rgba(180,40,0,0.9)', color: '#fff', zIndex: 10 }}
              >
                delete?
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      ))}

      <button
        onClick={onAdd}
        className="text-xs px-2 py-1 rounded flex-shrink-0"
        style={{ color: 'var(--s-border)' }}
      >
        + tab
      </button>
    </div>
  )
}
