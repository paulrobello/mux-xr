declare module 'troika-three-text' {
  import * as THREE from 'three';

  export class Text extends THREE.Mesh {
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
  }

  export function configureTextBuilder(config: {
    defaultFontURL?: string;
    useWorker?: boolean;
  }): void;
}
