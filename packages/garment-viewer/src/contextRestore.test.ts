import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { redrawOnContextRestored } from './contextRestore';

describe('a lost and restored WebGL context', () => {
  it('draws again each time the context is restored, and only then', () => {
    const canvas = new EventTarget();
    let drawn = 0;
    redrawOnContextRestored(canvas, () => (drawn += 1));
    expect(drawn).toBe(0);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(drawn).toBe(0);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(drawn).toBe(1);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(drawn).toBe(2);
  });

  it('stops when the view is disposed', () => {
    const canvas = new EventTarget();
    let drawn = 0;
    const stop = redrawOnContextRestored(canvas, () => (drawn += 1));
    stop();
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(drawn).toBe(0);
  });

  // The mount needs WebGL2 and cannot run here. This reads its source instead: it is a guard
  // against the wiring being dropped, not a test of the picture (that is apps/web/e2e/avatar3d.spec.ts,
  // which is skipped where the bundle is absent).
  it('the mount listens with it, marks the size on screen dirty, wakes the loop, and stops on dispose', () => {
    const src = readFileSync(new URL('./mount.ts', import.meta.url), 'utf8');
    const wired = /const stopContextRestore = redrawOnContextRestored\(canvas, \(\) => \{([\s\S]*?)\n {2}\}\);/.exec(src);
    expect(wired, 'mount.ts no longer redraws on a restored context').not.toBeNull();
    expect(wired![1]).toMatch(/fits\.get\(current\)/);
    expect(wired![1]).toMatch(/\.dirty = true/);
    expect(wired![1]).toMatch(/wake\(/);
    const dispose = src.slice(src.indexOf('dispose()'));
    expect(dispose).toMatch(/stopContextRestore\(\);/);
  });
});
