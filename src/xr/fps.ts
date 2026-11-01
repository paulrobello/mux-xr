export function createFrameCounter(): { sample(time: number): number | null; reset(): void } {
  let start: number | null = null;
  let frames = 0;
  return {
    sample(time) {
      if (!Number.isFinite(time)) return null;
      if (start === null || time < start) {
        start = time;
        frames = 0;
        return null;
      }
      frames += 1;
      const elapsed = time - start;
      if (elapsed < 500) return null;
      const fps = Math.round((frames * 1000) / elapsed);
      start = time;
      frames = 0;
      return fps;
    },
    reset() {
      start = null;
      frames = 0;
    },
  };
}
