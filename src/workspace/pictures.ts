import {
  loadPictureFile,
  loadPictureUrl,
  type PictureImage,
  type PreparedPicture,
  restorePicture,
} from '../xr/picture-image';
import { PictureLoadError, pictureErrorNotice } from '../xr/picture-sizing';
import type { PictureLibrary } from '../xr/picture-store';

export interface PictureSceneTarget {
  /** Shows the picture; returns the ids of older frames removed to keep the frame cap. */
  addPicture(id: string, image: PictureImage): string[];
  restorePictures(pictures: ReadonlyArray<{ id: string; image: PictureImage }>): void;
  removePicture(id: string): void;
}

export interface PictureLoaders {
  file: (file: File) => Promise<PreparedPicture>;
  url: (url: string) => Promise<PreparedPicture>;
  stored: (blob: Blob, name: string) => Promise<PreparedPicture>;
}

const defaultLoaders: PictureLoaders = {
  file: (file) => loadPictureFile(file),
  url: (url) => loadPictureUrl(url),
  stored: (blob, name) => restorePicture(blob, name),
};

export interface PictureController {
  addFile(file: File): Promise<boolean>;
  addUrl(url: string): Promise<boolean>;
  /** Restores every stored picture; stored blobs that no longer decode are deleted. */
  restore(): Promise<void>;
  /** The user closed a frame in XR; its blob goes. */
  closed(id: string): void;
}

function newPictureId(): string {
  return `pic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ties the page picker, the picture library and the XR scene together. */
export function createPictureController(options: {
  library: PictureLibrary;
  scene: () => PictureSceneTarget | null;
  notify: (message: string) => void;
  loaders?: PictureLoaders;
  now?: () => number;
  createId?: () => string;
}): PictureController {
  const loaders = options.loaders ?? defaultLoaders;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? newPictureId;

  // Adds and the restore run one at a time, so the frame cap holds and a restore never shows a
  // picture an overlapping add already evicted.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  };

  const show = async (source: string, load: () => Promise<PreparedPicture>): Promise<boolean> => {
    let picture: PreparedPicture;
    try {
      picture = await load();
    } catch (error) {
      options.notify(
        error instanceof PictureLoadError
          ? pictureErrorNotice(error.code, source, error.message)
          : pictureErrorNotice('decode', source),
      );
      return false;
    }
    const id = createId();
    let evicted: string[] = [];
    let saveError: string | null = null;
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
      saveError = error instanceof Error ? error.message : 'storage unavailable';
    }
    const scene = options.scene();
    for (const old of evicted) scene?.removePicture(old);
    const capped = scene?.addPicture(id, picture) ?? [];
    const removed = evicted.length + capped.length;
    const notices: string[] = [];
    if (saveError) notices.push(pictureErrorNotice('storage', source, saveError));
    if (removed)
      notices.push(
        `Removed the oldest ${removed === 1 ? 'picture' : `${removed} pictures`} to stay within the picture limit`,
      );
    if (notices.length) options.notify(notices.join('. '));
    return true;
  };

  return {
    addFile: (file) => serial(() => show(file.name || 'image', () => loaders.file(file))),
    addUrl: (url) => serial(() => show(url.trim(), () => loaders.url(url.trim()))),
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
