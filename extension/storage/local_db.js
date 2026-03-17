const DB_NAME = "writior_extension_v2";
const DB_VERSION = 2;
const STORE_NAMES = ["captures", "notes", "quotes", "citations", "queue", "sync_meta", "activity"];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of STORE_NAMES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexeddb_open_failed"));
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = callback(store);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("indexeddb_tx_failed"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("indexeddb_tx_aborted"));
    };
  });
}

export async function listRecords(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error || new Error("indexeddb_read_failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

export async function getRecord(storeName, id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("indexeddb_get_failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

export async function putRecord(storeName, value) {
  await withStore(storeName, "readwrite", (store) => {
    store.put(value);
  });
  return value;
}

export async function deleteRecord(storeName, id) {
  await withStore(storeName, "readwrite", (store) => {
    store.delete(id);
  });
}

export async function clearStore(storeName) {
  await withStore(storeName, "readwrite", (store) => {
    store.clear();
  });
}
