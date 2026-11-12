declare module 'libheif-js/libheif-wasm/libheif.js' {
  /** The Emscripten factory; with `wasmBinary` it instantiates synchronously and returns the module. */
  const libheif: (options: { wasmBinary: ArrayBuffer }) => unknown;
  export default libheif;
}
