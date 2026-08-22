import { useState, useEffect } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { CollabIcon } from './MembersBar.jsx'
import ShelfIcon from './ShelfIcons.jsx'

function StarIcon({ filled }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polygon points="12 2 15.1 8.6 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.6 12 2" />
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: 'transform 0.18s', transform: open ? 'rotate(90deg)' : 'none' }}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

function GuidesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M4 5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  )
}

function NotesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8" />
    </svg>
  )
}

function ReorderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

/* Section labels share one style so the sidebar reads as a single scale, not five. */
const sectionLabel = {
  fontSize: 10, letterSpacing: '0.16em', color: 'var(--s-text-3)',
  padding: '0 12px', marginBottom: 6, display: 'block'
}

const rowBase = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
  padding: '7px 12px', borderRadius: 6, fontFamily: 'inherit',
  fontSize: 13, textAlign: 'left', cursor: 'pointer',
  transition: 'background 0.12s, color 0.12s'
}

function Row({ active, muted, children, ...rest }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      {...rest}
      className="glow-focus"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...rowBase,
        position: 'relative',
        background: active ? 'var(--s-accent-faint)' : hover ? 'var(--s-surface-2)' : 'transparent',
        color: active ? 'var(--s-accent)' : muted ? 'var(--s-text-3)' : hover ? 'var(--s-text-0)' : 'var(--s-text-2)',
        ...rest.style
      }}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          style={{
            position: 'absolute', left: 0, top: '50%', translateY: '-50%',
            width: 2, height: 18, borderRadius: 2, background: 'var(--s-accent)'
          }}
        />
      )}
      {children}
    </button>
  )
}

