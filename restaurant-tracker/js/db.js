// IndexedDB storage. Everything (including photos) stays on this device
// unless you export it from Settings.
import { isValidRating, isValidDate } from './util.js';

const DB_NAME = 'family-eats';
const VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('restaurants', { keyPath: 'id' });
      const visits = db.createObjectStore('visits', { keyPath: 'id' });
      visits.createIndex('restaurantId', 'restaurantId');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  });
}

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
export const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));

export function checkVisit(v) {
  if (!isValidRating(v.rating)) throw new Error('Rating must be a whole number from 1 to 5.');
  if (!isValidDate(v.date)) throw new Error('Please choose a valid date (today or earlier).');
  if (!v.restaurantId) throw new Error('Visit is missing its restaurant.');
}

export async function saveVisit(v) {
  checkVisit(v);
  await put('visits', v);
}

export async function visitsFor(restaurantId) {
  return tx('visits', 'readonly', (s) => s.index('restaurantId').getAll(restaurantId));
}

export async function deleteRestaurant(id) {
  for (const v of await visitsFor(id)) await del('visits', v.id);
  await del('restaurants', id);
}

export async function getSettings() {
  return (await get('meta', 'settings'))?.value ?? { family: [] };
}

export const saveSettings = (value) => put('meta', { key: 'settings', value });

// ---- Backup / sharing between family phones ----

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export async function exportAll() {
  const visits = await getAll('visits');
  for (const v of visits) v.photos = await Promise.all((v.photos ?? []).map(blobToDataUrl));
  return {
    app: 'family-eats',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    restaurants: await getAll('restaurants'),
    visits,
  };
}

// Merges a backup into this device. Records with the same id are overwritten
// by the version that was updated most recently.
export async function importAll(data) {
  if (data?.app !== 'family-eats') throw new Error('That file is not a Family Eats backup.');
  let added = 0;
  let skipped = 0;
  for (const r of data.restaurants ?? []) {
    const existing = await get('restaurants', r.id);
    if (!existing || (r.updatedAt ?? '') >= (existing.updatedAt ?? '')) await put('restaurants', r);
  }
  for (const v of data.visits ?? []) {
    try {
      checkVisit(v);
    } catch {
      skipped++;
      continue;
    }
    const existing = await get('visits', v.id);
    if (existing && (existing.updatedAt ?? '') > (v.updatedAt ?? '')) continue;
    v.photos = await Promise.all((v.photos ?? []).map((u) => fetch(u).then((res) => res.blob())));
    await put('visits', v);
    added++;
  }
  const mine = await getSettings();
  const family = [...new Set([...mine.family, ...(data.settings?.family ?? [])])];
  await saveSettings({ ...mine, family });
  return { added, skipped };
}
