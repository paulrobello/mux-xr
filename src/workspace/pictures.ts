import {
  createPictureThumbnail,
  loadPictureFile,
  loadPictureUrl,
  type PictureImage,
  type PreparedPicture,
  restorePicture,
} from '../xr/picture-image';
import { PictureLoadError, pictureErrorNotice } from '../xr/picture-sizing';
import type { PictureLibrary, RecentPictureLibrary } from '../xr/picture-store';

export interface PictureSceneTarget {
  /**
   * Shows the picture, in the frame `target` (a placeholder or filled frame id) when it is still
   * open; returns the ids of older frames removed to keep the frame cap.
   */
  addPicture(id: string, image: PictureImage, target?: string): string[];
  restorePictures(pictures: ReadonlyArray<{ id: string; image: PictureImage }>): void;
  removePicture(id: string): void;
}

export interface PictureLoaders {
  file: (file: File) => Promise<PreparedPicture>;
  url: (url: string) => Promise<PreparedPicture>;
  stored: (blob: Blob, name: string) => Promise<PreparedPicture>;
  /** A small WebP of the picture for the Recent gallery. */
  thumbnail: (picture: PreparedPicture) => Promise<Blob>;
}

const defaultLoaders: PictureLoaders = {
  file: (file) => loadPictureFile(file),
  url: (url) => loadPictureUrl(url),
  stored: (blob, name) => restorePicture(blob, name),
  thumbnail: (picture) => createPictureThumbnail(picture.source),
};

/** A Recent gallery entry decoded for display: only the thumbnail, never the full picture. */
export interface RecentPicture {
  id: string;
  name: string;
  thumbnail: PictureImage;
}

export interface PictureController {
  addFile(file: File, target?: string): Promise<boolean>;
  addUrl(url: string, target?: string): Promise<boolean>;
  /** The Recent gallery, most recently used first; null when browser storage is unavailable. */
  listRecent(): Promise<RecentPicture[] | null>;
  /** Puts a Recent picture into the frame `target`, or a new frame. */
  placeRecent(id: string, target?: string): Promise<boolean>;
  /** Removes an entry from the Recent gallery; open frames keep their picture. False on failure. */
  removeRecent(id: string): Promise<boolean>;
  /** Restores every stored picture; stored blobs that no longer decode are deleted. */
  restore(): Promise<void>;
  /** The user closed a frame in XR; its live blob goes, its Recent entry stays. */
  closed(id: string): void;
}

