import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function AddCardModal({ categoryId, subcategories, onAdd, onClose }) {
  const [url, setUrl] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [showImageField, setShowImageField] = useState(false)
  const [subcatId, setSubcatId] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!url.trim()) return
    onAdd({
      url: url.trim(),
      category_id: categoryId,
      subcategory_id: subcatId || null,
      thumbnail_url: imageUrl.trim() || undefined
    })
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        className="w-full max-w-md rounded-xl p-5"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <p className="text-sm font-medium mb-4" style={{ color: 'var(--s-accent)' }}>
          paste a link
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            type="url"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--s-bg)', border: '1px solid var(--s-border)', color: 'var(--s-text-1)', outline: 'none' }}
          />

          <AnimatePresence>
            {showImageField && (
              <motion.input
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                type="url"
                placeholder="image url (optional)…"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--s-bg)', border: '1px solid var(--s-border)', color: 'var(--s-text-1)', outline: 'none' }}
              />
            )}
          </AnimatePresence>

          {subcategories.length > 0 && (
            <select
              value={subcatId}
              onChange={(e) => setSubcatId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: 'var(--s-bg)',
                border: '1px solid var(--s-border)',
                color: subcatId ? 'var(--s-text-1)' : 'var(--s-border)',
                outline: 'none'
              }}
            >
              <option value="">no tab</option>
              {subcategories.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setShowImageField((v) => !v)}
            className="text-xs text-left"
            style={{ color: 'var(--s-border)' }}
          >
            {showImageField ? '− hide image url' : '+ add image url manually'}
          </button>

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
              disabled={!url.trim()}
              whileTap={{ scale: 0.96 }}
              className="flex-1 py-2 rounded-lg text-sm font-medium"
              style={{
                background: 'var(--s-accent)',
                color: 'var(--s-bg)',
                opacity: !url.trim() ? 0.4 : 1
              }}
            >
              add
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
