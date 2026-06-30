import { motion, Reorder } from 'framer-motion'

export default function CategoryNav({ categories, activeId, onSelect, onAdd, onReorder, onReorderEnd }) {
  return (
    <Reorder.Group
      as="nav"
      axis="x"
      values={categories}
      onReorder={onReorder}
      className="flex items-center gap-1 px-4 pt-5 pb-3 overflow-x-auto no-scrollbar"
      style={{ listStyle: 'none', margin: 0, padding: '1.25rem 1rem 0.75rem' }}
    >
      {categories.map((cat) => {
        const active = cat.id === activeId
        return (
          <Reorder.Item
            key={cat.id}
            value={cat}
            as="div"
            onClick={() => onSelect(cat.id)}
            onDragEnd={onReorderEnd}
            whileTap={{ scale: 0.93 }}
            whileDrag={{ scale: 1.05, zIndex: 10 }}
            className="relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium tracking-wide whitespace-nowrap flex-shrink-0 cursor-grab active:cursor-grabbing"
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
          </Reorder.Item>
        )
      })}

      <motion.button
        onClick={onAdd}
        whileTap={{ scale: 0.93 }}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm whitespace-nowrap ml-1 flex-shrink-0"
        style={{ color: 'var(--s-border)', border: '1px dashed var(--s-border)' }}
      >
        <span className="text-base">+</span>
        <span>new</span>
      </motion.button>
    </Reorder.Group>
  )
}
