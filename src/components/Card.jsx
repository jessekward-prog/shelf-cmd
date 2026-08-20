import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'

const PLATFORM_LABELS = {
  youtube: 'YouTube', tiktok: 'TikTok', vimeo: 'Vimeo',
  spotify: 'Spotify', soundcloud: 'SoundCloud', twitch: 'Twitch',
  instagram: 'Instagram', twitter: 'Twitter/X', pinterest: 'Pinterest',
  reddit: 'Reddit', snapchat: 'Snapchat', facebook: 'Facebook'
}

function PlatformBadge({ type }) {
  const label = PLATFORM_LABELS[type]
  if (!label) return null
  return (
    <div
      className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded font-medium z-10"
      style={{ background: 'rgba(0,0,0,0.65)', color: 'var(--s-text-1)' }}
    >
      {label}
    </div>
  )
}

function PriceBadge({ price, currency }) {
  if (!price) return null
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$'
  return (
    <div
      className="absolute bottom-2 right-2 text-sm font-bold px-2 py-0.5 rounded z-10"
      style={{ background: 'var(--s-accent-strong)', color: 'var(--s-bg)', letterSpacing: '-0.02em' }}
    >
      {symbol}{parseFloat(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </div>
  )
}

// Pop-out (picture-in-picture) control — lifts the media into the floating player
function PopButton({ onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title="Pop out — keep playing while you browse"
      className="absolute top-2 right-2 z-20 flex items-center justify-center w-7 h-7 rounded transition-opacity"
      style={{ background: 'rgba(0,0,0,0.6)', color: 'var(--s-text-1)' }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <rect x="12" y="11" width="7.5" height="6" rx="1" fill="currentColor" stroke="none" />
      </svg>
    </button>
  )
}

function MediaEmbed({ card, price, currency, playing, onPlay, onPop, isPopped }) {
  const embedUrl = card.metadata?.embed_url
  const aspect = card.metadata?.aspect
  const isAudio = aspect === 'audio'
  const isPortrait = aspect === '9:16'
  const isSquare = aspect === '1:1'
  const paddingBottom = isPortrait ? '177.78%' : isSquare ? '100%' : isAudio ? '0' : '56.25%'

  if (!embedUrl) {
    if (!card.thumbnail_url) {
      // No thumbnail — show favicon + domain banner
      if (!card.url) return null
      let domain = ''
      try { domain = new URL(card.url).hostname.replace('www.', '') } catch (e) {}
      const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
      return (
        <a href={card.url} target="_blank" rel="noreferrer"
          className="flex items-center gap-3 px-3 py-3 group"
          style={{ borderBottom: '1px solid var(--s-surface-2)' }}
        >
          <img src={favicon} alt="" className="w-6 h-6 rounded flex-shrink-0" style={{ opacity: 0.7 }} />
          <span className="text-xs truncate flex-1" style={{ color: 'var(--s-border)' }}>{domain}</span>
          <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: 'var(--s-accent)' }}>↗</span>
        </a>
      )
    }
    return (
      <a href={card.url} target="_blank" rel="noreferrer" className="block relative group overflow-hidden">
        <img
          src={card.thumbnail_url}
          alt=""
          className="w-full object-cover transition-transform duration-300 group-hover:scale-105"
          style={{ maxHeight: 200, filter: 'brightness(0.85)' }}
        />
        <PlatformBadge type={card.type} />
        <PriceBadge price={price} currency={currency} />
        <div
          className="absolute inset-0 flex items-end p-2 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}
        >
          <span className="text-xs" style={{ color: 'var(--s-accent)' }}>open ↗</span>
        </div>
      </a>
    )
  }

  if (isAudio) {
    return (
      <div style={{ height: 120, position: 'relative', paddingBottom: 0 }}>
        <PlatformBadge type={card.type} />
        <iframe
          src={embedUrl}
          style={{ width: '100%', height: '100%', border: 0 }}
          allow="autoplay"
        />
      </div>
    )
  }

  if (playing) {
    return (
      <div style={{ position: 'relative', paddingBottom }}>
        <PlatformBadge type={card.type} />
        {onPop && <PopButton onClick={() => onPop(card)} />}
        <iframe
          src={embedUrl}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; encrypted-media"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    )
  }

  return (
    <div
      className="relative"
      onClick={isPopped ? undefined : onPlay}
      style={{ position: 'relative', paddingBottom, cursor: isPopped ? 'default' : 'pointer' }}
    >
      {card.thumbnail_url ? (
        <img
          src={card.thumbnail_url}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.75)' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--s-surface-2)' }} />
      )}
      <PlatformBadge type={card.type} />
      <PriceBadge price={price} currency={currency} />
      {onPop && !isPopped && <PopButton onClick={() => onPop(card)} />}
      <div className="absolute inset-0 flex items-center justify-center">
        {isPopped ? (
          <div className="flex flex-col items-center gap-1.5" style={{ color: 'var(--s-accent)' }}>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4.5" width="18" height="15" rx="2" />
              <rect x="12" y="11" width="7.5" height="6" rx="1" fill="currentColor" stroke="none" />
            </svg>
            <span className="text-xs" style={{ letterSpacing: '0.06em' }}>playing in corner</span>
          </div>
        ) : (
          <motion.div
            whileHover={{ scale: 1.1 }}
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'var(--s-accent-strong)', boxShadow: '0 0 24px var(--s-accent-glow)' }}
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 ml-1" fill="var(--s-bg)">
              <path d="M8 5v14l11-7z" />
            </svg>
          </motion.div>
        )}
      </div>
    </div>
  )
}

