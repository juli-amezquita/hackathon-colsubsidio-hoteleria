// Almacenamiento de blobs de audio en IndexedDB.
// Los audios NO se guardan en localStorage (los blobs son pesados y exceden la
// cuota). En su lugar, cada entrada del conteo guarda un `audioId` que apunta
// al blob almacenado aquí.

const DB_NAME = 'colsubsidio-audio'
const DB_VERSION = 1
const STORE = 'clips'

let dbPromise: Promise<IDBDatabase> | null = null

function isSupported() {
  return typeof indexedDB !== 'undefined'
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function genAudioId() {
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Guarda un blob de audio y devuelve su id, o null si no se pudo. */
export async function saveAudio(blob: Blob): Promise<string | null> {
  if (!isSupported()) return null
  try {
    const db = await openDB()
    const id = genAudioId()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return id
  } catch {
    return null
  }
}

/** Recupera un blob de audio por id. */
export async function getAudio(id: string): Promise<Blob | null> {
  if (!isSupported() || !id) return null
  try {
    const db = await openDB()
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => resolve((req.result as Blob) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

/** Elimina un blob de audio por id. */
export async function deleteAudio(id: string): Promise<void> {
  if (!isSupported() || !id) return
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // noop
  }
}

/** Devuelve una object URL para reproducir el audio, o null. Recuerda revocarla. */
export async function getAudioUrl(id: string): Promise<string | null> {
  const blob = await getAudio(id)
  return blob ? URL.createObjectURL(blob) : null
}
