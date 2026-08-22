const base = '/api'
const TOKEN_KEY = 'shelf_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

async function req(method, path, body) {
  const token = getToken()
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return res.json()
}

export const getCategories = () => req('GET', '/categories')
export const createCategory = (name, icon) => req('POST', '/categories', { name, icon })
export const updateCategory = (id, data) => req('PUT', `/categories/${id}`, data)
export const deleteCategory = (id) => req('DELETE', `/categories/${id}`)

export const getSubcategories = (catId) => req('GET', `/categories/${catId}/subcategories`)
export const createSubcategory = (catId, name) => req('POST', `/categories/${catId}/subcategories`, { name })
export const deleteSubcategory = (id) => req('DELETE', `/subcategories/${id}`)
export const reorderCategories = (order) => req('PUT', '/categories/reorder', { order })
export const reorderSubcategories = (order) => req('PUT', '/subcategories/reorder', { order })

export const getCards = (catId, subcatId) =>
  req('GET', `/categories/${catId}/cards${subcatId ? `?subcategory_id=${subcatId}` : ''}`)
export const createCard = (data) => req('POST', '/cards', data)
export const getCard = (id) => req('GET', `/cards/${id}`)
export const updateCard = (id, data) => req('PUT', `/cards/${id}`, data)
// data may include { title, description, notes }
export const deleteCard = (id) => req('DELETE', `/cards/${id}`)
export const scrapeCard = (id) => req('POST', `/cards/${id}/scrape`, {})
export const generatePlan = (id) => req('POST', `/cards/${id}/plan`, {})

export const getNotes    = ()           => req('GET',    '/notes')
export const createNote  = (data)       => req('POST',   '/notes', data)
export const deleteNote  = (id)         => req('DELETE', `/notes/${id}`)

// ── Collaborative shelves ────────────────────────────────────────────────────

export const getMe = () => req('GET', '/me')
export const setUsername = (username) => req('PUT', '/me', { username })
export const getInvite = (catId) => req('POST', `/categories/${catId}/invite`, {})
export const getMembers = (catId) => req('GET', `/categories/${catId}/members`)
export const prepare = (url) => req('POST', '/prepare', { url })

// ── Drive: files stored on a shelf ───────────────────────────────────────────

export const getFiles = (catId) => req('GET', `/categories/${catId}/files`)
export const getFile = (id) => req('GET', `/files/${id}`)
export const deleteFile = (id) => req('DELETE', `/files/${id}`)
export const shareFile = (id) => req('POST', `/files/${id}/share`, {})

export function uploadFile(catId, file, subcatId, name) {
  const form = new FormData()
  // Text fields before the file — multer only guarantees req.body for fields
  // that arrive ahead of the file part.
  if (subcatId) form.append('subcategory_id', subcatId)
  if (name) form.append('name', name)
  form.append('file', file)
  return fetch(`${base}/categories/${catId}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form
  }).then(r => { if (!r.ok) throw new Error(`upload → ${r.status}`); return r.json() })
}

// <img>/<a> can't send the auth header, so the owner token rides as ?t=
const tok = () => encodeURIComponent(getToken())
export const fileThumbUrl = (id) => `${base}/files/${id}/thumb?t=${tok()}`
export const fileRawUrl = (id, download) => `${base}/files/${id}/raw?t=${tok()}${download ? '&dl=1' : ''}`
export const shareUrl = (token) => `${location.origin}/s/${token}`
// Files on a shelf you joined: the server hands back a ready-made proxy path,
// which still needs the same ?t= treatment to get past the auth gate.
export const proxiedUrl = (path, download) => `${path}?t=${tok()}${download ? '&dl=1' : ''}`

// ── Folders (a path prefix inside a shelf's drive) ───────────────────────────
export const deleteFolder = (catId, prefix) =>
  req('DELETE', `/categories/${catId}/folder?prefix=${encodeURIComponent(prefix)}`)
export const shareFolder = (catId, prefix) =>
  req('POST', `/categories/${catId}/folder/share`, { prefix })
export const folderZipUrl = (catId, prefix) =>
  `${base}/categories/${catId}/folder/zip?prefix=${encodeURIComponent(prefix)}&t=${tok()}`
export const folderShareUrl = (token) => `${location.origin}/s/f/${token}`

// ── Hub (federation) ────────────────────────────────────────────────────────
// A code links someone else's shelf into THIS instance as a real local category.
export const linkShelf = (code) => req('POST', '/link', { code })
export const syncShelf = (catId) => req('POST', `/categories/${catId}/sync`, {})
export const getHubStatus = () => req('GET', '/hub')

// ── Guides (generated standalone HTML) ───────────────────────────────────────
// Surfaces the server's error text, which carries the real reason a guide failed.
export async function generateGuide(url) {
  const res = await fetch(base + '/guide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: JSON.stringify({ url })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `guide → ${res.status}`)
  return data
}
export const getGuides   = ()   => req('GET',    '/guides')
export const getGuide    = (id) => req('GET',    `/guides/${id}`)
export const deleteGuide = (id) => req('DELETE', `/guides/${id}`)