function NotesEditor({ card, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(card.notes || '')

  const save = async () => {
    await onSave(card.id, value)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="cursor-text mt-2 text-xs rounded px-2 py-1.5 transition-colors"
        style={{
          background: value ? 'transparent' : 'var(--s-surface-2)',
          color: value ? 'var(--s-text-2)' : 'var(--s-border)',
          border: '1px dashed var(--s-border)',
          minHeight: 32
        }}
      >
        {value || 'add a note…'}
      </div>
    )
  }

  return (
    <div className="mt-2">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="notes, tags, anything searchable…"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
        className="w-full px-2 py-1.5 text-xs rounded resize-none"
        style={{
          background: 'var(--s-bg)',
          border: '1px solid var(--s-accent)',
          color: 'var(--s-text-1)',
          outline: 'none'
        }}
      />
      <div className="flex gap-1 mt-1">
        <button onClick={() => setEditing(false)} className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--s-border)' }}>cancel</button>
        <button onClick={save} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--s-accent)', color: 'var(--s-bg)' }}>save</button>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      {/* thumbnail placeholder */}
      <div className="relative flex items-center justify-center" style={{ height: 160, background: 'var(--s-surface-2)' }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 rounded-full"
          style={{ border: '2px solid var(--s-border)', borderTopColor: 'var(--s-accent)' }}
        />
      </div>
      {/* text placeholder bars */}
      <div className="p-3 flex flex-col gap-2">
        <motion.div
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
          className="h-3 rounded"
          style={{ background: 'var(--s-border)', width: '70%' }}
        />
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut', delay: 0.2 }}
          className="h-2 rounded"
          style={{ background: 'var(--s-border)', width: '90%' }}
        />
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut', delay: 0.4 }}
          className="h-2 rounded"
          style={{ background: 'var(--s-border)', width: '55%' }}
        />
      </div>
    </motion.div>
  )
}

