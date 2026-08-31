// @8thwall/engine-binary ships JS with no type declarations. Its index.js
// exports one thing: a promise that resolves to window.XR8 once the
// /external/xr/xr.js script tag has fired its `xrloaded` event.
declare module '@8thwall/engine-binary' {
  export const XR8Promise: Promise<unknown>
}
