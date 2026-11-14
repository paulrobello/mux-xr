declare module 'troika-three-text' {
  import * as THREE from 'three';

  /** The derived material troika renders text with. */
  export type TroikaTextMaterial = THREE.ShaderMaterial & {
    isTextOutlineMaterial?: boolean;
    setMatrixTexture(texture: THREE.DataTexture): void;
  };

  export interface TextEventMap extends THREE.Object3DEventMap {
    syncstart: object;
    synccomplete: object;
  }

  export class Text extends THREE.Mesh<
    THREE.BufferGeometry,
    THREE.Material | THREE.Material[],
    TextEventMap
  > {
    constructor();
    text: string;
    readonly textRenderInfo: { blockBounds: [number, number, number, number] } | null;
    font: string | null;
    fontSize: number;
    maxWidth: number;
    anchorX: number | string;
    anchorY: number | string;
    textAlign: string;
    whiteSpace: string;
    lineHeight: number | string;
    overflowWrap: string;
    color: number | string | THREE.Color;
    depthOffset: number;
    sync(callback?: () => void): void;
    dispose(): void;
    _prepareForRender(material: TroikaTextMaterial): void;
  }

  export class BatchedText extends Text {
    protected _dataTextures: Partial<Record<'main' | 'outline', THREE.DataTexture>>;
    addText(text: Text): void;
    removeText(text: Text): void;
    updateBounds(): void;
  }

  export function configureTextBuilder(config: {
    defaultFontURL?: string;
    useWorker?: boolean;
  }): void;
}
