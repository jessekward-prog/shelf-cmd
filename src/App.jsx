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
import { getSavedTheme, applyTheme } from './themes.js'

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
  const pollTimers = useRef({})

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

  const pageVariants = {
    enter: (dir) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir > 0 ? -40 : 40, opacity: 0 })
  }

  return (
    <div className="min-h-full" style={{ background: 'var(--s-bg)' }}>
      {/* Centered column */}
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-5 pb-1">
          <h1 className="text-lg font-medium tracking-widest" style={{ color: 'var(--s-accent)' }}>
            shelf
          </h1>
          <div className="flex items-center gap-3">
            {activeView === 'bookmarks' && (
              <span className="text-xs" style={{ color: 'var(--s-border)' }}>
                {search ? `${filteredCards.length} of ${cards.length}` : `${cards.length} item${cards.length !== 1 ? 's' : ''}`}
              </span>
            )}
            <ThemePicker current={theme} onChange={(id) => { applyTheme(id); setTheme(id) }} />
          </div>
        </div>

        {/* View switcher */}
        <div className="flex items-center gap-3 px-4 pb-2" style={{ marginTop: 2 }}>
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

        {activeView === 'bookmarks' && (
          <>
            <CategoryNav
              categories={categories}
              activeId={activeCatId}
              onSelect={selectCategory}
              onAdd={() => setShowAddCat(true)}
            />

            {subcategories.length > 0 && (
              <SubcategoryTabs
                subcategories={subcategories}
                activeId={activeSubcatId}
                onSelect={setActiveSubcatId}
                onAdd={handleAddSubcategory}
                onDelete={handleDeleteSubcategory}
              />
            )}

            {subcategories.length === 0 && activeCatId && (
              <div className="px-4 pb-3">
                <button onClick={handleAddSubcategory} className="text-xs" style={{ color: '#3d2e00' }}>
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
                    <CardGrid cards={filteredCards} onDelete={handleDeleteCard} onUpdate={handleUpdateCard} search={search} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}

        {activeView === 'notes' && <NotesTab />}

      </div>

      {/* FAB — fixed, not inside the column */}
      {activeView === 'bookmarks' && activeCatId && (
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => setShowAddCard(true)}
          className="fixed right-6 w-14 h-14 rounded-full flex items-center justify-center text-2xl font-light z-40"
          style={{
            bottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
            background: 'var(--s-accent)',
            color: 'var(--s-bg)',
            boxShadow: '0 0 24px var(--s-accent-glow), 0 4px 16px rgba(0,0,0,0.4)'
          }}
        >
          +
        </motion.button>
      )}

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
