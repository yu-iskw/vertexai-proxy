import { randomBytes } from 'node:crypto';

export function generateApiKey(): string {
  return randomBytes(32).toString('base64url');
}
