import { useState } from 'react'
import { motion } from 'framer-motion'

import ShelfIcon, { SHELF_ICONS } from './ShelfIcons.jsx'

export default function AddCategoryModal({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('folder')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    await onAdd(name.trim(), icon)
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        className="w-full max-w-sm rounded-xl p-5"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <p className="text-sm font-medium mb-4" style={{ color: 'var(--s-accent)' }}>new category</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 mb-1">
            {SHELF_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => setIcon(ic)}
                className="rounded-lg transition-all"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 34, height: 34,
                  color: icon === ic ? 'var(--s-accent)' : 'var(--s-text-2)',
                  background: icon === ic ? 'var(--s-accent-faint)' : 'var(--s-surface-2)',
                  border: `1px solid ${icon === ic ? 'var(--s-accent)' : 'transparent'}`
                }}
              >
                <ShelfIcon name={ic} size={17} />
              </button>
            ))}
          </div>

          <input
            autoFocus
            type="text"
            placeholder="category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{
              background: 'var(--s-bg)',
              border: '1px solid var(--s-border)',
              color: 'var(--s-text-1)',
              outline: 'none'
            }}
          />

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm"
              style={{ border: '1px solid var(--s-border)', color: 'var(--s-text-2)' }}
            >
              cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: 0.96 }}
              disabled={!name.trim()}
              className="flex-1 py-2 rounded-lg text-sm font-medium"
              style={{
                background: 'var(--s-accent)',
                color: 'var(--s-bg)',
                opacity: !name.trim() ? 0.4 : 1
              }}
            >
              create
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
