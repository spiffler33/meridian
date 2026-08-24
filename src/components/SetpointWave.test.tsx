/**
 * SetpointWave.
 *
 * The instrument has to be readable as a number before it is readable as a
 * picture, so the mapping is what this covers: the floor at nothing unread,
 * the ceiling at four, the ladder of words in between, and the two ways a
 * caller can hand it something that is not a count. Plus the one accessibility
 * contract that is not a colour: reduced motion stops the travel.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { SetpointWave, waveAmplitude, waveState } from './SetpointWave';

const originalMatchMedia = window.matchMedia;

function stubReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe('the amplitude mapping', () => {
  it('rests on the floor when nothing is unread', () => {
    expect(waveAmplitude(0)).toBe(0.05);
  });

  it('grows with the backlog', () => {
    expect(waveAmplitude(1)).toBeCloseTo(0.5125);
    expect(waveAmplitude(2)).toBeCloseTo(0.675);
    expect(waveAmplitude(3)).toBeCloseTo(0.8375);
  });

  it('fills the frame at four and never overshoots it', () => {
    expect(waveAmplitude(4)).toBe(1);
    expect(waveAmplitude(40)).toBe(1);
    expect(waveAmplitude(326)).toBe(1);
  });

  it('reads a count that is not a count as nothing unread, rather than throwing', () => {
    expect(waveAmplitude(-3)).toBe(0.05);
    expect(waveAmplitude(NaN)).toBe(0.05);
    expect(waveState(NaN)).toBe('At setpoint');
  });
});

describe('the state ladder', () => {
  it('names the three states', () => {
    expect(waveState(0)).toBe('At setpoint');
    expect(waveState(1)).toBe('Holding steady');
    expect(waveState(2)).toBe('Holding steady');
    expect(waveState(3)).toBe('Drifting');
  });
});

describe('the instrument', () => {
  it('carries its reading as text, not only as a drawing', () => {
    render(<SetpointWave unread={4} />);
    expect(screen.getByText('Drifting')).toBeInTheDocument();
    expect(screen.getByText('4 unread')).toBeInTheDocument();
  });

  it('says all read rather than zero unread', () => {
    render(<SetpointWave unread={0} />);
    expect(screen.getByText('At setpoint')).toBeInTheDocument();
    expect(screen.getByText('all read')).toBeInTheDocument();
  });

  it('scales the wave by the amplitude for that backlog', () => {
    const { container } = render(<SetpointWave unread={2} />);
    const wave = container.querySelector('.sp-wave');
    expect(wave).toHaveStyle({ transform: 'scaleY(0.675)' });
  });

  it('travels by default', () => {
    stubReducedMotion(false);
    const { container } = render(<SetpointWave unread={2} />);
    expect(container.querySelector('.sp-still')).toBeNull();
    expect(container.querySelector('.sp-wave')).not.toBeNull();
  });

  it('stops travelling when the reader asked for less motion, and still reports', () => {
    stubReducedMotion(true);
    const { container } = render(<SetpointWave unread={2} />);
    expect(container.querySelector('.sp-still')).not.toBeNull();
    expect(screen.getByText('Holding steady')).toBeInTheDocument();
  });
});
