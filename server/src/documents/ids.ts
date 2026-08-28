// 80 bits of randomness, base64url-encoded: 14 URL-safe characters,
// stable and non-sequential as the spec requires. Uses the Web Crypto
// API so the same code runs on Node and the Cloudflare Workers runtime.
export function generateDocumentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
