// Preload for the real integration test: prove interop without CDN access.
globalThis.fetch = () =>
  Promise.reject(
    new TypeError('Offline regression control: network is unavailable.')
  );
