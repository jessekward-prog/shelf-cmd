import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'
import FileCard from './FileCard.jsx'
import ShareModal from './ShareModal.jsx'

export default function DrivePage({ categoryId, subcategoryId }) {
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [shareFile, setShareFile] = useState(null)
  const inputRef = useRef(null)
  const folderRef = useRef(null)
  const pollers = useRef({})

  const poll = useCallback((id) => {
    if (pollers.current[id]) return
    pollers.current[id] = setInterval(async () => {
      try {
        const f = await api.getFile(id)
        if (f.status === 'ready') {
          clearInterval(pollers.current[id]); delete pollers.current[id]
          setFiles(prev => prev.map(x => x.id === id ? f : x))
        }
      } catch { clearInterval(pollers.current[id]); delete pollers.current[id] }
    }, 2000)
  }, [])

  useEffect(() => {
    api.getFiles(categoryId).then(loaded => {
      setFiles(loaded)
      loaded.filter(f => f.status === 'pending').forEach(f => poll(f.id))
    }).catch(() => setFiles([]))
    return () => { Object.values(pollers.current).forEach(clearInterval); pollers.current = {} }
  }, [categoryId, poll])

  // Each item is { file, name } — name carries a folder path when present.
  const doUpload = useCallback(async (items) => {
    if (!items.length) return
    setUploading(u => u + items.length)
    for (const { file, name } of items) {
      try {
        const created = await api.uploadFile(categoryId, file, subcategoryId, name)
        setFiles(prev => [created, ...prev])
        poll(created.id)
      } catch (err) {
        window.alert(`could not upload ${name || file.name} — ${err.message}`)
      }
      setUploading(u => u - 1)
    }
  }, [categoryId, subcategoryId, poll])

  // A plain <input> gives Files; a folder input tags each with webkitRelativePath.
  const fromFileList = (list) =>
    Array.from(list).map(file => ({ file, name: file.webkitRelativePath || file.name }))

  // Walk a dropped directory tree into a flat list of files with their paths.
  // Resilient per-entry: one unreadable file can't sink the whole drop.
  const collectEntry = async (entry, prefix = '') => {
    try {
      if (entry.isFile) {
        return await new Promise(res => entry.file(f => res([{ file: f, name: prefix + f.name }]), () => res([])))
      }
      const reader = entry.createReader()
      const readAll = () => new Promise(res => {
        const all = []
        const next = () => reader.readEntries(batch => batch.length ? (all.push(...batch), next()) : res(all), () => res(all))
        next()
      })
      const kids = await readAll()
      return (await Promise.all(kids.map(k => collectEntry(k, prefix + entry.name + '/')))).flat()
    } catch { return [] }
  }

  // A dragged folder can also surface as a size-0, typeless pseudo-file; that's
  // not something we can read, so never try to upload it as a file.
  const looksLikeDir = (file) => file.size === 0 && file.type === '' && !file.name.includes('.')

  const onDrop = async (e) => {
    e.preventDefault(); setDragging(false)
    const dt = e.dataTransfer
    // Capture entries synchronously — the list goes stale after the first await.
    const entries = dt.items?.length
      ? Array.from(dt.items).map(i => i.webkitGetAsEntry?.()).filter(Boolean)
      : []
    // The entry API walks folders and plain files alike; use it whenever it works.
    if (entries.length) {
      const collected = (await Promise.all(entries.map(en => collectEntry(en)))).flat()
      if (collected.length) return doUpload(collected)
    }
    // Fallback for browsers without the entry API — flat files only, and never a
    // directory masquerading as a 0-byte file.
    const files = fromFileList(dt.files || []).filter(({ file }) => !looksLikeDir(file))
    if (files.length) doUpload(files)
    else window.alert('Your browser blocked reading that folder on drop — use the “upload a folder” button instead.')
  }

  const handleDelete = async (id) => {
    await api.deleteFile(id)
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
      className="px-4 pb-24 lg:px-8 lg:pb-10 relative"
      style={{ minHeight: '50vh' }}
    >
      {/* Drop / upload bar — files or a whole folder */}
      <div
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-xl mb-4 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
        style={{
          padding: '1.5rem',
          border: `1.5px dashed ${dragging ? 'var(--s-accent)' : 'var(--s-border)'}`,
          background: dragging ? 'var(--s-accent-faint)' : 'transparent',
          color: dragging ? 'var(--s-accent)' : 'var(--s-text-2)'
        }}
      >
        <span className="text-2xl" style={{ opacity: 0.5 }}>↑</span>
        <span className="text-sm">{dragging ? 'drop to upload' : 'drop files or a folder, or click to choose'}</span>
        <button
          onClick={(e) => { e.stopPropagation(); folderRef.current?.click() }}
          className="text-xs mt-1 underline"
          style={{ color: 'var(--s-accent)', textUnderlineOffset: 3 }}
        >
          upload a folder
        </button>
        {uploading > 0 && <span className="text-xs mt-1" style={{ color: 'var(--s-accent)' }}>uploading {uploading}…</span>}
      </div>
      <input ref={inputRef} type="file" multiple hidden
        onChange={(e) => { doUpload(fromFileList(e.target.files)); e.target.value = '' }} />
      <input ref={folderRef} type="file" multiple hidden webkitdirectory="" directory=""
        onChange={(e) => { doUpload(fromFileList(e.target.files)); e.target.value = '' }} />

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-2xl mb-3" style={{ opacity: 0.2 }}>▤</p>
          <p className="text-sm" style={{ color: 'var(--s-border)' }}>no files on this shelf yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--s-surface-2)' }}>each upload becomes a card with a shareable link</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          <AnimatePresence mode="popLayout">
            {files.map(f => (
              <FileCard key={f.id} file={f} onDelete={handleDelete} onShare={setShareFile} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {shareFile && <ShareModal file={shareFile} onClose={() => setShareFile(null)} />}
      </AnimatePresence>
    </div>
  )
}
