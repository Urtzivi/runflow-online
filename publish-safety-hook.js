'use strict';

// Prevent an external Intervals.icu request from keeping a RunFlow publish
// request open indefinitely. This only affects requests to Intervals.
const INTERVALS_PREFIX = 'https://intervals.icu/api/v1';
const INTERVALS_TIMEOUT_MS = Math.max(3000, Number(process.env.INTERVALS_REQUEST_TIMEOUT_MS || 7000));
const nativeFetch = globalThis.fetch;

if (typeof nativeFetch === 'function' && !globalThis.__runflowIntervalsTimeoutInstalled) {
  globalThis.__runflowIntervalsTimeoutInstalled = true;

  globalThis.fetch = function runflowFetchWithIntervalsTimeout(input, init = {}) {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (!url.startsWith(INTERVALS_PREFIX)) return nativeFetch(input, init);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INTERVALS_TIMEOUT_MS);
    let signal = controller.signal;

    if (init?.signal) {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        signal = AbortSignal.any([init.signal, controller.signal]);
      } else if (init.signal.aborted) {
        controller.abort();
      } else {
        init.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    return nativeFetch(input, { ...init, signal })
      .catch(error => {
        if (controller.signal.aborted && !init?.signal?.aborted) {
          const timeout = new Error(`Intervals no respondió en ${Math.round(INTERVALS_TIMEOUT_MS / 1000)} s.`);
          timeout.code = 'INTERVALS_TIMEOUT';
          throw timeout;
        }
        throw error;
      })
      .finally(() => clearTimeout(timer));
  };
}

module.exports = { INTERVALS_TIMEOUT_MS };