export default function Card({ card, onDelete, onUpdate, nowPlayingId, onPlay, onPop, isPopped = false, canEdit = true, canServerAI = true }) {
  if (card.status === 'pending') return <SkeletonCard />
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [planGenerating, setPlanGenerating] = useState(false)
  const [planExpanded, setPlanExpanded] = useState(false)

  const hasEmbed = !!card.metadata?.embed_url
  const hasMedia = hasEmbed || card.thumbnail_url
  const plan = card.metadata?.plan || null

  const handleSaveNotes = async (id, notes) => {
    const updated = await api.updateCard(id, { title: card.title, description: card.description, notes })
    onUpdate(updated)
  }

  const handleScrape = useCallback(async (e) => {
    e.stopPropagation()
    setScraping(true)
    try {
      const updated = await api.scrapeCard(card.id)
      onUpdate(updated)
    } finally {
      setScraping(false)
    }
  }, [card.id, onUpdate])

  const handleGeneratePlan = useCallback(async (e) => {
    e.stopPropagation()
    setPlanGenerating(true)
    try {
      const updated = await api.generatePlan(card.id)
      onUpdate(updated)
      setPlanExpanded(true)
    } catch (err) {
      console.error('generate plan failed:', err.message)
    } finally {
      setPlanGenerating(false)
    }
  }, [card.id, onUpdate])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.03, zIndex: 5 }}
      transition={{ type: 'spring', damping: 24, stiffness: 320 }}
      className="rounded-xl overflow-hidden relative"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      {hasMedia && (
        <MediaEmbed
          card={card}
          price={card.metadata?.price}
          currency={card.metadata?.currency}
          playing={nowPlayingId === card.id}
          onPlay={() => onPlay(card)}
          onPop={hasEmbed ? onPop : undefined}
          isPopped={isPopped}
        />
      )}

      <div className="p-3">
        {/* Resolved from user_id at read time, so a rename updates every card at once */}
        {card.author && (
          <p className="text-xs mb-1" style={{ color: 'var(--s-text-3)', letterSpacing: '0.08em' }}>
            {card.author}
          </p>
        )}
        {card.title && (
          <p className="text-sm font-medium leading-snug mb-1 line-clamp-2" style={{ color: 'var(--s-text-0)' }}>
            {card.title}
          </p>
        )}
        {card.description && (
          <div>
            <p
              className="text-xs leading-relaxed cursor-pointer"
              style={{ color: 'var(--s-text-2)' }}
              onClick={() => setDescExpanded(v => !v)}
            >
              {descExpanded ? card.description : card.description.slice(0, 80) + (card.description.length > 80 ? '…' : '')}
            </p>
            {card.description.length > 80 && (
              <button
                onClick={() => setDescExpanded(v => !v)}
                className="text-xs mt-0.5"
                style={{ color: 'var(--s-border)' }}
              >
                {descExpanded ? 'less' : 'more'}
              </button>
            )}
          </div>
        )}
        {card.url && !hasMedia && (
          <a
            href={card.url} target="_blank" rel="noreferrer"
            className="text-xs mt-1 inline-flex items-center gap-1 hover:underline"
            style={{ color: 'var(--s-border)' }}
          >
            {(() => { try { return new URL(card.url).hostname.replace('www.', '') } catch { return card.url } })()}
            <span style={{ fontSize: 9 }}>↗</span>
          </a>
        )}

        {canEdit && <NotesEditor card={card} onSave={handleSaveNotes} />}

        {/* Plan panel */}
        {plan && (
          <div className="mt-3">
            <button
              onClick={() => setPlanExpanded(v => !v)}
              className="text-xs flex items-center gap-1 mb-1"
              style={{ color: 'var(--s-accent)' }}
            >
              <span style={{ fontSize: 10 }}>{planExpanded ? '▾' : '▸'}</span>
              tutorial plan
            </button>
            <AnimatePresence>
              {planExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    className="text-xs leading-relaxed rounded p-2 whitespace-pre-wrap"
                    style={{
                      background: 'var(--s-surface-2)',
                      color: 'var(--s-text-2)',
                      border: '1px solid var(--s-border)',
                      maxHeight: 320,
                      overflowY: 'auto'
                    }}
                  >
                    {plan}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Card footer actions — hidden on other people's cards, which you can't change anyway */}
        {canEdit && <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: '1px solid var(--s-surface-2)' }}>
          {/* scrape and plan run on the server's AI account, so they stay with the owner */}
          <div className="flex items-center gap-2">
            {canServerAI && <button
              onClick={handleScrape}
              disabled={scraping}
              className="text-xs px-2 py-1 rounded"
              style={{ color: scraping ? 'var(--s-border)' : 'var(--s-text-3)', background: 'transparent' }}
            >
              {scraping ? 'scraping…' : 'scrape'}
            </button>}
            {canServerAI && card.type === 'youtube' && (
              <button
                onClick={handleGeneratePlan}
                disabled={planGenerating}
                className="text-xs px-2 py-1 rounded"
                style={{
                  color: planGenerating ? 'var(--s-border)' : plan ? 'var(--s-text-3)' : 'var(--s-accent)',
                  background: 'transparent'
                }}
              >
                {planGenerating ? 'thinking…' : plan ? 'regen plan' : 'gen plan'}
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            {!confirmDelete ? (
              <motion.button
                key="del"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setConfirmDelete(true)}
                className="text-xs px-2 py-1 rounded"
                style={{ color: 'var(--s-text-3)' }}
              >
                delete
              </motion.button>
            ) : (
              <motion.button
                key="confirm"
                initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => onDelete(card.id)}
                className="text-xs px-2 py-1 rounded font-medium"
                style={{ background: 'rgba(180,40,0,0.85)', color: '#fff' }}
              >
                confirm delete
              </motion.button>
            )}
          </AnimatePresence>
        </div>}
      </div>
    </motion.div>
  )
}
