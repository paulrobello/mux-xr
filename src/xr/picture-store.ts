import type { PictureDepthView } from './picture-depth';

/** A stored picture: the downscaled re-encoded blob, keyed by its frame id. */
export interface PictureRecord {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
  /** The right eye of a stereo pair (an iPhone spatial photo); `blob` is then the left eye. */
  right?: Blob;
  /** The depth map from the paired Mac (8-bit PNG, near bright); absent until estimated. */
  depth?: Blob;
  /** How the frame shows its depth; absent means the default view. */
  depthView?: PictureDepthView;
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
  right?: { size: number };
  depth?: { size: number };
}

const footprintBytes = (record: Footprint): number =>
  record.blob.size + (record.right?.size ?? 0) + (record.depth?.size ?? 0);

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
  let bytes = remaining.reduce((total, record) => total + footprintBytes(record), 0);
  const evicted: string[] = [];
  while (
    remaining.length > 0 &&
    (remaining.length + 1 > limits.maxFrames || bytes + incomingBytes > limits.maxBytes)
  ) {
    const oldest = remaining.shift() as Footprint;
    bytes -= footprintBytes(oldest);
    evicted.push(oldest.id);
  }
  return evicted;
}

export interface PictureLibrary {
  /** Every stored picture, oldest first. */
  list(): Promise<PictureRecord[]>;
  /** Stores `record`, first evicting the oldest pictures the limits require; returns their ids. */
  add(record: PictureRecord): Promise<string[]>;
  /** Stores a depth map or view for an existing picture; false when the picture is gone. */
  update(id: string, patch: Pick<PictureRecord, 'depth' | 'depthView'>): Promise<boolean>;
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
      const evicted = planEviction(existing, footprintBytes(record), limits);
      for (const id of evicted) await storage.delete(id);
      await storage.put(record);
      return evicted;
    },
    async update(id, patch): Promise<boolean> {
      const record = (await storage.list()).find((entry) => entry.id === id);
      if (!record) return false;
      // A depth map is a few hundred kB; it rides on the picture's own slot, never evicting another.
      await storage.put({
        ...record,
        ...(patch.depth ? { depth: patch.depth } : {}),
        ...(patch.depthView ? { depthView: patch.depthView } : {}),
      });
      return true;
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

/** A Recent gallery entry: the stored picture plus a small thumbnail for the gallery grid. */
export interface RecentPictureRecord {
  id: string;
  name: string;
  blob: Blob;
  thumbnail: Blob;
  /** The right eye of a stereo pair; `blob` is then the left eye. */
  right?: Blob;
  width: number;
  height: number;
  /** Identifies the source (URL or file) so picking it again refreshes one entry. */
  sourceKey: string;
  lastUsedAt: number;
}

export const RECENT_PICTURE_LIMITS: PictureLimits = { maxFrames: 12, maxBytes: 48 * 1024 * 1024 };

export interface RecentPictureStorage {
  list(): Promise<RecentPictureRecord[]>;
  put(record: RecentPictureRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface RecentPictureLibrary {
  /** Every entry, most recently used first. */
  list(): Promise<RecentPictureRecord[]>;
  get(id: string): Promise<RecentPictureRecord | undefined>;
  /**
   * Stores `record`, replacing an entry with the same source, then evicts the least recently used
   * entries the limits require; returns how many were evicted.
   */
  add(record: RecentPictureRecord): Promise<number>;
  /** Marks an entry used now, so eviction keeps it longest. */
  touch(id: string, at: number): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * The Recent gallery, separate from the live frames: closing a frame deletes its live blob, but
 * the picture stays here until it is the least recently used entry past the bound.
 */
export function createRecentPictureLibrary(
  storage: RecentPictureStorage,
  limits: PictureLimits = RECENT_PICTURE_LIMITS,
): RecentPictureLibrary {
  const list = async (): Promise<RecentPictureRecord[]> =>
    (await storage.list()).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return {
    list,
    get: async (id) => (await storage.list()).find((entry) => entry.id === id),
    async add(record): Promise<number> {
      const all = await storage.list();
      const replaced = all.filter(
        (entry) => entry.id === record.id || entry.sourceKey === record.sourceKey,
      );
      for (const entry of replaced) if (entry.id !== record.id) await storage.delete(entry.id);
      const kept = all.filter((entry) => !replaced.includes(entry));
      const evicted = planEviction(
        kept.map((entry) => ({
          id: entry.id,
          createdAt: entry.lastUsedAt,
          blob: { size: entry.blob.size + entry.thumbnail.size + (entry.right?.size ?? 0) },
        })),
        record.blob.size + record.thumbnail.size + (record.right?.size ?? 0),
        limits,
      );
      for (const id of evicted) await storage.delete(id);
      await storage.put(record);
      return evicted.length;
    },
    async touch(id, at): Promise<void> {
      const entry = (await storage.list()).find((candidate) => candidate.id === id);
      if (entry) await storage.put({ ...entry, lastUsedAt: at });
    },
    delete: (id) => storage.delete(id),
  };
}

export function createMemoryRecentPictureStorage(): RecentPictureStorage & {
  records: Map<string, RecentPictureRecord>;
} {
  const records = new Map<string, RecentPictureRecord>();
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
/** The Recent gallery has its own database, so the frames database needs no version migration. */
const RECENT_DB_NAME = 'mux-xr-recent-pictures';
const RECENT_STORE = 'recent';

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
  return indexedDBStorage<PictureRecord>(factory, DB_NAME, STORE);
}

/** IndexedDB storage for the Recent gallery; every call rejects when IndexedDB is unavailable. */
export function createIndexedDBRecentPictureStorage(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): RecentPictureStorage {
  return indexedDBStorage<RecentPictureRecord>(factory, RECENT_DB_NAME, RECENT_STORE);
}

function indexedDBStorage<T extends { id: string }>(
  factory: IDBFactory | undefined,
  name: string,
  storeName: string,
): { list(): Promise<T[]>; put(record: T): Promise<void>; delete(id: string): Promise<void> } {
  const STORE = storeName;
  let database: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'));
    database ??= new Promise((resolve, reject) => {
      const req = factory.open(name, 1);
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
    list: () => run('readonly', (store) => store.getAll() as IDBRequest<T[]>),
    put: async (record) => {
      await run('readwrite', (store) => store.put(record));
    },
    delete: async (id) => {
      await run('readwrite', (store) => store.delete(id));
    },
  };
}
