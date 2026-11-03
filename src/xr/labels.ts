import * as THREE from 'three';
import { configureTextBuilder, Text } from 'troika-three-text';
import { isMainLabelCodePoint, isSupportedLabelCodePoint } from './glyph-ranges';

/** Fonts bundled with the app. Coverage is checked by glyph-ranges.ts before sync. */
export const LABEL_FONT_URL = '/fonts/NotoSans-Regular.ttf';
export const LABEL_SYMBOL_FONT_URL = '/fonts/NotoSansSymbols2-Regular.ttf';

const LABEL_Z_OFFSET = 0.001;
const LABEL_FONT_SIZE_RATIO = 0.58;
const LABEL_MAX_WIDTH_RATIO = 0.86;
const LABEL_MIN_FONT_SIZE_RATIO = 0.22;
const LABEL_GLYPH_WIDTH_FACTOR = 0.55;

// The LAN streamer's policy forbids blob workers. Typesetting must stay on the main thread.
configureTextBuilder({ defaultFontURL: LABEL_FONT_URL, useWorker: false });

export interface ScalableLabelOptions {
  wrap?: boolean;
  background?: string;
  border?: string;
  /** Keep the interaction plane, but omit its visible rectangular backplate. */
  backplate?: boolean;
}

interface LabelUserData {
  labelText: string;
  labelWidth: number;
  labelHeight: number;
  labelWrap: boolean;
  labelTextObject: Text;
  labelBackgroundTexture: THREE.DataTexture;
  labelDisposed: boolean;
  labelResourcesFinalized: boolean;
  labelSyncPromise: Promise<void>;
  disposeLabel: () => void;
}

type LabelRoot = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> & {
  userData: LabelUserData & Record<string, unknown>;
};

