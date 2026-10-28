// A form's draft, kept in the browser's IndexedDB so a reload restores it. IndexedDB stores a
// `File` as it is, which a draft holds (a proof image, a file still uploading) and
// `localStorage` cannot. Each call opens the database and closes it; any failure (a private
// window, blocked site data) reads as no draft and stores nothing.

/** Whether the browser offers IndexedDB at all; without it a form starts empty at once. */
export function canStoreDrafts(): boolean {
  return typeof indexedDB !== "undefined";
}

const DATABASE = "vidit-drafts";
const STORE = "drafts";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = act(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function readDraft<T>(key: string): Promise<T | null> {
  try {
    return ((await inStore("readonly", (store) => store.get(key))) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function writeDraft(key: string, draft: unknown): Promise<void> {
  try {
    await inStore("readwrite", (store) => store.put(draft, key));
  } catch {
    // A reload then restores an older draft, or none; the form itself keeps working.
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    await inStore("readwrite", (store) => store.delete(key));
  } catch {
    // The draft stays, and the next visit restores it.
  }
}
