/** Cryptographic randomness via Web Crypto (global in Node 20+ and in Cloudflare Workers). */
export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function randomHex(nBytes: number): string {
  let s = '';
  for (const v of randomBytes(nBytes)) s += v.toString(16).padStart(2, '0');
  return s;
}
