import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CategoryNav from './components/CategoryNav.jsx'
import SubcategoryTabs from './components/SubcategoryTabs.jsx'
import Sidebar from './components/Sidebar.jsx'
import Topbar from './components/Topbar.jsx'
import CardGrid from './components/CardGrid.jsx'
import SearchBar from './components/SearchBar.jsx'
import AddCardModal from './components/AddCardModal.jsx'
import AddCategoryModal from './components/AddCategoryModal.jsx'
import ThemePicker from './components/ThemePicker.jsx'
import NotesTab from './components/NotesTab.jsx'
import DrivePage from './components/DrivePage.jsx'
import GuideModal from './components/GuideModal.jsx'
import GuidesView, { Legend } from './components/GuidesView.jsx'
import MiniPlayer from './components/MiniPlayer.jsx'
import MembersBar from './components/MembersBar.jsx'
import InviteModal from './components/InviteModal.jsx'
import JoinModal from './components/JoinModal.jsx'
import ManageShelvesModal from './components/ManageShelvesModal.jsx'
import ShelfChat from './components/ShelfChat.jsx'
import * as api from './api.js'
import { getSavedTheme, applyTheme, getSavedIntensity, applyIntensity } from './themes.js'

// Aesthetic [ Cards | Drive ] switch, shown for the active shelf in every tab.
function ModeToggle({ mode, onMode }) {
  const opts = [
    { id: 'cards', label: 'CARDS' },
    { id: 'drive', label: 'DRIVE' },
    { id: 'guides', label: 'GUIDES' },
  ]
  return (
    <div className="inline-flex rounded-lg p-1 gap-1" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      {opts.map(o => {
        const active = mode === o.id
        return (
          <button
            key={o.id}
            onClick={() => onMode(o.id)}
            className="px-3.5 py-1 rounded-md"
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', fontFamily: 'inherit',
              background: active ? 'var(--s-text-0)' : 'transparent',
              color: active ? 'var(--s-bg)' : 'var(--s-text-0)',
              boxShadow: active ? '0 0 8px rgba(0,0,0,0.35)' : 'none',
              transition: 'background 0.15s, color 0.15s'
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function App({ me }) {
  const [user, setUser] = useState(me)
  const [theme, setTheme] = useState(getSavedTheme)
  const [categories, setCategories] = useState([])
  const [activeCatId, setActiveCatId] = useState(null)
  const [subcategories, setSubcategories] = useState([])
  const [activeSubcatId, setActiveSubcatId] = useState(null)
  const [cards, setCards] = useState([])
  const [search, setSearch] = useState('')
  const [showAddCard, setShowAddCard] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [inviteFor, setInviteFor] = useState(null)
  const [showJoin, setShowJoin] = useState(false)
  const [showManageShelves, setShowManageShelves] = useState(false)
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shelf_favorites')) || [] } catch { return [] }
  })
  useEffect(() => { localStorage.setItem('shelf_favorites', JSON.stringify(favorites)) }, [favorites])
  const toggleFavorite = (id) =>
    setFavorites(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id])
  const [membersKey, setMembersKey] = useState(0)
  const [direction, setDirection] = useState(1)
  const [activeView, setActiveView] = useState('bookmarks')
  const [showGuide, setShowGuide] = useState(false)
  const [guideModalCatId, setGuideModalCatId] = useState(null)
  const [guidesKey, setGuidesKey] = useState(0)
  const [shelfMode, setShelfMode] = useState('cards') // 'cards' | 'drive' | 'guides', per shelf
  const [recoloring, setRecoloring] = useState(false)
  const [recolorResult, setRecolorResult] = useState(null)
  const [nowPlaying, setNowPlaying] = useState(null)
  const [popped, setPopped] = useState(null) // card floating in the mini-player
  const pollTimers = useRef({})
  const latestCats = useRef([])
  const latestSubs = useRef([])
  const searchRef = useRef(null)
  const activeCatRef = useRef(null)
  const activeSubcatRef = useRef(null)
  useEffect(() => { activeCatRef.current = activeCatId }, [activeCatId])
  useEffect(() => { activeSubcatRef.current = activeSubcatId }, [activeSubcatId])

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

  // Classification runs server-side after a card's created, so a card added
  // from elsewhere (or before this shipped) shows no dot until this backfills
  // it and this shelf's cards are reloaded — same pattern as Guides' own sync.
  // Success and "nothing to do" look identical with no dots changing, so this
  // has to report what actually happened rather than fail silently either way.
  const recolorCards = () => {
    setRecoloring(true)
    setRecolorResult(null)
    api.backfillCardCategories()
      .then(({ updated }) => {
        setRecolorResult(updated > 0 ? `+${updated}` : 'up to date')
        return loadCards(activeCatRef.current, activeSubcatRef.current)
      })
      .catch(() => setRecolorResult('failed — check LM Studio'))
      .finally(() => {
        setRecoloring(false)
        setTimeout(() => setRecolorResult(null), 3000)
      })
  }

  useEffect(() => {
    applyTheme(theme)
    applyIntensity(getSavedIntensity(), theme)
  }, [])

  const loadTopLevel = useCallback((selectId) => {
    return api.getCategories().then((cats) => {
      setCategories(cats)
      if (selectId && cats.some(c => c.id === selectId)) setActiveCatId(selectId)
      else if (cats.length) setActiveCatId(prev => prev ?? cats[0].id)
    })
  }, [])

  useEffect(() => { loadTopLevel() }, [loadTopLevel])

  useEffect(() => {
    if (!activeCatId) return
    setActiveSubcatId(null)
    setSearch('')
    setShelfMode('cards')
    const catId = activeCatId
    api.getSubcategories(catId).then(setSubcategories).catch(() => setSubcategories([]))
    loadCards(catId, null)
    // Fire-and-forget: pull anything missed since the last background poll.
    // Local data is already showing, so this just patches it in once it
    // lands rather than blocking the shelf on a hub round trip. A no-op for
    // a shelf that isn't hub-linked.
    api.syncShelf(catId).then(() => {
      if (activeCatRef.current !== catId) return
      api.getSubcategories(catId).then(setSubcategories).catch(() => {})
      loadCards(catId, activeSubcatRef.current)
    }).catch(() => {})
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

  // Sharing is whole-shelf, so the members bar belongs to the category, not the tab.
  const activeShelfId = categories.find(c => c.id === activeCatId)?.is_collab ? activeCatId : null

  const handleAddCard = async (data) => {
    const targetSub = data.subcategory_id || activeSubcatId || null
    const card = await api.createCard({ ...data, category_id: activeCatId, subcategory_id: targetSub })
    setCards(prev => [card, ...prev])
    if (card.status === 'pending') startPolling(card.id)
  }

  // Minting the code is what turns a shelf collaborative, so reflect that once it comes back
  const handleShared = (catId) => {
    setCategories(prev => prev.map(c => c.id === catId ? { ...c, is_collab: true } : c))
    setMembersKey(k => k + 1)
  }

  // A linked shelf becomes a real category here, so refresh and jump to it
  const handleLinked = async (categoryId) => {
    setShowJoin(false)
    await loadTopLevel(categoryId)
    setActiveCatId(categoryId)
    setMembersKey(k => k + 1)
  }

  const handleDeleteCard = async (id) => {
    await api.deleteCard(id)
    setCards((prev) => prev.filter((c) => c.id !== id))
    if (popped?.id === id) setPopped(null)
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

  // Reordering inside the manage-shelves modal only ever sees the active
  // (non-archived) shelves, so the archived ones need folding back in untouched.
  const handleReorderActiveCategories = (nextActive) => {
    handleReorderCategories([...nextActive, ...categories.filter(c => c.archived)])
  }

  const handleArchiveCategory = async (id, archived) => {
    const cat = await api.updateCategory(id, { archived })
    setCategories(prev => prev.map(c => c.id === id ? cat : c))
    // An archived shelf can't stay the active one — fall back to the first visible shelf.
    if (archived && activeCatId === id) {
      const next = categories.find(c => c.id !== id && !c.archived)
      setActiveCatId(next?.id ?? null)
    }
  }

  const handleDeleteCategory = async (id) => {
    await api.deleteCategory(id)
    setCategories(prev => prev.filter(c => c.id !== id))
    if (activeCatId === id) {
      const next = categories.find(c => c.id !== id && !c.archived)
      setActiveCatId(next?.id ?? null)
    }
  }

  const pageVariants = {
    enter: (dir) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir > 0 ? -40 : 40, opacity: 0 })
  }

  const activeCat = categories.find(c => c.id === activeCatId)
  const activeSub = subcategories.find(s => s.id === activeSubcatId)
  const visibleCategories = categories.filter(c => !c.archived)
  const pickTheme = (id) => { applyTheme(id); setTheme(id) }

  return (
    <div className="min-h-full lg:flex" style={{ background: 'var(--s-bg)' }}>
      <Sidebar
        categories={visibleCategories}
        activeCatId={activeCatId}
        onSelectCat={selectCategory}
        subcategories={subcategories}
        activeSubcatId={activeSubcatId}
        onSelectSub={setActiveSubcatId}
        onAddCat={() => setShowAddCat(true)}
        onAddSub={handleAddSubcategory}
        onDeleteSub={handleDeleteSubcategory}
        onShareCat={setInviteFor}
        onReorderCats={handleReorderCategories}
        onReorderCatsEnd={saveCategoryOrder}
        onReorderSubs={handleReorderSubcategories}
        onReorderSubsEnd={saveSubcategoryOrder}
        onJoin={() => setShowJoin(true)}
        onManage={() => setShowManageShelves(true)}
        activeView={activeView}
        onView={setActiveView}
        cardCount={cards.length}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
      />

      <div className="lg:flex-1 lg:min-w-0 lg:flex lg:flex-col">
        <Topbar
          search={search}
          onSearch={setSearch}
          onAdd={() => setShowAddCard(true)}
          canAdd={activeView === 'bookmarks' && shelfMode === 'cards' && !!activeCatId}
          theme={theme}
          onTheme={pickTheme}
          user={user}
          onRenamed={setUser}
          searchRef={searchRef}
        />

        {/* Banner — a splash screen only makes sense on the phone */}
        <div className="lg:hidden max-w-2xl mx-auto" style={{ borderTop: '2px solid #6b0f0f', borderBottom: '2px solid #6b0f0f' }}>
          <img src="/banner.png" alt="Shelfstation" className="w-full block" />
        </div>

        {/* Centered column on mobile, full bleed beside the sidebar on desktop */}
        <div className="max-w-2xl mx-auto pb-16 lg:max-w-none lg:mx-0 lg:pb-10 lg:w-full">

          <div style={{ display: activeView === 'bookmarks' ? 'block' : 'none' }}>
              <div className="lg:hidden">
                <CategoryNav
                  categories={visibleCategories}
                  activeId={activeCatId}
                  onSelect={selectCategory}
                  onAdd={() => setShowAddCat(true)}
                  onJoin={() => setShowJoin(true)}
                  onShare={setInviteFor}
                  onManage={() => setShowManageShelves(true)}
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
              </div>

              {/* Desktop breadcrumb — the sidebar says where you can go, this says where you are */}
              {activeCat && (
                <div className="hidden lg:flex items-baseline gap-2 px-8 pt-7 pb-5">
                  <h1 style={{ fontSize: 19, color: 'var(--s-text-0)', letterSpacing: '0.02em', margin: 0 }}>
                    {activeCat.name}
                  </h1>
                  {activeSub && (
                    <>
                      <span style={{ fontSize: 15, color: 'var(--s-text-3)' }}>/</span>
                      <span style={{ fontSize: 15, color: 'var(--s-text-2)' }}>{activeSub.name}</span>
                    </>
                  )}
                  {shelfMode === 'cards' && (
                    <span
                      style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--s-text-3)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {filteredCards.length} {filteredCards.length === 1 ? 'CARD' : 'CARDS'}
                      {search && ` · MATCHING "${search.toUpperCase()}"`}
                    </span>
                  )}
                  <div className="ml-auto"><ModeToggle mode={shelfMode} onMode={setShelfMode} /></div>
                </div>
              )}

              {/* Mobile mode switch — the "aesthetic way to a drive page" in every tab */}
              {activeCatId && (
                <div className="lg:hidden flex justify-center pb-3">
                  <ModeToggle mode={shelfMode} onMode={setShelfMode} />
                </div>
              )}

              {activeShelfId && (
                <div className="mb-3 lg:mx-8 lg:mb-5">
                  <MembersBar
                    shelfId={activeShelfId}
                                  onInvite={setInviteFor}
                    refreshKey={membersKey}
                  />
                </div>
              )}

              {shelfMode === 'cards' && cards.length > 0 && (
                <div className="px-4 lg:hidden">
                  <SearchBar value={search} onChange={setSearch} />
                </div>
              )}

              {shelfMode === 'cards' && cards.length > 0 && (
                <div className="px-4 lg:px-8 flex items-center gap-2">
                  <Legend />
                  <button
                    onClick={recolorCards}
                    disabled={recoloring}
                    title="Classify any card missing a category, and pull in anything new"
                    className="glow-focus"
                    style={{
                      display: 'flex', padding: 4, borderRadius: 6, marginBottom: 14,
                      color: 'var(--s-text-3)', opacity: recoloring ? 0.5 : 1
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ width: 13, height: 13, animation: recoloring ? 'spin 0.8s linear infinite' : 'none' }}>
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
                    </svg>
                  </button>
                  {recolorResult && (
                    <span style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--s-text-3)', marginBottom: 14 }}>
                      {recolorResult}
                    </span>
                  )}
                </div>
              )}

              <div className="relative" style={{ minHeight: '60vh' }}>
                <AnimatePresence mode="wait" custom={direction}>
                  {activeCatId && shelfMode === 'drive' ? (
                    <motion.div key={'drive-' + activeCatId}
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}>
                      <DrivePage categoryId={activeCatId} subcategoryId={activeSubcatId}
                        joined={!!categories.find(c => c.id === activeCatId)?.joined} />
                    </motion.div>
                  ) : activeCatId && shelfMode === 'guides' ? (
                    <motion.div key={'guides-' + activeCatId}
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}>
                      <GuidesView
                        categoryId={activeCatId}
                        onGenerate={() => { setGuideModalCatId(activeCatId); setShowGuide(true) }}
                        refreshKey={guidesKey}
                      />
                    </motion.div>
                  ) : activeCatId && (
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
                        onAdd={() => setShowAddCard(true)}
                        onClearSearch={() => setSearch('')}
                        nowPlayingId={nowPlaying?.id}
                        onPlay={(card) => setNowPlaying({ id: card.id, title: card.title })}
                        onPop={(card) => { setPopped(card); setNowPlaying(null) }}
                        poppedId={popped?.id}
                        canEdit={(card) => card.can_edit !== false}
                        canServerAI={true}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
          </div>

          {activeView === 'notes' && (
            <div className="lg:max-w-3xl lg:px-8 lg:pt-7">
              <NotesTab />
            </div>
          )}

          {activeView === 'guides' && (
            <div className="lg:px-8 lg:pt-7">
              <GuidesView onGenerate={() => { setGuideModalCatId(null); setShowGuide(true) }} refreshKey={guidesKey} />
            </div>
          )}

        </div>
      </div>

      {/* FAB — thumb-reachable on the phone; desktop uses the topbar button instead */}
      {activeView === 'bookmarks' && shelfMode === 'cards' && activeCatId && (
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => setShowAddCard(true)}
          className="lg:hidden fixed right-6 w-14 h-14 rounded-full flex items-center justify-center text-2xl font-light z-40"
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

      {/* Persists across a shelf's CARDS/DRIVE/GUIDES tabs — keyed so switching
          shelves gets a clean remount instead of showing the old shelf's chat. */}
      {activeView === 'bookmarks' && activeCatId && (
        <ShelfChat key={activeCatId} categoryId={activeCatId} isLinked={!!activeCat?.is_collab} />
      )}


      {/* Pop-out mini-player — floats in the corner, survives navigation */}
      <AnimatePresence>
        {popped && <MiniPlayer card={popped} onClose={() => setPopped(null)} />}
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
              bottom: 'var(--s-dock)',
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

      {/* Bottom bar — mobile only; the sidebar and topbar carry these on desktop */}
      <div
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30"
        style={{ background: 'var(--s-bg)', borderTop: '1px solid var(--s-border)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between px-6" style={{ height: '2.75rem' }}>
          <div className="flex items-center gap-4">
            {['bookmarks', 'notes', 'guides'].map(v => (
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
          <ThemePicker current={theme} onChange={pickTheme} user={user} onRenamed={setUser} />
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
        {inviteFor && (
          <InviteModal
            shelfId={inviteFor}
            shelfName={categories.find(c => c.id === inviteFor)?.name || 'this shelf'}
            onShared={handleShared}
            onClose={() => setInviteFor(null)}
          />
        )}
        {showJoin && (
          <JoinModal
                onLinked={handleLinked}
            onClose={() => setShowJoin(false)}
          />
        )}
        {showGuide && (
          <GuideModal
            categoryId={guideModalCatId}
            onClose={() => setShowGuide(false)}
            onSaved={() => setGuidesKey(k => k + 1)}
          />
        )}
        {showManageShelves && (
          <ManageShelvesModal
            categories={categories}
            onClose={() => setShowManageShelves(false)}
            onReorder={handleReorderActiveCategories}
            onReorderEnd={saveCategoryOrder}
            onArchive={handleArchiveCategory}
            onDelete={handleDeleteCategory}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onAddNew={() => { setShowManageShelves(false); setShowAddCat(true) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
