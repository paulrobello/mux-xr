import * as THREE from 'three';

const STAR_SPRITE_SIZE = 32;

/** The soft round star point the cloud-summit and desert-night skies share. */
export function createStarSpriteTexture(): THREE.DataTexture {
  const data = new Uint8Array(STAR_SPRITE_SIZE * STAR_SPRITE_SIZE * 4);
  const center = (STAR_SPRITE_SIZE - 1) / 2;
  const radius = STAR_SPRITE_SIZE / 2;
  for (let y = 0; y < STAR_SPRITE_SIZE; y += 1) {
    for (let x = 0; x < STAR_SPRITE_SIZE; x += 1) {
      const distance = Math.hypot(x - center, y - center) / radius;
      const alpha = distance >= 0.94 ? 0 : Math.min(1, Math.max(0, 1 - distance * distance) ** 1.6);
      const offset = (y * STAR_SPRITE_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, STAR_SPRITE_SIZE, STAR_SPRITE_SIZE, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
