/**
 * Setpoint wave.
 *
 * The Read header's one instrument: the unread backlog as amplitude. Nothing
 * unread is a flat line resting on its baseline; the wave grows to four and
 * stops there, because past four the state word already reads Drifting and a
 * taller wave would only add noise to a reading that has already been made.
 *
 * It reports state or it does not ship. The drawing is marked aria-hidden and
 * the same reading is carried in text underneath it, so the instrument is not
 * a picture with a caption — the caption IS the instrument, and the wave is
 * how it looks at a glance.
 */

import { useState } from 'react';

/** Flat, but still drawn: zero unread is a reading, not an empty frame. */
const AMPLITUDE_FLOOR = 0.05;
const AMPLITUDE_BASE = 0.35;
const AMPLITUDE_STEP = 0.1625;
/** Four unread fills the frame; everything past four reads the same. */
const AMPLITUDE_FULL_AT = 4;

const WAVE_PATH =
  'M0,32 C30,32 45,10 75,10 C105,10 115,54 150,54 C185,54 195,6 235,6 ' +
  'C275,6 285,58 325,58 C355,58 362,32 340,32 C362,32 372,8 410,8 ' +
  'C448,8 458,56 495,56 C532,56 545,12 580,12 C615,12 640,32 680,32';

export type SetpointState = 'At setpoint' | 'Holding steady' | 'Drifting';

/**
 * unread → scaleY in [0.05 .. 1].
 *
 * Anything that is not a positive finite count reads as nothing unread rather
 * than throwing: a bad number must not take the header down with it.
 */
export function waveAmplitude(unread: number): number {
  if (!Number.isFinite(unread) || unread <= 0) return AMPLITUDE_FLOOR;
  return Math.min(1, AMPLITUDE_BASE + AMPLITUDE_STEP * Math.min(unread, AMPLITUDE_FULL_AT));
}

export function waveState(unread: number): SetpointState {
  if (!Number.isFinite(unread) || unread <= 0) return 'At setpoint';
  if (unread <= 2) return 'Holding steady';
  return 'Drifting';
}

/**
 * Read once. The preference does not change mid-session in practice, so a
 * listener here would be a subscription nothing ever fires.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  return reduced;
}

export function SetpointWave({ unread }: { unread: number }) {
  const amplitude = waveAmplitude(unread);
  const state = waveState(unread);
  const settled = state === 'At setpoint';
  const still = usePrefersReducedMotion();

  return (
    <div className={still ? 'sp-still' : undefined}>
      <div className="h-16">
        <svg
          className="block h-full w-full overflow-visible"
          viewBox="0 0 680 64"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line x1="0" y1="32" x2="680" y2="32" stroke="var(--sp-hair)" strokeWidth="1" />
          <path
            className="sp-wave"
            d={WAVE_PATH}
            fill="none"
            stroke="var(--sp-ink)"
            strokeWidth="2"
            opacity="0.85"
            style={{ transform: `scaleY(${amplitude})`, transformOrigin: '50% 32px' }}
          />
          <defs>
            <radialGradient id="sp-wave-glow">
              <stop offset="0%" stopColor="var(--sp-amber)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="var(--sp-amber)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="340" cy="32" r="16" fill="url(#sp-wave-glow)" />
          <circle cx="340" cy="32" r="6.5" fill="var(--sp-amber)" />
        </svg>
      </div>

      <div className="flex items-baseline justify-between">
        <span
          className={`sp-stateword font-mono text-[11px] uppercase tracking-[0.18em] ${
            settled ? 'text-sp-green' : 'text-sp-amber'
          }`}
        >
          {state}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-sp-faint">
          {unread > 0 ? `${unread} unread` : 'all read'}
        </span>
      </div>
    </div>
  );
}
