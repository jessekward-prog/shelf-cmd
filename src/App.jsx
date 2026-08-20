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
import MembersBar from './components/MembersBar.jsx'
import InviteModal from './components/InviteModal.jsx'
import JoinModal from './components/JoinModal.jsx'
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
  const [inviteFor, setInviteFor] = useState(null)
  const [showJoin, setShowJoin] = useState(false)
  const [membersKey, setMembersKey] = useState(0)
  const [direction, setDirection] = useState(1)
  const [activeView, setActiveView] = useState('bookmarks')
  const [nowPlaying, setNowPlaying] = useState(null)
  const pollTimers = useRef({})
  const latestCats = useRef([])
  const latestSubs = useRef([])
  const searchRef = useRef(null)

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

  // A collaborator's top level is the shared categories themselves, tabs and all.
  const loadCards = useCallback((catId, subcatId) => {
    const request = isAdmin ? api.getCards(catId, subcatId) : api.getShelfCards(catId, subcatId)
    request.then(loaded => {
      setCards(loaded)
      loaded.filter(c => c.status === 'pending').forEach(c => startPolling(c.id))
    })
  }, [startPolling, isAdmin])

  useEffect(() => {
    applyTheme(theme)
    applyIntensity(getSavedIntensity(), theme)
  }, [])

  const loadTopLevel = useCallback((selectId) => {
    const load = isAdmin ? api.getCategories() : api.getMyShelves()
    return load.then((cats) => {
      setCategories(cats)
      if (selectId && cats.some(c => c.id === selectId)) setActiveCatId(selectId)
      else if (cats.length) setActiveCatId(prev => prev ?? cats[0].id)
    })
  }, [isAdmin])

  useEffect(() => { loadTopLevel() }, [loadTopLevel])

  useEffect(() => {
    if (!activeCatId) return
    setActiveSubcatId(null)
    setSearch('')
    const tabs = isAdmin ? api.getSubcategories(activeCatId) : api.getShelfSubcategories(activeCatId)
    tabs.then(setSubcategories).catch(() => setSubcategories([]))
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

  // Sharing is whole-shelf, so the members bar belongs to the category, not the tab.
  const activeShelfId = categories.find(c => c.id === activeCatId)?.is_collab ? activeCatId : null

  const handleAddCard = async (data) => {
    const targetSub = data.subcategory_id || activeSubcatId || null
    const isCollabTarget = !!activeShelfId

    // Collab posts do the whole scrape + describe + plan pass in *this* browser against
    // *this* user's AI account, and only hit the shelf once it's a finished card.
    if (isCollabTarget && hasAI()) {
      setBuilding('starting')
      try {
        const built = await buildCard(data.url, setBuilding)
        const card = await api.createCard({
          ...built,
          category_id: activeCatId,
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

    api.createCard({ ...data, category_id: activeCatId, subcategory_id: targetSub })
      .then(card => {
        setCards(prev => [card, ...prev])
        if (card.status === 'pending') startPolling(card.id)
      })
  }

  // Minting the code is what turns a shelf collaborative, so reflect that once it comes back
  const handleShared = (catId) => {
    setCategories(prev => prev.map(c => c.id === catId ? { ...c, is_collab: true } : c))
    setMembersKey(k => k + 1)
  }

  const handleJoined = async (shelfId) => {
    setShowJoin(false)
    if (isAdmin) {
      setMembersKey(k => k + 1)
      return
    }
    await loadTopLevel(shelfId)
    setActiveCatId(shelfId)
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

  const activeCat = categories.find(c => c.id === activeCatId)
  const activeSub = subcategories.find(s => s.id === activeSubcatId)
  const pickTheme = (id) => { applyTheme(id); setTheme(id) }

  return (
    <div className="min-h-full lg:flex" style={{ background: 'var(--s-bg)' }}>
      <Sidebar
        categories={categories}
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
        isAdmin={isAdmin}
        onJoin={() => setShowJoin(true)}
        activeView={activeView}
        onView={setActiveView}
        cardCount={cards.length}
      />

      <div className="lg:flex-1 lg:min-w-0 lg:flex lg:flex-col">
        <Topbar
          search={search}
          onSearch={setSearch}
          onAdd={() => setShowAddCard(true)}
          canAdd={activeView === 'bookmarks' && !!activeCatId}
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
                  categories={categories}
                  activeId={activeCatId}
                  onSelect={selectCategory}
                  onAdd={() => setShowAddCat(true)}
                  onReorder={handleReorderCategories}
                  onReorderEnd={saveCategoryOrder}
                  readOnly={!isAdmin}
                  onJoin={() => setShowJoin(true)}
                  onShare={setInviteFor}
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
                    readOnly={!isAdmin}
                  />
                )}

                {isAdmin && subcategories.length === 0 && activeCatId && (
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
                  <span
                    className="ml-auto"
                    style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--s-text-3)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {filteredCards.length} {filteredCards.length === 1 ? 'CARD' : 'CARDS'}
                    {search && ` · MATCHING "${search.toUpperCase()}"`}
                  </span>
                </div>
              )}

              {activeShelfId && (
                <div className="mb-3 lg:mx-8 lg:mb-5">
                  <MembersBar
                    shelfId={activeShelfId}
                    isAdmin={isAdmin}
                    meId={user.id}
                    onInvite={setInviteFor}
                    refreshKey={membersKey}
                  />
                </div>
              )}

              {cards.length > 0 && (
                <div className="px-4 lg:hidden">
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
                        onAdd={() => setShowAddCard(true)}
                        onClearSearch={() => setSearch('')}
                        nowPlayingId={nowPlaying?.id}
                        onPlay={(card) => setNowPlaying({ id: card.id, title: card.title })}
                        canEdit={(card) => isAdmin || card.user_id === user.id}
                        canServerAI={isAdmin}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
          </div>

          {isAdmin && activeView === 'notes' && (
            <div className="lg:max-w-3xl lg:px-8 lg:pt-7">
              <NotesTab />
            </div>
          )}

        </div>
      </div>

      {/* FAB — thumb-reachable on the phone; desktop uses the topbar button instead */}
      {activeView === 'bookmarks' && activeCatId && (
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
              bottom: 'var(--s-dock)',
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
            onJoined={handleJoined}
            onClose={() => setShowJoin(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
