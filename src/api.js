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
export const join = (code, username) => req('POST', '/join', { code, username })
export const getInvite = (catId) => req('POST', `/categories/${catId}/invite`, {})
export const getMembers = (catId) => req('GET', `/categories/${catId}/members`)
export const getMyShelves = () => req('GET', '/my-shelves')
export const getShelfSubcategories = (catId) => req('GET', `/shelves/${catId}/subcategories`)
export const getShelfCards = (catId, subcatId) =>
  req('GET', `/shelves/${catId}/cards${subcatId ? `?subcategory_id=${subcatId}` : ''}`)
export const prepare = (url) => req('POST', '/prepare', { url })
