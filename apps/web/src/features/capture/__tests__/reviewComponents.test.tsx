// @vitest-environment jsdom
/**
 * Review regressions for the camera steps: the body scan could never start (its <video> only
 * existed after the setup phase, so `start()` bailed out), and "Retake" on the face step left a
 * <video> without a stream.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as CameraModule from '../platform/camera';
import type { ScanSession } from '../scanSession';

const stream = { id: 'fake-stream', getTracks: () => [] } as unknown as MediaStream;
const cam = vi.hoisted(() => ({ stop: vi.fn() }));

vi.mock('../platform/camera', async (importOriginal) => {
  const real = await importOriginal<typeof CameraModule>();
  return {
    ...real,
    openCamera: vi.fn(async () => ({ stream, facing: 'user', width: 720, height: 1280, stop: cam.stop })),
    bitmapFromFile: vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() })),
    startFramePump: vi.fn(() => () => undefined),
  };
});

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const { BodyStep } = await import('../components/BodyStep');
const { FaceStep, faceModelsState } = await import('../components/FaceStep');

beforeAll(() => {
  // jsdom implements neither playback nor srcObject; keep both observable
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(() => Promise.resolve()) });
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get(this: { _src?: unknown }) {
      return this._src ?? null;
    },
    set(this: { _src?: unknown }, v: unknown) {
      this._src = v;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fakeSession(over: Partial<Record<keyof ScanSession, unknown>> = {}): ScanSession {
  return {
    onGate: () => () => undefined,
    onProgress: () => () => undefined,
    reset: vi.fn(),
    pushFrame: vi.fn(),
    finish: vi.fn(() => new Promise(() => undefined)),
    analyseFace: vi.fn(),
    ...over,
  } as unknown as ScanSession;
}

describe('BodyStep', () => {
  it('shows the live preview during setup and starts the countdown', async () => {
    const session = fakeSession();
    render(
      <BodyStep
        session={session}
        modelsReady
        modelsFailed={false}
        initialHeight="170"
        initialWeight=""
        sex="female"
        onHeightChange={() => undefined}
        onDone={() => undefined}
        onSkip={() => undefined}
      />,
    );
    const video = screen.getByLabelText('Camera preview') as HTMLVideoElement;
    await waitFor(() => expect(video.srcObject).toBe(stream));
    fireEvent.click(screen.getByRole('button', { name: /Start 8-second scan/ }));
    expect(await screen.findByText(/Get ready/)).toBeInTheDocument();
  });

  it('stops its timers and the camera when unmounted mid-countdown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const session = fakeSession();
    const { unmount } = render(
      <BodyStep
        session={session}
        modelsReady
        modelsFailed={false}
        initialHeight="170"
        initialWeight=""
        sex="female"
        onHeightChange={() => undefined}
        onDone={() => undefined}
        onSkip={() => undefined}
      />,
    );
    await waitFor(() => expect((screen.getByLabelText('Camera preview') as HTMLVideoElement).srcObject).toBe(stream));
    fireEvent.click(screen.getByRole('button', { name: /Start 8-second scan/ }));
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(session.reset).not.toHaveBeenCalled();
    expect(session.finish).not.toHaveBeenCalled();
    expect(cam.stop).toHaveBeenCalled();
  });
});

describe('FaceStep', () => {
  it('re-attaches the camera stream to the preview after "Retake"', async () => {
    const session = fakeSession({
      analyseFace: vi.fn(async () => ({ type: 'faceResult', faceFound: true, skin: null, faceTile: null })),
    });
    const { container } = render(<FaceStep session={session} cameraAllowed onDone={() => undefined} onSkip={() => undefined} />);
    const first = screen.getByLabelText('Camera preview') as HTMLVideoElement;
    await waitFor(() => expect(first.srcObject).toBe(stream));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(await screen.findByRole('button', { name: /Retake/ }));

    const again = screen.getByLabelText('Camera preview') as HTMLVideoElement;
    expect(again).not.toBe(first);
    expect(again.srcObject).toBe(stream);
  });

  it('says the models are loading (not "not available") while they load, then works once ready (#16)', async () => {
    const session = fakeSession({
      analyseFace: vi.fn(async () => ({ type: 'faceResult', faceFound: true, skin: null, faceTile: null })),
    });
    const { container, rerender } = render(<FaceStep session={session} models="loading" cameraAllowed onDone={() => undefined} onSkip={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Loading the scan models/);
    expect(screen.getByRole('status')).not.toHaveTextContent(/not available/);
    expect(screen.getByRole('button', { name: /Take photo/ })).toBeDisabled();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDisabled();

    rerender(<FaceStep session={session} models="ready" cameraAllowed onDone={() => undefined} onSkip={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Centre your face/);
    expect(screen.getByRole('button', { name: /Take photo/ })).toBeEnabled();
    fireEvent.change(input, { target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] } });
    await screen.findByRole('button', { name: /Retake/ });
    expect(session.analyseFace).toHaveBeenCalledTimes(1);
  });

  it('says "not available" only when loading failed', () => {
    render(<FaceStep session={fakeSession()} models="failed" cameraAllowed onDone={() => undefined} onSkip={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent(/not available on this device/);
    expect(screen.getByRole('button', { name: /Take photo/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Skip this step/ })).toBeEnabled();
  });

  it('faceModelsState separates loading from failed', () => {
    const s = fakeSession();
    expect(faceModelsState(s, 'idle')).toBe('loading');
    expect(faceModelsState(s, 'loading')).toBe('loading');
    expect(faceModelsState(null, 'loading')).toBe('loading');
    expect(faceModelsState(s, 'ready')).toBe('ready');
    expect(faceModelsState(s, undefined)).toBe('ready');
    expect(faceModelsState(s, 'failed')).toBe('unavailable');
    expect(faceModelsState(null, 'ready')).toBe('unavailable');
    expect(faceModelsState(null, undefined)).toBe('unavailable');
  });
});
