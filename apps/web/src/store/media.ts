/**
 * Face tile + encrypted base frame from the capture storage → object URLs for the mirror.
 * Loaded on device only; a tiny external store (useSyncExternalStore) keyed by the profile's
 * updatedAt so every mirror shares one decrypt and the URLs are revoked when the profile changes.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { loadBaseFrame, loadFaceTile, storageAvailable } from '@/features/capture/storage';
import type { SkinEstimate } from '@/features/capture/types';
import { getAppDb } from '@/db/db';
import { useApp } from './index';

export interface CaptureMedia {
  faceUrl: string | null;
  baseFrame: { url: string; width: number; height: number } | null;
  skin: SkinEstimate | null;
  loading: boolean;
}

const EMPTY: CaptureMedia = { faceUrl: null, baseFrame: null, skin: null, loading: false };
const LOADING: CaptureMedia = { faceUrl: null, baseFrame: null, skin: null, loading: true };

let state: { key: number; media: CaptureMedia } = { key: -1, media: EMPTY };
let inflightKey: number | null = null;
const listeners = new Set<() => void>();

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshotFor(key: number): CaptureMedia {
  if (key === 0) return EMPTY;
  return state.key === key ? state.media : LOADING;
}

async function load(): Promise<CaptureMedia> {
  if (!storageAvailable()) return EMPTY;
  const db = getAppDb();
  const [face, frame] = await Promise.all([loadFaceTile(db).catch(() => null), loadBaseFrame(db).catch(() => null)]);
  return {
    faceUrl: face?.blob ? URL.createObjectURL(face.blob) : null,
    baseFrame: frame ? { url: URL.createObjectURL(frame.blob), width: frame.width, height: frame.height } : null,
    skin: face?.skin ?? null,
    loading: false,
  };
}

function ensureLoaded(key: number): void {
  if (key === 0 || state.key === key || inflightKey === key) return;
  inflightKey = key;
  load()
    .catch(() => EMPTY)
    .then((media) => {
      if (inflightKey !== key) return;
      if (state.media.faceUrl) URL.revokeObjectURL(state.media.faceUrl);
      if (state.media.baseFrame) URL.revokeObjectURL(state.media.baseFrame.url);
      state = { key, media };
      inflightKey = null;
      listeners.forEach((l) => l());
    });
}

/** Tests may reset the cache between cases. */
export function resetCaptureMediaCache(): void {
  state = { key: -1, media: EMPTY };
  inflightKey = null;
}

export function useCaptureMedia(): CaptureMedia {
  const key = useApp((s) => s.profile?.updatedAt ?? (s.profile ? 1 : 0));
  const media = useSyncExternalStore(subscribe, () => snapshotFor(key), () => EMPTY);
  useEffect(() => {
    ensureLoaded(key);
  }, [key]);
  return media;
}
