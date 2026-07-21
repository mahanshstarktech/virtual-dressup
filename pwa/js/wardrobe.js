// ═══════════════════════════════════════════════
//  Drape — Wardrobe Database (IndexedDB)
// ═══════════════════════════════════════════════

const DB_NAME    = 'drape-wardrobe';
const DB_VERSION = 1;
const STORE_NAME = 'garments';

let db = null;

/**
 * Open (or create) the IndexedDB database
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('category',  'category',  { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Add a garment to the wardrobe
 * @param {Object} garment - { id, name, category, color, imageDataURL, processedImageDataURL, createdAt }
 */
export async function addGarment(garment) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add(garment);
    req.onsuccess = () => resolve(garment);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Get all garments, optionally filtered by category
 */
export async function getAllGarments(category = null) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => {
      let results = req.result;
      if (category) {
        results = results.filter(g => g.category === category);
      }
      // Sort by newest first
      results.sort((a, b) => b.createdAt - a.createdAt);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get a single garment by ID
 */
export async function getGarment(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Delete a garment by ID
 */
export async function deleteGarment(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Update a garment's metadata
 */
export async function updateGarment(id, updates) {
  const database = await openDB();
  return new Promise(async (resolve, reject) => {
    const existing = await getGarment(id);
    if (!existing) { reject(new Error('Garment not found')); return; }
    const updated = { ...existing, ...updates };
    const tx    = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put(updated);
    req.onsuccess = () => resolve(updated);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Get wardrobe statistics
 */
export async function getWardrobeStats() {
  const garments = await getAllGarments();
  const categories = {};
  garments.forEach(g => {
    categories[g.category] = (categories[g.category] || 0) + 1;
  });
  return {
    total: garments.length,
    categories,
    recent: garments.slice(0, 5),
  };
}
