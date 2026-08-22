import { useState } from 'react'
import { motion, Reorder } from 'framer-motion'

import { CollabIcon } from './MembersBar.jsx'
import ShelfIcon from './ShelfIcons.jsx'

export default function CategoryNav({ categories, activeId, onSelect, onAdd, onReorder, onReorderEnd, onJoin, onShare }) {
  const [reordering, setReordering] = useState(false)

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
            dragListener={reordering}
            onClick={() => { if (!reordering) onSelect(cat.id) }}
            onDragEnd={onReorderEnd}
            whileTap={!reordering ? { scale: 0.93 } : undefined}
            whileDrag={{ scale: 1.05, zIndex: 10 }}
            className="relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium tracking-wide whitespace-nowrap flex-shrink-0"
            style={{
              background: active ? 'var(--s-accent-faint)' : 'transparent',
              color: active ? 'var(--s-accent)' : 'var(--s-text-2)',
              border: `1px solid ${active ? 'var(--s-accent)' : 'var(--s-border)'}`,
              cursor: reordering ? 'grab' : 'pointer'
            }}
          >
            <ShelfIcon name={cat.icon} size={16} />
            <span>{cat.name}</span>
            {cat.is_collab && <CollabIcon size={11} />}
            {active && !reordering && (
              <motion.div
                layoutId="cat-indicator"
                className="absolute inset-0 rounded-lg pointer-events-none"
                style={{ boxShadow: '0 0 12px var(--s-accent-glow)' }}
              />
            )}
          </Reorder.Item>
        )
      })}

      {/* Pull someone else's shelf into this one */}
      <motion.button
        onClick={onJoin}
        whileTap={{ scale: 0.93 }}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm whitespace-nowrap ml-1 flex-shrink-0"
        style={{ color: 'var(--s-accent)', border: '1px dashed var(--s-accent)' }}
      >
        <span className="text-base">+</span>
        <span>link</span>
      </motion.button>

      {/* Sharing is whole-shelf, so the invite sits on the shelf row, not the tab row */}
      {activeId && (
        <motion.button
          onClick={() => onShare(activeId)}
          whileTap={{ scale: 0.93 }}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm whitespace-nowrap ml-1 flex-shrink-0"
          style={{ color: 'var(--s-accent)', border: '1px dashed var(--s-accent)' }}
        >
          <CollabIcon size={12} />
          <span>invite</span>
        </motion.button>
      )}

      <motion.button
        onClick={onAdd}
        whileTap={{ scale: 0.93 }}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm whitespace-nowrap ml-1 flex-shrink-0"
        style={{ color: 'var(--s-border)', border: '1px dashed var(--s-border)' }}
      >
        <span className="text-base">+</span>
        <span>new</span>
      </motion.button>

      <motion.button
        onClick={() => setReordering(r => !r)}
        whileTap={{ scale: 0.93 }}
        className="flex items-center justify-center px-3 py-2 rounded-lg text-sm whitespace-nowrap ml-1 flex-shrink-0"
        title={reordering ? 'Done reordering' : 'Reorder'}
        style={{
          color: reordering ? 'var(--s-accent)' : 'var(--s-border)',
          border: `1px ${reordering ? 'solid' : 'dashed'} ${reordering ? 'var(--s-accent)' : 'var(--s-border)'}`
        }}
      >
        ⇄
      </motion.button>
    </Reorder.Group>
  )
}
