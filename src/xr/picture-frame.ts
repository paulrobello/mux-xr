import * as THREE from 'three';
import { createScalableLabel } from './labels';
import type { PictureImage } from './picture-image';
import { frameSize, PICTURE_LONG_EDGE, PLACEHOLDER_ASPECT } from './picture-sizing';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const PICTURE_KIND = 'picture';
export const PICTURE_PLACEHOLDER_TEXT = 'Pick an image on the page';

const BORDER = 0.022;
const DEPTH = 0.024;
const FRAME_COLOR = 0x0c1117;

let nextPlaceholderId = 1;

export interface PictureFrameOptions {
  /** Stable frame id; also the IndexedDB key and the pose-store suffix. */
  id?: string;
  /** The picture; omitted for the "Pick an image on the page" placeholder. */
  image?: PictureImage | null;
  /** Texture anisotropy, already capped to the renderer's maximum. */
  anisotropy?: number;
}

/** A thin dark frame around a plane whose aspect matches the image, with a close control. */
export function createPictureFrameWidget(
  envMap: THREE.Texture | null = null,
  options: PictureFrameOptions = {},
): Widget {
  const image = options.image ?? null;
  const id = options.id ?? `placeholder-${nextPlaceholderId++}`;
  const size = image
    ? frameSize(image.width, image.height)
    : { width: PICTURE_LONG_EDGE, height: PICTURE_LONG_EDGE / PLACEHOLDER_ASPECT };
  const root = new THREE.Group();
  root.name = `picture-frame-${id}`;
  root.userData.widgetId = id;
  root.userData.widgetKind = PICTURE_KIND;
  root.userData.pictureId = id;
  root.userData.picturePlaceholder = !image;
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = [0.25, 2];

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(size.width + BORDER * 2, size.height + BORDER * 2, DEPTH),
    applyUIEnvironment(
      new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.55, metalness: 0.35 }),
      envMap,
    ),
  );
  frame.name = 'picture-frame-border';
  frame.position.z = -DEPTH / 2;
  root.add(frame);

  let texture: THREE.CanvasTexture | null = null;
  if (image) {
    texture = new THREE.CanvasTexture(image.source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.max(1, Math.floor(options.anisotropy ?? 1));
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size.width, size.height),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    plane.name = 'picture-frame-image';
    plane.position.z = 0.001;
    root.add(plane);
  } else {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(size.width, size.height),
      new THREE.MeshBasicMaterial({ color: 0x15232b }),
    );
    face.name = 'picture-frame-face';
    face.position.z = 0.001;
    root.add(face);
    const placeholder = createScalableLabel(PICTURE_PLACEHOLDER_TEXT, size.width - 0.08, 0.07, {
      backplate: false,
    });
    placeholder.name = 'picture-frame-placeholder';
    placeholder.position.z = 0.002;
    root.add(placeholder);
  }

  const close = createScalableLabel('×', 0.055, 0.055, { background: '#223946' });
  close.name = 'picture-close';
  // Sits on the frame's top-right corner so it never covers the picture.
  close.position.set(size.width / 2 + BORDER / 2, size.height / 2 + BORDER / 2, 0.012);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close this picture frame';
  root.add(close);

  root.traverse((object) => {
    object.userData.widgetId = id;
    object.userData.widgetKind = PICTURE_KIND;
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });

  let disposed = false;
  return {
    root,
    update: () => {},
    setTextureAnisotropy: (anisotropy) => {
      if (!texture || disposed) return;
      const next = Math.max(1, Math.floor(anisotropy));
      if (texture.anisotropy === next) return;
      texture.anisotropy = next;
      texture.needsUpdate = true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Material.dispose leaves its map alone, so the texture and its canvas go here.
      texture?.dispose();
      if (image) {
        image.source.width = 0;
        image.source.height = 0;
      }
      disposeOwned(root);
      root.clear();
    },
  };
}
