import { motion, AnimatePresence } from 'framer-motion'

export default function SearchBar({ value, onChange }) {
  return (
    <div className="relative mb-4">
      <svg
        viewBox="0 0 24 24"
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
        style={{ fill: value ? 'var(--s-accent)' : 'var(--s-border)' }}
      >
        <path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" stroke="currentColor" strokeWidth="2" fill="none"/>
      </svg>
      <input
        type="text"
        placeholder="search titles and descriptions…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-9 pr-8 py-2 rounded-lg text-sm"
        style={{
          background: 'var(--s-surface)',
          border: `1px solid ${value ? 'var(--s-accent)' : 'var(--s-border)'}`,
          color: 'var(--s-text-1)',
          outline: 'none',
          transition: 'border-color 0.15s'
        }}
      />
      <AnimatePresence>
        {value && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-xs"
            style={{ color: 'var(--s-text-2)' }}
          >
            ✕
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
