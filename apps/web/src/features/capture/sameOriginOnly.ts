/**
 * The scan worker talks to its own origin only (DECISIONS.md D3: onboarding makes zero third-party
 * requests; AGENTS.md rule 1).
 *
 * Why this exists: `@mediapipe/tasks-vision` 1.2.2 creates a usage logger for every task it starts
 * (FaceLandmarker, PoseLandmarker, ImageSegmenter...). Every 60 s and when the task closes, it POSTs a
 * protobuf to `https://odml.pa.googleapis.com/v1/log` with an API key. From the bundle's code, the
 * message holds the task type, the running mode and timing counters, not pixels or landmarks, and the
 * package offers no switch to turn it off. The face-on-head spike's network test caught that request
 * (19 Nov 2026). It goes to a third party all the same, so the worker refuses it here.
 *
 * `scan.worker.ts` installs it at the top of its body, before any task is created (the logger is made
 * with the task, not when the module loads). A refused request rejects like a network error: it is
 * never sent.
 */
export function isSameOrigin(url: string | URL, origin: string): boolean {
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

/** What was refused, kept for tests (URL without query only, never a body). */
export const refused: string[] = [];

export function installSameOriginOnly(scope: { fetch?: typeof fetch; location?: { origin: string }; XMLHttpRequest?: typeof XMLHttpRequest }): void {
  // In a unit test the worker module is imported where `self` is not a worker: nothing to guard there.
  if (typeof scope.fetch !== 'function' || !scope.location) return;
  const origin = scope.location.origin;
  const original = scope.fetch.bind(scope);
  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? input : input.url;
    if (!isSameOrigin(url, origin)) {
      const u = new URL(url, origin);
      refused.push(`${u.origin}${u.pathname}`);
      return Promise.reject(new TypeError('blocked: the scan worker only talks to its own origin'));
    }
    return original(input, init);
  }) as typeof fetch;
  const XHR = scope.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      if (!isSameOrigin(url, origin)) throw new TypeError('blocked: the scan worker only talks to its own origin');
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XHR.prototype.open;
  }
}
