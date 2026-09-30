// A deliberately tiny IndexedDB wrapper for the offline store. Nothing else in the app touches IndexedDB.
//
// What is stored here, and why it is safe enough:
//  * `rosters`: id + name + member code of the members a signed-in user may record attendance for, downloaded
//    on purpose and discarded after 24 hours, on logout, and when the session expires (see session.ts);
//  * `outbox`: check-ins recorded while offline (operation id, activity id, member id, time) - no names.
// No access token, refresh token, e-mail address, phone number or financial data is ever written here.

const DB_NAME = 'fems-offline';
const VERSION = 1;

export type StoreName = 'rosters' | 'outbox';

let opening: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rosters')) db.createObjectStore('rosters', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('outbox')) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'opId' });
        outbox.createIndex('byUser', 'userId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
    req.onblocked = () => { opening = null; reject(new Error('IndexedDB is blocked')); };
  });
  return opening;
}

/** Drops the cached connection (tests reopen a fresh database between cases). */
export function resetDbConnection(): void {
  opening?.then((db) => db.close()).catch(() => undefined);
  opening = null;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  const result = wrap(fn(tx.objectStore(store)));
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  return result;
}

export const idbGet = <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key));
export const idbPut = <T>(store: StoreName, value: T) => run(store, 'readwrite', (s) => s.put(value)).then(() => undefined);
export const idbDelete = (store: StoreName, key: string) => run(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
export const idbAll = <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll());
export const idbClear = (store: StoreName) => run(store, 'readwrite', (s) => s.clear()).then(() => undefined);
export const idbAllByIndex = <T>(store: StoreName, index: string, key: string) => run<T[]>(store, 'readonly', (s) => s.index(index).getAll(key));
