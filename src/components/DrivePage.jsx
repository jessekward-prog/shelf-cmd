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

  const doUpload = useCallback(async (list) => {
    const arr = Array.from(list)
    if (!arr.length) return
    setUploading(u => u + arr.length)
    for (const file of arr) {
      try {
        const created = await api.uploadFile(categoryId, file, subcategoryId)
        setFiles(prev => [created, ...prev])
        poll(created.id)
      } catch (err) {
        window.alert(`could not upload ${file.name} — ${err.message}`)
      }
      setUploading(u => u - 1)
    }
  }, [categoryId, subcategoryId, poll])

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files)
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
      {/* Drop / upload bar */}
      <button
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-xl mb-4 flex flex-col items-center justify-center gap-1 transition-colors"
        style={{
          padding: '1.5rem',
          border: `1.5px dashed ${dragging ? 'var(--s-accent)' : 'var(--s-border)'}`,
          background: dragging ? 'var(--s-accent-faint)' : 'transparent',
          color: dragging ? 'var(--s-accent)' : 'var(--s-text-2)'
        }}
      >
        <span className="text-2xl" style={{ opacity: 0.5 }}>↑</span>
        <span className="text-sm">{dragging ? 'drop to upload' : 'drop files here, or click to choose'}</span>
        {uploading > 0 && <span className="text-xs mt-1" style={{ color: 'var(--s-accent)' }}>uploading {uploading}…</span>}
      </button>
      <input ref={inputRef} type="file" multiple hidden
        onChange={(e) => { doUpload(e.target.files); e.target.value = '' }} />

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