function newPictureId(): string {
  return `pic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const plural = (count: number, one: string, many: string): string =>
  count === 1 ? one : `${count} ${many}`;

/** Ties the page picker, the XR picker, the picture libraries and the XR scene together. */
export function createPictureController(options: {
  library: PictureLibrary;
  /** The Recent gallery; omitted, picks are not remembered and listRecent returns null. */
  recent?: RecentPictureLibrary;
  scene: () => PictureSceneTarget | null;
  notify: (message: string) => void;
  loaders?: Partial<PictureLoaders>;
  now?: () => number;
  createId?: () => string;
}): PictureController {
  const loaders = { ...defaultLoaders, ...options.loaders };
  const now = options.now ?? Date.now;
  const createId = options.createId ?? newPictureId;
  const recent = options.recent;
  let recentEvictionNoticed = false;

  // Adds and the restore run one at a time, so the frame cap holds and a restore never shows a
  // picture an overlapping add already evicted.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  };

  const failed = (source: string, error: unknown): false => {
    options.notify(
      error instanceof PictureLoadError
        ? pictureErrorNotice(error.code, source, error.message)
        : pictureErrorNotice('decode', source),
    );
    return false;
  };

  /** Stores and shows a loaded picture; `remember` also files it in the Recent gallery. */
  const present = async (
    source: string,
    picture: PreparedPicture,
    target: string | undefined,
    remember: { sourceKey: string } | { touch: string },
  ): Promise<boolean> => {
    const id = createId();
    const notices: string[] = [];
    // The thumbnail is drawn before the frame shows: closing a frame zeroes its canvas.
    let thumbnail: Blob | null = null;
    if (recent && 'sourceKey' in remember)
      thumbnail = await loaders.thumbnail(picture).catch(() => null);
    // Changing a filled frame replaces it, so its live record goes before the cap is planned.
    if (target && !target.startsWith('placeholder-'))
      await options.library.delete(target).catch(() => {});
    let evicted: string[] = [];
    try {
      evicted = await options.library.add({
        id,
        name: picture.name,
        blob: picture.blob,
        width: picture.width,
        height: picture.height,
        createdAt: now(),
      });
    } catch (error) {
      notices.push(
        pictureErrorNotice(
          'storage',
          source,
          error instanceof Error ? error.message : 'storage unavailable',
        ),
      );
    }
    const scene = options.scene();
    for (const old of evicted) scene?.removePicture(old);
    const capped =
      (target ? scene?.addPicture(id, picture, target) : scene?.addPicture(id, picture)) ?? [];
    const removed = evicted.length + capped.length;
    if (removed)
      notices.push(
        `Removed the oldest ${plural(removed, 'picture', 'pictures')} to stay within the picture limit`,
      );
    if (recent) {
      try {
        if ('touch' in remember) await recent.touch(remember.touch, now());
        else if (thumbnail) {
          const dropped = await recent.add({
            id: `recent-${id}`,
            name: picture.name,
            blob: picture.blob,
            thumbnail,
            width: picture.width,
            height: picture.height,
            sourceKey: remember.sourceKey,
            lastUsedAt: now(),
          });
          // Once per page session: at the cap every pick evicts, and a notice each time is noise.
          if (dropped && !recentEvictionNoticed) {
            recentEvictionNoticed = true;
            notices.push(
              `Removed the least recently used ${plural(dropped, 'picture', 'pictures')} from Recent`,
            );
          }
        }
      } catch {
        // The frame is shown and saved; only the Recent gallery misses it.
      }
    }
    if (notices.length) options.notify(notices.join('. '));
    return true;
  };

  const show = async (
    source: string,
    sourceKey: string,
    load: () => Promise<PreparedPicture>,
    target?: string,
  ): Promise<boolean> => {
    let picture: PreparedPicture;
    try {
      picture = await load();
    } catch (error) {
      return failed(source, error);
    }
    return present(source, picture, target, { sourceKey });
  };

  return {
    addFile: (file, target) =>
      serial(() =>
        show(
          file.name || 'image',
          `file:${file.name}:${file.size}:${file.lastModified}`,
          () => loaders.file(file),
          target,
        ),
      ),
    addUrl: (url, target) =>
      serial(() => show(url.trim(), `url:${url.trim()}`, () => loaders.url(url.trim()), target)),
    listRecent: async () => {
      if (!recent) return null;
      let records: Awaited<ReturnType<RecentPictureLibrary['list']>>;
      try {
        records = await recent.list();
      } catch {
        return null;
      }
      const entries: RecentPicture[] = [];
      for (const record of records) {
        try {
          const thumbnail = await loaders.stored(record.thumbnail, record.name);
          entries.push({ id: record.id, name: record.name, thumbnail });
        } catch {
          await recent.delete(record.id).catch(() => {});
        }
      }
      return entries;
    },
    placeRecent: (recentId, target) =>
      serial(async () => {
        const record = await recent?.get(recentId).catch(() => undefined);
        if (!record) {
          options.notify('That picture is no longer in Recent');
          return false;
        }
        let picture: PreparedPicture;
        try {
          picture = await loaders.stored(record.blob, record.name);
        } catch (error) {
          return failed(record.name, error);
        }
        return present(record.name, picture, target, { touch: record.id });
      }),
    removeRecent: async (recentId) => {
      if (!recent) return false;
      try {
        await recent.delete(recentId);
        return true;
      } catch {
        return false;
      }
    },
    restore: () => serial(restore),
    closed(id): void {
      options.library.delete(id).catch(() => {});
    },
  };

  async function restore(): Promise<void> {
    let records: Awaited<ReturnType<PictureLibrary['list']>>;
    try {
      records = await options.library.list();
    } catch {
      return;
    }
    const restored: Array<{ id: string; image: PictureImage }> = [];
    let broken = 0;
    for (const record of records) {
      try {
        restored.push({ id: record.id, image: await loaders.stored(record.blob, record.name) });
      } catch {
        broken += 1;
        await options.library.delete(record.id).catch(() => {});
      }
    }
    options.scene()?.restorePictures(restored);
    if (broken)
      options.notify(
        `${broken === 1 ? 'A saved picture' : `${broken} saved pictures`} could not be decoded and ${broken === 1 ? 'was' : 'were'} removed`,
      );
  }
}