function backgroundTexture(
  background: string,
  width: number,
  height: number,
  border?: string,
): THREE.DataTexture {
  // THREE.Color stores linear values. Convert back to sRGB before writing texture bytes.
  const fill = new THREE.Color(background).convertLinearToSRGB();
  const fillRgb = [Math.round(fill.r * 255), Math.round(fill.g * 255), Math.round(fill.b * 255)];
  const edge = border ? new THREE.Color(border).convertLinearToSRGB() : fill;
  const edgeRgb = [Math.round(edge.r * 255), Math.round(edge.g * 255), Math.round(edge.b * 255)];
  const textureSize = 64;
  const textureWidth = Math.max(8, Math.min(2048, Math.round((textureSize * width) / height)));
  const data = new Uint8Array(textureWidth * textureSize * 4);
  for (let y = 0; y < textureSize; y += 1) {
    for (let x = 0; x < textureWidth; x += 1) {
      const edgePixel = border && (x < 2 || y < 2 || x >= textureWidth - 2 || y >= textureSize - 2);
      data.set([...(edgePixel ? edgeRgb : fillRgb), 255], (y * textureWidth + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, textureWidth, textureSize, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function fitLabel(
  label: string,
  width: number,
  height: number,
): { text: string; fontSize: number } {
  const maxWidth = Math.max(width * LABEL_MAX_WIDTH_RATIO, 0.01);
  const minFontSize = height * LABEL_MIN_FONT_SIZE_RATIO;
  const fullLength = Math.max(1, Array.from(label).length);
  let text = label;
  let fontSize = Math.min(
    height * LABEL_FONT_SIZE_RATIO,
    maxWidth / (fullLength * LABEL_GLYPH_WIDTH_FACTOR),
  );
  if (!label.includes('\n') && fontSize < minFontSize) {
    const maxCharacters = Math.max(
      1,
      Math.floor(maxWidth / (minFontSize * LABEL_GLYPH_WIDTH_FACTOR)),
    );
    text = `${Array.from(label)
      .slice(0, Math.max(1, maxCharacters - 1))
      .join('')}…`;
    fontSize = Math.min(
      height * LABEL_FONT_SIZE_RATIO,
      maxWidth / (Math.max(1, Array.from(text).length) * LABEL_GLYPH_WIDTH_FACTOR),
    );
  }
  return { text, fontSize: Math.max(minFontSize, fontSize) };
}

function configureText(
  textMesh: Text,
  label: string,
  width: number,
  height: number,
  wrap: boolean,
): void {
  const fitted = fitLabel(label, width, height);
  const arrows: Record<string, string> = { '←': '⇦', '↑': '⇧', '→': '⇨', '↓': '⇩' };
  textMesh.text = Array.from(fitted.text)
    .map((character) => arrows[character] ?? character)
    .map((character) =>
      isSupportedLabelCodePoint(character.codePointAt(0) ?? 0) ? character : '?',
    )
    .join('');
  const needsSymbolFont = Array.from(textMesh.text).some(
    (character) => !isMainLabelCodePoint(character.codePointAt(0) ?? 0),
  );
  textMesh.font = needsSymbolFont ? LABEL_SYMBOL_FONT_URL : LABEL_FONT_URL;
  textMesh.fontSize = fitted.fontSize;
  textMesh.maxWidth = Math.max(width * LABEL_MAX_WIDTH_RATIO, 0.01);
  (textMesh as unknown as { anchorX: number | string }).anchorX = '50%';
  (textMesh as unknown as { anchorY: number | string }).anchorY = 'middle';
  textMesh.textAlign = 'center';
  textMesh.whiteSpace = wrap || fitted.text.includes('\n') ? 'normal' : 'nowrap';
  textMesh.lineHeight = wrap || fitted.text.includes('\n') ? '1.1' : 'normal';
  textMesh.overflowWrap = 'break-word';
  textMesh.color = 0xffffff;
  textMesh.depthOffset = -1;
  textMesh.position.set(0, 0, LABEL_Z_OFFSET);
}

function syncText(textMesh: Text, width: number, height: number): Promise<void> {
  return new Promise((resolve) =>
    textMesh.sync(() => {
      const bounds = textMesh.textRenderInfo?.blockBounds;
      if (bounds) {
        const actualWidth = bounds[2] - bounds[0];
        const actualHeight = bounds[3] - bounds[1];
        textMesh.scale.setScalar(
          Math.min(
            1,
            (width * LABEL_MAX_WIDTH_RATIO) / Math.max(actualWidth, 0.001),
            (height * 0.82) / Math.max(actualHeight, 0.001),
          ),
        );
      }
      resolve();
    }),
  );
}

export function createScalableLabel(
  label: string,
  width: number,
  height: number,
  options: ScalableLabelOptions = {},
): THREE.Mesh {
  const safeWidth = Math.max(width, 0.001);
  const safeHeight = Math.max(height, 0.001);
  const backplate = options.backplate ?? true;
  const texture = backgroundTexture(
    options.background ?? '#1c2a35',
    safeWidth,
    safeHeight,
    options.border,
  );
  const root = new THREE.Mesh(
    new THREE.PlaneGeometry(safeWidth, safeHeight),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: backplate ? texture : null,
      transparent: true,
      opacity: backplate ? 1 : 0,
      depthWrite: false,
    }),
  ) as LabelRoot;
  const textMesh = new Text();
  configureText(textMesh, label, safeWidth, safeHeight, options.wrap ?? false);
  textMesh.raycast = () => undefined;
  root.add(textMesh);

  const syncPromise = syncText(textMesh, safeWidth, safeHeight);
  const userData = root.userData;
  userData.labelText = label;
  userData.labelWidth = safeWidth;
  userData.labelHeight = safeHeight;
  userData.labelWrap = options.wrap ?? false;
  userData.labelTextObject = textMesh;
  userData.labelBackgroundTexture = texture;
  userData.labelDisposed = false;
  userData.labelResourcesFinalized = false;
  userData.labelSyncPromise = syncPromise;
  userData.disposeLabel = () => {
    if (userData.labelDisposed) return;
    userData.labelDisposed = true;
    textMesh.visible = false;
    root.remove(textMesh);
    texture.dispose();
    root.geometry.dispose();
    root.material.dispose();
    const finalize = () => {
      if (userData.labelResourcesFinalized) return;
      userData.labelResourcesFinalized = true;
      textMesh.dispose();
      const materials = Array.isArray(textMesh.material) ? textMesh.material : [textMesh.material];
      for (const material of materials) material.dispose();
    };
    userData.labelSyncPromise.then(finalize, finalize);
  };
  return root;
}

export function updateScalableLabel(root: THREE.Mesh, label: string): void {
  const data = root.userData as Partial<LabelUserData>;
  if (data.labelDisposed || !data.labelTextObject) return;
  configureText(
    data.labelTextObject,
    label,
    data.labelWidth ?? root.scale.x,
    data.labelHeight ?? root.scale.y,
    data.labelWrap ?? false,
  );
  data.labelText = label;
  data.labelSyncPromise = syncText(
    data.labelTextObject,
    data.labelWidth ?? 0.2,
    data.labelHeight ?? 0.1,
  );
}

export function waitForLabelSync(root: THREE.Object3D): Promise<void> {
  return (root.userData as Partial<LabelUserData>).labelSyncPromise ?? Promise.resolve();
}

/** Disposes owned geometry/material/texture and Text geometry, never Troika's shared atlas. */
export function disposeScalableLabel(root: THREE.Object3D): void {
  (root.userData as Partial<LabelUserData>).disposeLabel?.();
}
