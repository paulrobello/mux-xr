/** A stored picture: the downscaled re-encoded blob, keyed by its frame id. */
export interface PictureRecord {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

export interface PictureLimits {
  maxFrames: number;
  maxBytes: number;
}

export const PICTURE_LIMITS: PictureLimits = { maxFrames: 8, maxBytes: 32 * 1024 * 1024 };

/** Persistence seam: IndexedDB in the browser, an in-memory map in tests. */
export interface PictureStorage {
  list(): Promise<PictureRecord[]>;
  put(record: PictureRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

interface Footprint {
  id: string;
  createdAt: number;
  blob: { size: number };
}

/**
 * Ids to evict, oldest first, so `existing` plus one more picture of `incomingBytes` fits
 * `limits`. Throws when the incoming picture alone exceeds the byte budget.
 */
export function planEviction(
  existing: readonly Footprint[],
  incomingBytes: number,
  limits: PictureLimits = PICTURE_LIMITS,
): string[] {
  if (incomingBytes > limits.maxBytes) throw new RangeError('Picture exceeds the storage budget');
  const remaining = [...existing].sort((a, b) => a.createdAt - b.createdAt);
  let bytes = remaining.reduce((total, record) => total + record.blob.size, 0);
  const evicted: string[] = [];
  while (
    remaining.length > 0 &&
    (remaining.length + 1 > limits.maxFrames || bytes + incomingBytes > limits.maxBytes)
  ) {
    const oldest = remaining.shift() as Footprint;
    bytes -= oldest.blob.size;
    evicted.push(oldest.id);
  }
  return evicted;
}

export interface PictureLibrary {
  /** Every stored picture, oldest first. */
  list(): Promise<PictureRecord[]>;
  /** Stores `record`, first evicting the oldest pictures the limits require; returns their ids. */
  add(record: PictureRecord): Promise<string[]>;
  delete(id: string): Promise<void>;
}

export function createPictureLibrary(
  storage: PictureStorage,
  limits: PictureLimits = PICTURE_LIMITS,
): PictureLibrary {
  const list = async (): Promise<PictureRecord[]> =>
    (await storage.list()).sort((a, b) => a.createdAt - b.createdAt);
  return {
    list,
    async add(record): Promise<string[]> {
      const existing = (await list()).filter((entry) => entry.id !== record.id);
      const evicted = planEviction(existing, record.blob.size, limits);
      for (const id of evicted) await storage.delete(id);
      await storage.put(record);
      return evicted;
    },
    delete: (id) => storage.delete(id),
  };
}

export function createMemoryPictureStorage(): PictureStorage & {
  records: Map<string, PictureRecord>;
} {
  const records = new Map<string, PictureRecord>();
  return {
    records,
    list: async () => [...records.values()],
    put: async (record) => {
      records.set(record.id, record);
    },
    delete: async (id) => {
      records.delete(id);
    },
  };
}

const DB_NAME = 'mux-xr-pictures';
const STORE = 'pictures';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** IndexedDB storage; every call rejects when IndexedDB is unavailable. */
export function createIndexedDBPictureStorage(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): PictureStorage {
  let database: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'));
    database ??= new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
    database.catch(() => {
      database = null;
    });
    return database;
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    const transaction = db.transaction(STORE, mode);
    const result = request(body(transaction.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'));
    });
    return result;
  };
  return {
    list: () => run('readonly', (store) => store.getAll() as IDBRequest<PictureRecord[]>),
    put: async (record) => {
      await run('readwrite', (store) => store.put(record));
    },
    delete: async (id) => {
      await run('readwrite', (store) => store.delete(id));
    },
  };
}
