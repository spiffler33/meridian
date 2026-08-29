/**
 * The one random-id ladder.
 *
 * `crypto.randomUUID` is secure-context-only and is simply absent when the app
 * is opened over plain http on the LAN — which is how the phone reaches the
 * dev server — so fall back to `getRandomValues`, which is not gated on a
 * secure context. Some browsers expose neither; that is the callers' business,
 * because what they should throw differs.
 *
 * Pure: no imports.
 */

/**
 * A fresh random string: a UUID where one is available, otherwise `bytes`
 * bytes of hex. Null where the browser exposes no crypto random source at all.
 *
 * The two shapes differ in length and alphabet, which is fine for both callers:
 * one wants an opaque id, the other slices a fixed prefix off whatever comes
 * back.
 */
export function randomToken(bytes: number): string | null {
  const api: Crypto | undefined = globalThis.crypto;
  if (api && typeof api.randomUUID === 'function') return api.randomUUID();
  if (api && typeof api.getRandomValues === 'function') {
    const raw = api.getRandomValues(new Uint8Array(bytes));
    return Array.from(raw, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return null;
}
