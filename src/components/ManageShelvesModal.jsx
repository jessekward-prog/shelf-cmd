import { useState } from 'react'
import { motion, Reorder, AnimatePresence } from 'framer-motion'
import ShelfIcon from './ShelfIcons.jsx'
import { CollabIcon } from './MembersBar.jsx'

function DragHandle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 13h4" />
    </svg>
  )
}

function UnarchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M9 16l3-3 3 3" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

const iconBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
  color: 'var(--s-text-3)', background: 'transparent'
}

// A dedicated bottom-sheet for reordering shelves by touch (dragging pills in
// a horizontally-scrolling strip doesn't work well on a phone), plus the only
// place archive/delete live — there's nowhere else in the app to reach them.
export default function ManageShelvesModal({ categories, onClose, onReorder, onReorderEnd, onArchive, onDelete }) {
  const [confirmId, setConfirmId] = useState(null)
  const active = categories.filter(c => !c.archived)
  const archived = categories.filter(c => c.archived)

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        className="w-full max-w-md rounded-xl p-5"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--s-accent)' }}>manage shelves</p>
        <p className="text-xs mb-4" style={{ color: 'var(--s-text-3)', lineHeight: 1.5 }}>
          Drag to reorder. Archiving tucks a shelf away without deleting what's on it.
        </p>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          <Reorder.Group as="div" axis="y" values={active} onReorder={onReorder} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {active.map(cat => (
              <Reorder.Item
                key={cat.id} value={cat} as="div" onDragEnd={onReorderEnd}
                whileDrag={{ scale: 1.02, zIndex: 10 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 6px',
                  borderBottom: '1px solid var(--s-border)', cursor: 'grab'
                }}
              >
                <span style={{ color: 'var(--s-text-3)', touchAction: 'none' }}><DragHandle /></span>
                <ShelfIcon name={cat.icon} />
                <span className="truncate flex-1" style={{ fontSize: 13, color: 'var(--s-text-0)' }}>{cat.name}</span>
                {cat.is_collab && <CollabIcon size={11} />}
                <button style={iconBtn} title="Archive" onClick={() => onArchive(cat.id, true)}
                  onPointerDown={(e) => e.stopPropagation()}>
                  <ArchiveIcon />
                </button>
                {confirmId === cat.id ? (
                  <button
                    onClick={() => { onDelete(cat.id); setConfirmId(null) }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ fontSize: 10, padding: '4px 7px', borderRadius: 4, background: 'rgba(180,40,0,0.9)', color: '#fff', flexShrink: 0 }}
                  >
                    sure?
                  </button>
                ) : (
                  <button style={{ ...iconBtn, color: 'var(--s-text-3)' }} title="Delete"
                    onClick={() => setConfirmId(cat.id)} onPointerDown={(e) => e.stopPropagation()}>
                    <TrashIcon />
                  </button>
                )}
              </Reorder.Item>
            ))}
          </Reorder.Group>

          {archived.length > 0 && (
            <>
              <p style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--s-text-3)', margin: '16px 0 4px', textTransform: 'uppercase' }}>
                archived
              </p>
              {archived.map(cat => (
                <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 6px', borderBottom: '1px solid var(--s-border)', opacity: 0.6 }}>
                  <ShelfIcon name={cat.icon} />
                  <span className="truncate flex-1" style={{ fontSize: 13, color: 'var(--s-text-1)' }}>{cat.name}</span>
                  <button style={iconBtn} title="Unarchive" onClick={() => onArchive(cat.id, false)}>
                    <UnarchiveIcon />
                  </button>
                  {confirmId === cat.id ? (
                    <button
                      onClick={() => { onDelete(cat.id); setConfirmId(null) }}
                      style={{ fontSize: 10, padding: '4px 7px', borderRadius: 4, background: 'rgba(180,40,0,0.9)', color: '#fff', flexShrink: 0 }}
                    >
                      sure?
                    </button>
                  ) : (
                    <button style={{ ...iconBtn, color: 'var(--s-text-3)' }} title="Delete" onClick={() => setConfirmId(cat.id)}>
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-4 py-2 rounded-lg text-sm"
          style={{ border: '1px solid var(--s-border)', color: 'var(--s-text-2)' }}
        >
          done
        </button>
      </motion.div>
    </motion.div>
  )
}
