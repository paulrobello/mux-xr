import {
  createPictureFrameWidget as createFrame,
  type PictureFrameOptions,
  type PictureFrameWidget,
} from '@par/xr-workspace';
import type * as THREE from 'three';

export { PICTURE_KIND, PICTURE_PLACEHOLDER_TEXT } from '@par/xr-workspace';

const PICKER: NonNullable<PictureFrameOptions['picker']> = {
  hint: 'or pick one on the page',
  actions: [
    {
      id: 'pictureUrl',
      name: 'picture-url-choice',
      label: 'Enter URL',
      helpText: 'Type or paste an image URL',
    },
    {
      id: 'pictureRecent',
      name: 'picture-recent-choice',
      label: 'Recent',
      helpText: 'Choose a recent picture',
    },
  ],
};

export function createPictureFrameWidget(
  envMap: THREE.Texture | null = null,
  options: Omit<PictureFrameOptions, 'picker' | 'ownsCanvases'> = {},
): PictureFrameWidget {
  return createFrame(envMap, { ...options, picker: PICKER, ownsCanvases: true });
}
