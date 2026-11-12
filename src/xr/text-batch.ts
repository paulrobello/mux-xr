import { BatchedText, Text, type TroikaTextMaterial } from 'troika-three-text';

/**
 * A troika batch that rebuilds its per-glyph data only after a glyph moved or the batch repacked.
 * Stock BatchedText rebuilds it on every render, twice a frame in XR, and because it compares
 * float64 values with its float32 store it re-uploads the data texture each time.
 * Member colour, opacity, stroke, outline, clip and curve go only into that data, never through a
 * sync, so code that changes them on a member must bump `revision`.
 */
export class CachedTextBatch extends BatchedText {
  /** Bumped whenever member data must be rebuilt. */
  revision = 0;
  private readonly prepared = new WeakMap<TroikaTextMaterial, number>();
  protected boundsRevision = -1;

  constructor() {
    super();
    this.addEventListener('synccomplete', () => {
      this.revision++;
    });
  }

  override updateBounds(): void {
    if (this.boundsRevision === this.revision) return;
    this.boundsRevision = this.revision;
    super.updateBounds();
  }

  override _prepareForRender(material: TroikaTextMaterial): void {
    const texture = this._dataTextures[material.isTextOutlineMaterial ? 'outline' : 'main'];
    if (texture && this.prepared.get(material) === this.revision) {
      // The outline material shares the main material's uniforms, so the flag is set per pass.
      material.uniforms.uTroikaIsOutline.value = Boolean(material.isTextOutlineMaterial);
      material.setMatrixTexture(texture);
      Text.prototype._prepareForRender.call(this, material);
      return;
    }
    this.rebuildMemberData(material);
    this.prepared.set(material, this.revision);
  }

  /** Runs stock BatchedText's full per-member rebuild. */
  protected rebuildMemberData(material: TroikaTextMaterial): void {
    super._prepareForRender(material);
  }
}
