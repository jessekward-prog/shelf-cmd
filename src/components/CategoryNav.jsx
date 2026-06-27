import { motion } from 'framer-motion'

export default function CategoryNav({ categories, activeId, onSelect, onAdd }) {
  return (
    <nav className="flex items-center gap-1 px-4 pt-5 pb-3 overflow-x-auto no-scrollbar">
      {categories.map((cat) => {
        const active = cat.id === activeId
        return (
          <motion.button
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            whileTap={{ scale: 0.93 }}
            className="relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium tracking-wide whitespace-nowrap transition-colors"
            style={{
              background: active ? 'var(--s-accent-faint)' : 'transparent',
              color: active ? 'var(--s-accent)' : 'var(--s-text-2)',
              border: `1px solid ${active ? 'var(--s-accent)' : 'var(--s-border)'}`
            }}
          >
            <span className="text-base leading-none">{cat.icon}</span>
            <span>{cat.name}</span>
            {active && (
              <motion.div
                layoutId="cat-indicator"
                className="absolute inset-0 rounded-lg pointer-events-none"
                style={{ boxShadow: '0 0 12px var(--s-accent-glow)' }}
              />
            )}
          </motion.button>
        )
      })}

      <motion.button
        onClick={onAdd}
        whileTap={{ scale: 0.93 }}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm whitespace-nowrap ml-1"
        style={{ color: 'var(--s-border)', border: '1px dashed var(--s-border)' }}
      >
        <span className="text-base">+</span>
        <span>new</span>
      </motion.button>
    </nav>
  )
}