export default function Sidebar({
  categories, activeCatId, onSelectCat,
  subcategories, activeSubcatId, onSelectSub,
  onAddCat, onAddSub, onDeleteSub, onShareCat,
  onReorderCats, onReorderCatsEnd, onReorderSubs, onReorderSubsEnd,
  onJoin, activeView, onView, cardCount
}) {
  const [reordering, setReordering] = useState(false)
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shelf_favorites')) || [] } catch { return [] }
  })
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shelf_shelves_collapsed')) || false } catch { return false }
  })
  useEffect(() => { localStorage.setItem('shelf_favorites', JSON.stringify(favorites)) }, [favorites])
  useEffect(() => { localStorage.setItem('shelf_shelves_collapsed', JSON.stringify(collapsed)) }, [collapsed])
  const toggleFav = (id) =>
    setFavorites(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id])
  const [confirmSub, setConfirmSub] = useState(null)
  const [hoverSub, setHoverSub] = useState(null)
  const [hoverCat, setHoverCat] = useState(null)

  const inShelves = activeView === 'bookmarks'

  // Favourites sit at the top and survive collapsing; everything else hides.
  const favCats = categories.filter(c => favorites.includes(c.id))
  const restCats = categories.filter(c => !favorites.includes(c.id))
  const visibleCats = collapsed ? favCats : [...favCats, ...restCats]

  return (
    <aside
      className="hidden lg:flex flex-col shrink-0"
      style={{
        width: 240,
        background: 'var(--s-surface)',
        borderRight: '1px solid var(--s-border)',
        height: '100dvh', position: 'sticky', top: 0
      }}
    >
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <div className="flex items-center justify-between" style={{ padding: '0 12px', marginBottom: 6 }}>
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Show all shelves' : 'Collapse to favourites'}
            className="glow-focus"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: 0,
              fontSize: 13, letterSpacing: '0.12em', fontFamily: 'inherit',
              color: 'var(--s-text-0)', background: 'transparent'
            }}
          >
            <ChevronIcon open={!collapsed} />
            <span>SHELVES</span>
          </button>
          <button
            onClick={() => setReordering(r => !r)}
            title={reordering ? 'Done reordering' : 'Reorder shelves'}
            className="glow-focus"
            style={{
              display: 'flex', padding: 3, borderRadius: 4,
              color: reordering ? 'var(--s-accent)' : 'var(--s-text-3)'
            }}
          >
            <ReorderIcon />
          </button>
        </div>

        <Reorder.Group
          as="div"
          axis="y"
          values={visibleCats}
          onReorder={(next) => onReorderCats(collapsed ? [...next, ...restCats] : next)}
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {visibleCats.map((cat) => {
            const active = inShelves && cat.id === activeCatId
            const isFav = favorites.includes(cat.id)
            return (
              <Reorder.Item
                key={cat.id}
                value={cat}
                as="div"
                dragListener={reordering}
                onDragEnd={onReorderCatsEnd}
                whileDrag={{ scale: 1.02, zIndex: 10 }}
                style={{ marginBottom: 1, cursor: reordering ? 'grab' : 'auto' }}
              >
                {/* Sharing is whole-shelf, so the collab marker and the invite live here */}
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => !reordering && setHoverCat(cat.id)}
                  onMouseLeave={() => setHoverCat(null)}
                >
                  <Row
                    active={active}
                    onClick={() => { if (!reordering) { onView('bookmarks'); onSelectCat(cat.id) } }}
                    title={cat.name}
                    style={{ paddingRight: hoverCat === cat.id ? 52 : (isFav ? 26 : undefined) }}
                  >
                    <ShelfIcon name={cat.icon} />
                    <span className="truncate flex-1">{cat.name}</span>
                    {cat.is_collab && <CollabIcon size={11} />}
                    {active && <ChevronIcon open />}
                  </Row>

                  {(isFav || hoverCat === cat.id) && !reordering && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFav(cat.id) }}
                      title={isFav ? 'Remove from favourites' : 'Add to favourites'}
                      style={{
                        position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                        display: 'flex', padding: 3, borderRadius: 4,
                        color: isFav ? 'var(--s-accent)' : 'var(--s-text-3)'
                      }}
                    >
                      <StarIcon filled={isFav} />
                    </button>
                  )}

                  {hoverCat === cat.id && !reordering && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onShareCat(cat.id) }}
                      title="Get a code to share this shelf"
                      style={{
                        position: 'absolute', right: 28, top: '50%', transform: 'translateY(-50%)',
                        display: 'flex', padding: 3, borderRadius: 4, color: 'var(--s-accent)'
                      }}
                    >
                      <CollabIcon size={12} />
                    </button>
                  )}
                </div>

                {/* Tabs live under their shelf so both levels of the hierarchy are on screen at once */}
                <AnimatePresence initial={false}>
                  {active && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div style={{ marginLeft: 16, paddingLeft: 10, borderLeft: '1px solid var(--s-border)', margin: '2px 0 6px 22px' }}>
                        {subcategories.length > 0 && (
                          <Row
                            active={activeSubcatId === null}
                            onClick={() => onSelectSub(null)}
                            style={{ fontSize: 12, padding: '5px 10px' }}
                          >
                            <span className="truncate flex-1">all</span>
                            <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>{cardCount}</span>
                          </Row>
                        )}

                        <Reorder.Group
                          as="div" axis="y" values={subcategories} onReorder={onReorderSubs}
                          style={{ listStyle: 'none', margin: 0, padding: 0 }}
                        >
                          {subcategories.map(sub => (
                            <Reorder.Item
                              key={sub.id}
                              value={sub}
                              as="div"
                              dragListener={reordering}
                              onDragEnd={onReorderSubsEnd}
                              whileDrag={{ scale: 1.02, zIndex: 10 }}
                              style={{ position: 'relative' }}
                              onMouseEnter={() => !reordering && setHoverSub(sub.id)}
                              onMouseLeave={() => { setHoverSub(null); setConfirmSub(null) }}
                            >
                              <Row
                                active={activeSubcatId === sub.id}
                                onClick={() => { if (!reordering) { setConfirmSub(null); onSelectSub(sub.id) } }}
                                style={{ fontSize: 12, padding: '5px 10px', paddingRight: hoverSub === sub.id ? 44 : 10 }}
                                title={sub.name}
                              >
                                <span className="truncate flex-1">{sub.name}</span>
                              </Row>

                              {hoverSub === sub.id && !reordering && (
                                <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 2 }}>
                                  {confirmSub === sub.id ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); onDeleteSub(sub.id); setConfirmSub(null) }}
                                      style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: 'rgba(180,40,0,0.9)', color: '#fff' }}
                                    >
                                      sure?
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setConfirmSub(sub.id) }}
                                      title="Delete tab"
                                      style={{ fontSize: 11, padding: '1px 4px', borderRadius: 4, color: 'var(--s-text-3)' }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              )}
                            </Reorder.Item>
                          ))}
                        </Reorder.Group>

                        <Row muted onClick={onAddSub} style={{ fontSize: 12, padding: '5px 10px' }}>
                          <span>+ tab</span>
                        </Row>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Reorder.Item>
            )
          })}
        </Reorder.Group>

        <Row muted onClick={onAddCat} style={{ marginTop: 4 }}>
          <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>+</span>
          <span>new shelf</span>
        </Row>

        <>
          <div style={{ borderTop: '1px solid var(--s-border)', margin: '16px 8px 12px' }} />
          <span style={sectionLabel}>WORKSPACE</span>
          <Row active={activeView === 'notes'} onClick={() => onView('notes')}>
            <NotesIcon />
            <span>Notes</span>
          </Row>
          <Row active={activeView === 'guides'} onClick={() => onView('guides')}>
            <GuidesIcon />
            <span>Guides</span>
          </Row>
          <Row muted onClick={onJoin}>
            <CollabIcon size={14} />
            <span>Link a shared shelf</span>
          </Row>
        </>
      </nav>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--s-border)' }}>
        <div className="flex items-baseline justify-between" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--s-text-3)' }}>
          <span>SHELVES</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--s-text-2)' }}>{categories.length}</span>
        </div>
        <div className="flex items-baseline justify-between" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--s-text-3)', marginTop: 4 }}>
          <span>CARDS HERE</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--s-text-2)' }}>{cardCount}</span>
        </div>
      </div>
    </aside>
  )
}
