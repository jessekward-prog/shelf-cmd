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
import * as api from './api.js'
import { getSavedTheme, applyTheme, getSavedIntensity, applyIntensity } from './themes.js'

export default function App() {
  const [theme, setTheme] = useState(getSavedTheme)
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

  const loadCards = useCallback((catId, subcatId) => {
    api.getCards(catId, subcatId).then(loaded => {
      setCards(loaded)
      loaded.filter(c => c.status === 'pending').forEach(c => startPolling(c.id))
    })
  }, [startPolling])

  useEffect(() => {
    applyTheme(theme)
    applyIntensity(getSavedIntensity(), theme)
  }, [])

  useEffect(() => {
    api.getCategories().then((cats) => {
      setCategories(cats)
      if (cats.length) setActiveCatId(cats[0].id)
    })
  }, [])

  useEffect(() => {
    if (!activeCatId) return
    setActiveSubcatId(null)
    setSearch('')
    api.getSubcategories(activeCatId).then(setSubcategories)
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

  const handleAddCard = (data) => {
    api.createCard({ ...data, subcategory_id: activeSubcatId })
      .then(card => {
        setCards(prev => [card, ...prev])
        if (card.status === 'pending') startPolling(card.id)
      })
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
              />
            )}

            {subcategories.length === 0 && activeCatId && (
              <div className="px-4 pb-3">
                <button onClick={handleAddSubcategory} className="text-xs" style={{ color: 'var(--s-text-3)' }}>
                  + add tab
                </button>
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
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
        </div>

        {activeView === 'notes' && <NotesTab />}

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
            {['bookmarks', 'notes'].map(v => (
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
          <ThemePicker current={theme} onChange={(id) => { applyTheme(id); setTheme(id) }} />
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
