import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CategoryNav from './components/CategoryNav.jsx'
import SubcategoryTabs from './components/SubcategoryTabs.jsx'
import CardGrid from './components/CardGrid.jsx'
import SearchBar from './components/SearchBar.jsx'
import AddCardModal from './components/AddCardModal.jsx'
import AddCategoryModal from './components/AddCategoryModal.jsx'
import ThemePicker from './components/ThemePicker.jsx'
import NotesTab from './components/NotesTab.jsx'
import MembersBar from './components/MembersBar.jsx'
import * as api from './api.js'
import { hasAI, buildCard } from './ai.js'
import { getSavedTheme, applyTheme, getSavedIntensity, applyIntensity } from './themes.js'

export default function App({ me }) {
  const isAdmin = me.is_admin
  const [user, setUser] = useState(me)
  const [theme, setTheme] = useState(getSavedTheme)
  const [building, setBuilding] = useState(null)
  const [categories, setCategories] = useState([])
  const [activeCatId, setActiveCatId] = useState(null)
  const [subcategories, setSubcategories] = useState([])
  const [activeSubcatId, setActiveSubcatId] = useState(null)
  const [cards, setCards] = useState([])
  const [search, setSearch] = useState('')
  const [showAddCard, setShowAddCard] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [direction, setDirection] = useState(1)
  const [activeView, setActiveView] = useState('bookmarks')
  const [nowPlaying, setNowPlaying] = useState(null)
  const pollTimers = useRef({})
  const latestCats = useRef([])
  const latestSubs = useRef([])

  const startPolling = useCallback((id) => {
    if (pollTimers.current[id]) return
    pollTimers.current[id] = setInterval(async () => {
      try {
        const card = await api.getCard(id)
        if (card.status === 'ready') {
          clearInterval(pollTimers.current[id])
          delete pollTimers.current[id]
          setCards(prev => prev.map(c => c.id === id ? card : c))
        }
      } catch {
        clearInterval(pollTimers.current[id])
        delete pollTimers.current[id]
      }
    }, 2000)
  }, [])

  // For a collaborator there is no category layer — each shelf they joined *is* the top level.
  const loadCards = useCallback((catId, subcatId) => {
    const request = isAdmin ? api.getCards(catId, subcatId) : api.getShelfCards(catId)
    request.then(loaded => {
      setCards(loaded)
      loaded.filter(c => c.status === 'pending').forEach(c => startPolling(c.id))
    })
  }, [startPolling, isAdmin])

  useEffect(() => {
    applyTheme(theme)
    applyIntensity(getSavedIntensity(), theme)
  }, [])

  useEffect(() => {
    const load = isAdmin
      ? api.getCategories()
      : api.getMyShelves().then(shelves => shelves.map(s => ({ id: s.id, name: s.name, icon: null })))
    load.then((cats) => {
      setCategories(cats)
      if (cats.length) setActiveCatId(cats[0].id)
    })
  }, [isAdmin])

  useEffect(() => {
    if (!activeCatId) return
    setActiveSubcatId(null)
    setSearch('')
    if (isAdmin) api.getSubcategories(activeCatId).then(setSubcategories)
    loadCards(activeCatId, null)
  }, [activeCatId])

  useEffect(() => {
    if (!activeCatId) return
    setSearch('')
    loadCards(activeCatId, activeSubcatId)
  }, [activeSubcatId])

  useEffect(() => {
    if (nowPlaying && !cards.some(c => c.id === nowPlaying.id)) setNowPlaying(null)
  }, [cards])

  const filteredCards = search.trim()
    ? cards.filter((c) => {
        const q = search.toLowerCase()
        return (
          c.title?.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.notes?.toLowerCase().includes(q)
        )
      })
    : cards

  const selectCategory = (id) => {
    const ci = categories.findIndex((c) => c.id === activeCatId)
    const ni = categories.findIndex((c) => c.id === id)
    setDirection(ni > ci ? 1 : -1)
    setActiveCatId(id)
  }

  const handleAddCategory = async (name, icon) => {
    const cat = await api.createCategory(name, icon)
    setCategories((prev) => [...prev, cat])
    setDirection(1)
    setActiveCatId(cat.id)
  }

  const handleAddSubcategory = async () => {
    const name = window.prompt('Tab name:')
    if (!name?.trim()) return
    const sub = await api.createSubcategory(activeCatId, name.trim())
    setSubcategories((prev) => [...prev, sub])
  }

  // A collaborator's only surface is the shelf itself, so their posts always land in it.
  const activeShelfId = isAdmin
    ? (subcategories.find(s => s.id === activeSubcatId)?.is_collab ? activeSubcatId : null)
    : activeCatId

  const handleAddCard = async (data) => {
    const targetSub = isAdmin ? (data.subcategory_id || activeSubcatId) : activeCatId
    const isCollabTarget = isAdmin
      ? !!subcategories.find(s => s.id === Number(targetSub))?.is_collab
      : true

    // Collab posts do the whole scrape + describe + plan pass in *this* browser against
    // *this* user's AI account, and only hit the shelf once it's a finished card.
    if (isCollabTarget && hasAI()) {
      setBuilding('starting')
      try {
        const built = await buildCard(data.url, setBuilding)
        const card = await api.createCard({
          ...built,
          subcategory_id: targetSub,
          thumbnail_url: data.thumbnail_url || built.thumbnail_url
        })
        setCards(prev => [card, ...prev])
      } catch (err) {
        window.alert(`could not post that link — ${err.message}`)
      }
      setBuilding(null)
      return
    }

    if (isCollabTarget && !isAdmin) {
      window.alert('add your AI endpoint under the theme dot first — collab posts run on your own account')
      return
    }

    api.createCard({ ...data, subcategory_id: targetSub })
      .then(card => {
        setCards(prev => [card, ...prev])
        if (card.status === 'pending') startPolling(card.id)
      })
  }

  const handleShare = async (subcatId) => {
    await api.getInvite(subcatId)
    setSubcategories(prev => prev.map(s => s.id === subcatId ? { ...s, is_collab: true } : s))
  }

  const handleDeleteCard = async (id) => {
    await api.deleteCard(id)
    setCards((prev) => prev.filter((c) => c.id !== id))
  }

  const handleUpdateCard = (updated) => {
    setCards((prev) => prev.map((c) => c.id === updated.id ? updated : c))
  }

  const handleDeleteSubcategory = async (id) => {
    await api.deleteSubcategory(id)
    setSubcategories((prev) => prev.filter((s) => s.id !== id))
    if (activeSubcatId === id) setActiveSubcatId(null)
  }

  const handleReorderCategories = (newOrder) => {
    setCategories(newOrder)
    latestCats.current = newOrder
  }

  const saveCategoryOrder = useCallback(() => {
    api.reorderCategories(latestCats.current.map((c, i) => ({ id: c.id, sort_order: i })))
  }, [])

  const handleReorderSubcategories = (newOrder) => {
    setSubcategories(newOrder)
    latestSubs.current = newOrder
  }

  const saveSubcategoryOrder = useCallback(() => {
    api.reorderSubcategories(latestSubs.current.map((s, i) => ({ id: s.id, sort_order: i })))
  }, [])

  const pageVariants = {
    enter: (dir) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir > 0 ? -40 : 40, opacity: 0 })
  }

  return (
    <div className="min-h-full" style={{ background: 'var(--s-bg)' }}>
      {/* Banner */}
      <div className="max-w-2xl mx-auto" style={{ borderTop: '2px solid #6b0f0f', borderBottom: '2px solid #6b0f0f' }}>
        <img src="/banner.png" alt="Shelfstation" className="w-full block" />
      </div>

      {/* Centered column */}
      <div className="max-w-2xl mx-auto pb-16">

        <div style={{ display: activeView === 'bookmarks' ? 'block' : 'none' }}>
            <CategoryNav
              categories={categories}
              activeId={activeCatId}
              onSelect={selectCategory}
              onAdd={() => setShowAddCat(true)}
              onReorder={handleReorderCategories}
              onReorderEnd={saveCategoryOrder}
              readOnly={!isAdmin}
            />

            {subcategories.length > 0 && (
              <SubcategoryTabs
                subcategories={subcategories}
                activeId={activeSubcatId}
                onSelect={setActiveSubcatId}
                onAdd={handleAddSubcategory}
                onDelete={handleDeleteSubcategory}
                onReorder={handleReorderSubcategories}
                onReorderEnd={saveSubcategoryOrder}
                onShare={handleShare}
              />
            )}

            {isAdmin && subcategories.length === 0 && activeCatId && (
              <div className="px-4 pb-3">
                <button onClick={handleAddSubcategory} className="text-xs" style={{ color: 'var(--s-text-3)' }}>
                  + add tab
                </button>
              </div>
            )}

            {activeShelfId && (
              <div className="mb-3">
                <MembersBar shelfId={activeShelfId} isAdmin={isAdmin} meId={user.id} />
              </div>
            )}

            {cards.length > 0 && (
              <div className="px-4">
                <SearchBar value={search} onChange={setSearch} />
              </div>
            )}

            <div className="relative" style={{ minHeight: '60vh' }}>
              <AnimatePresence mode="wait" custom={direction}>
                {activeCatId && (
                  <motion.div
                    key={activeCatId + '-' + activeSubcatId}
                    custom={direction}
                    variants={pageVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ type: 'spring', damping: 28, stiffness: 260 }}
                  >
                    <CardGrid
                      cards={filteredCards}
                      onDelete={handleDeleteCard}
                      onUpdate={handleUpdateCard}
                      search={search}
                      nowPlayingId={nowPlaying?.id}
                      onPlay={(card) => setNowPlaying({ id: card.id, title: card.title })}
                      canEdit={(card) => isAdmin || card.user_id === user.id}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
        </div>

        {isAdmin && activeView === 'notes' && <NotesTab />}

      </div>

      {/* FAB — sits above the bottom bar */}
      {activeView === 'bookmarks' && activeCatId && (
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => setShowAddCard(true)}
          className="fixed right-6 w-14 h-14 rounded-full flex items-center justify-center text-2xl font-light z-40"
          style={{
            bottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
            background: 'var(--s-accent)',
            color: 'var(--s-bg)',
            boxShadow: '0 0 24px var(--s-accent-glow), 0 4px 16px rgba(0,0,0,0.4)'
          }}
        >
          +
        </motion.button>
      )}

      {/* Collab post progress — the card doesn't exist anywhere until this finishes */}
      <AnimatePresence>
        {building && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed z-40 flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: 'calc(3.5rem + env(safe-area-inset-bottom) + 10px)',
              maxWidth: 'calc(100vw - 2rem)',
              background: 'var(--s-surface)',
              border: '1px solid var(--s-accent)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
            }}
          >
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--s-accent)', flexShrink: 0 }}
            />
            <span className="text-xs truncate" style={{ color: 'var(--s-text-2)' }}>{building}…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collab posts run the whole AI pass before they exist, so show the user where it's up to */}
      <AnimatePresence>
        {building && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed z-40 flex items-center gap-2 px-4 py-2 rounded-full"
            style={{
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: 'calc(3.5rem + env(safe-area-inset-bottom) + 10px)',
              maxWidth: 'calc(100vw - 2rem)',
              background: 'var(--s-surface)',
              border: '1px solid var(--s-accent)',
              boxShadow: '0 0 16px var(--s-accent-glow)'
            }}
          >
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--s-accent)', flexShrink: 0 }}
            />
            <span className="text-xs truncate" style={{ color: 'var(--s-text-2)' }}>{building}…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Now-playing bar — lets you pause a video from any tab */}
      <AnimatePresence>
        {nowPlaying && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed z-40 flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full"
            style={{
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: 'calc(3.5rem + env(safe-area-inset-bottom) + 10px)',
              maxWidth: 'calc(100vw - 2rem)',
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
            }}
          >
            <span className="text-xs truncate" style={{ color: 'var(--s-text-2)', maxWidth: 200 }}>
              {nowPlaying.title || 'playing'}
            </span>
            <button
              onClick={() => setNowPlaying(null)}
              className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0"
              style={{ background: 'var(--s-accent)' }}
              aria-label="Pause"
            >
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="var(--s-bg)">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30"
        style={{ background: 'var(--s-bg)', borderTop: '1px solid var(--s-border)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between px-6" style={{ height: '2.75rem' }}>
          <div className="flex items-center gap-4">
            {(isAdmin ? ['bookmarks', 'notes'] : ['bookmarks']).map(v => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                style={{
                  fontSize: 10, letterSpacing: '0.14em', fontFamily: 'inherit',
                  color: activeView === v ? 'var(--s-accent)' : 'var(--s-text-3)',
                  borderBottom: activeView === v ? '1px solid var(--s-accent)' : '1px solid transparent',
                  paddingBottom: 2, transition: 'color 0.15s, border-color 0.15s'
                }}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
          <ThemePicker
            current={theme}
            onChange={(id) => { applyTheme(id); setTheme(id) }}
            user={user}
            onRenamed={setUser}
          />
        </div>
      </div>

      <AnimatePresence>
        {showAddCard && (
          <AddCardModal
            categoryId={activeCatId}
            subcategories={subcategories}
            onAdd={handleAddCard}
            onClose={() => setShowAddCard(false)}
          />
        )}
        {showAddCat && (
          <AddCategoryModal
            onAdd={handleAddCategory}
            onClose={() => setShowAddCat(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
