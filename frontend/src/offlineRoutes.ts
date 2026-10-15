import type { SavedRoute } from "./api";

export type OfflineSavedRoute = SavedRoute & {
  offline_saved_at: number;
  synced: boolean;
};

const DATABASE = "ratha-offline-library";
const STORE = "routes";
const VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) return Promise.reject(new Error("This browser does not support offline route storage."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline route storage."));
    request.onblocked = () => reject(new Error("Offline route storage is busy in another tab. Close the other tab and try again."));
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    let result: T;
    let hasResult = false;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      request.onsuccess = () => { result = request.result; hasResult = true; };
      request.onerror = () => reject(request.error ?? new Error("Offline route storage failed."));
      transaction.oncomplete = () => {
        database.close();
        if (hasResult) resolve(result);
        else reject(new Error("Offline route storage returned no result."));
      };
      transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Offline route storage failed.")); };
      transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Offline route storage was interrupted.")); };
    } catch (error) {
      database.close();
      reject(error);
    }
  }));
}

export function getOfflineRoutes(): Promise<OfflineSavedRoute[]> {
  return run<OfflineSavedRoute[]>("readonly", (store) => store.getAll())
    .then((routes) => routes.sort((a, b) => b.offline_saved_at - a.offline_saved_at));
}

export function getOfflineRoute(id: string): Promise<OfflineSavedRoute | undefined> {
  return run<OfflineSavedRoute | undefined>("readonly", (store) => store.get(id));
}

export async function saveOfflineRoute(route: SavedRoute, synced = false): Promise<OfflineSavedRoute> {
  const previous = await getOfflineRoute(route.id);
  const saved: OfflineSavedRoute = {
    ...route,
    offline_saved_at: previous?.offline_saved_at ?? Date.now(),
    synced: synced || previous?.synced === true,
  };
  await run<IDBValidKey>("readwrite", (store) => store.put(saved));
  return saved;
}

export async function setOfflineRouteSynced(id: string, synced: boolean): Promise<void> {
  const route = await getOfflineRoute(id);
  if (route) await run<IDBValidKey>("readwrite", (store) => store.put({ ...route, synced }));
}

export function deleteOfflineRoute(id: string): Promise<undefined> {
  return run<undefined>("readwrite", (store) => store.delete(id));
}
