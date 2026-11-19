import { describe, expect, it } from 'vitest';
import { installSameOriginOnly, isSameOrigin, refused } from '../sameOriginOnly';

describe('the scan worker talks to its own origin only', () => {
  it('tells its own origin from any other', () => {
    expect(isSameOrigin('/models/face_landmarker.task', 'https://curtain.example')).toBe(true);
    expect(isSameOrigin('https://curtain.example/models/x', 'https://curtain.example')).toBe(true);
    expect(isSameOrigin('https://odml.pa.googleapis.com/v1/log', 'https://curtain.example')).toBe(false);
    expect(isSameOrigin('http://curtain.example/x', 'https://curtain.example')).toBe(false);
  });

  it("refuses MediaPipe's usage log without sending it, and lets the model files through", async () => {
    const sent: string[] = [];
    const scope = { location: { origin: 'https://curtain.example' }, fetch: (async (i: RequestInfo | URL) => {
      sent.push(String(i));
      return new Response('ok');
    }) as typeof fetch };
    installSameOriginOnly(scope);
    await expect(scope.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: new Uint8Array(10) })).rejects.toThrow(/own origin/);
    await expect(scope.fetch(new Request('https://odml.pa.googleapis.com/v1/log?x=1'))).rejects.toThrow(/own origin/);
    await expect(scope.fetch('/models/face_landmarker.task')).resolves.toBeInstanceOf(Response);
    expect(sent).toEqual(['/models/face_landmarker.task']);
    expect(refused).toContain('https://odml.pa.googleapis.com/v1/log');
  });
});
