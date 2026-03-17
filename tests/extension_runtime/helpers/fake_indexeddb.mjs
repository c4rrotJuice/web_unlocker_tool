class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }
}

class FakeObjectStore {
  constructor(records) {
    this.records = records;
  }

  getAll() {
    const request = new FakeRequest();
    queueMicrotask(() => {
      request.result = Array.from(this.records.values()).map((value) => structuredClone(value));
      request.onsuccess?.();
    });
    return request;
  }

  get(id) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      request.result = this.records.has(id) ? structuredClone(this.records.get(id)) : undefined;
      request.onsuccess?.();
    });
    return request;
  }

  put(value) {
    this.records.set(value.id, structuredClone(value));
  }

  delete(id) {
    this.records.delete(id);
  }

  clear() {
    this.records.clear();
  }
}

class FakeTransaction {
  constructor(stores, storeName) {
    this.stores = stores;
    this.storeName = storeName;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    queueMicrotask(() => {
      this.oncomplete?.();
    });
  }

  objectStore(name) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return new FakeObjectStore(this.stores.get(name));
  }

  abort() {
    this.onabort?.();
  }
}

class FakeDatabase {
  constructor(stores) {
    this.stores = stores;
    this.objectStoreNames = {
      contains: (name) => this.stores.has(name),
    };
  }

  createObjectStore(name) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return new FakeObjectStore(this.stores.get(name));
  }

  transaction(storeName) {
    return new FakeTransaction(this.stores, storeName);
  }

  close() {}
}

export function installFakeIndexedDb() {
  const databases = new Map();

  globalThis.indexedDB = {
    open(name) {
      const request = new FakeRequest();
      queueMicrotask(() => {
        let stores = databases.get(name);
        const isUpgrade = !stores;
        if (!stores) {
          stores = new Map();
          databases.set(name, stores);
        }
        request.result = new FakeDatabase(stores);
        if (isUpgrade) {
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    reset() {
      databases.clear();
    },
  };
}
