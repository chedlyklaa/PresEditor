// Presentation library dashboard (Milestone C): a tiny IndexedDB-backed
// queue of at-most-one pending save per cloud project. Used by
// EditorContext.tsx's cloud autosave effect when a PUT to /api/projects/:id
// fails (server unreachable) — the attempted content is stashed here so it
// survives a page reload while offline, and is retried on the next boot or
// reconnect rather than silently lost. Deliberately hand-rolled (not the
// `idb` package): the need is one small object store, not worth a
// dependency for this little code.
const DB_NAME = 'presEditorOfflineQueue';
const DB_VERSION = 1;
const STORE = 'pendingSaves';

export interface QueuedSave {
  projectId: string;
  title: string;
  json: unknown;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'projectId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

// Every function below swallows its own errors and resolves anyway — this
// queue is a best-effort safety net, never something the caller needs to
// handle a rejection for (a private-browsing tab with IndexedDB disabled
// should degrade to "no offline persistence", not throw).

export async function queueSave(projectId: string, payload: { title: string; json: unknown }): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ projectId, ...payload, queuedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* best-effort */
  }
}

export async function getQueuedSave(projectId: string): Promise<QueuedSave | null> {
  try {
    const db = await openDb();
    const result = await new Promise<QueuedSave | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(projectId);
      req.onsuccess = () => resolve((req.result as QueuedSave) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearQueuedSave(projectId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* best-effort */
  }
}
