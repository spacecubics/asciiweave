import { randomBytes } from 'node:crypto'

// 80 bits of randomness, base64url-encoded: 14 URL-safe characters,
// stable and non-sequential as the spec requires.
export function generateDocumentId(): string {
  return randomBytes(10).toString('base64url')
}
