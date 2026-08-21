import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as api from '../api.js'
import FileCard from './FileCard.jsx'
import FolderCard from './FolderCard.jsx'
import ShareModal from './ShareModal.jsx'

// Folders are the path prefixes stored in each file's name, so an uploaded
// folder stays one thing you open rather than 70 loose cards.
function listing(files, path) {
  const prefix = path ? path + '/' : ''
  const here = [], folders = new Map()
  for (const f of files) {
    if (!f.name.startsWith(prefix)) continue
    const rest = f.name.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) { here.push(f); continue }
    const dir = rest.slice(0, slash)
    const agg = folders.get(dir) || { name: dir, prefix: prefix + dir, count: 0, size: 0 }
    agg.count++; agg.size += Number(f.size) || 0
    folders.set(dir, agg)
  }
  return {
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    files: here
  }
}

export default function DrivePage({ categoryId, subcategoryId }) {
  const [files, setFiles] = useState([])
  const [path, setPath] = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [shareFile, setShareFile] = useState(null)
  const [shareFolder, setShareFolder] = useState(null)
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
    setPath('')
    api.getFiles(categoryId).then(loaded => {
      setFiles(loaded)
      loaded.filter(f => f.status === 'pending').forEach(f => poll(f.id))
    }).catch(() => setFiles([]))
    return () => { Object.values(pollers.current).forEach(clearInterval); pollers.current = {} }
  }, [categoryId, poll])

  const view = listing(files, path)
  const crumbs = path ? path.split('/') : []

  const handleDeleteFolder = async (folder) => {
    await api.deleteFolder(categoryId, folder.prefix)
    setFiles(prev => prev.filter(f => !f.name.startsWith(folder.prefix + '/')))
  }

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

      {/* Breadcrumb — only once you're inside a folder */}
      {crumbs.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3 text-xs">
          <button onClick={() => setPath('')} style={{ color: 'var(--s-accent)' }}>drive</button>
          {crumbs.map((c, i) => {
            const to = crumbs.slice(0, i + 1).join('/')
            const last = i === crumbs.length - 1
            return (
              <span key={to} className="flex items-center gap-1.5">
                <span style={{ color: 'var(--s-text-3)' }}>/</span>
                {last
                  ? <span style={{ color: 'var(--s-text-1)' }}>{c}</span>
                  : <button onClick={() => setPath(to)} style={{ color: 'var(--s-accent)' }}>{c}</button>}
              </span>
            )
          })}
        </div>
      )}

      {view.folders.length === 0 && view.files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-2xl mb-3" style={{ opacity: 0.2 }}>▤</p>
          <p className="text-sm" style={{ color: 'var(--s-border)' }}>
            {path ? 'this folder is empty' : 'no files on this shelf yet'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--s-surface-2)' }}>
            {path ? 'go back to the drive to add more' : 'drop a folder and it stays one folder'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          <AnimatePresence mode="popLayout">
            {view.folders.map(f => (
              <FolderCard
                key={'d:' + f.prefix}
                folder={{ ...f, categoryId }}
                onOpen={setPath}
                onDelete={handleDeleteFolder}
                onShare={setShareFolder}
              />
            ))}
            {view.files.map(f => (
              <FileCard key={f.id} file={f} onDelete={handleDelete} onShare={setShareFile} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {shareFile && <ShareModal file={shareFile} onClose={() => setShareFile(null)} />}
        {shareFolder && (
          <ShareModal
            key="folder"
            file={{ name: shareFolder.name + '/' }}
            getLink={async () => {
              const { token } = await api.shareFolder(categoryId, shareFolder.prefix)
              return api.folderShareUrl(token)
            }}
            note="Anyone with this link can download the whole folder as a .zip."
            onClose={() => setShareFolder(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
