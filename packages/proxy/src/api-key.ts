import { randomBytes } from 'node:crypto';

export function generateApiKey(): string {
  return randomBytes(32).toString('base64url');
}

export function announceApiKey(
  apiKey: string,
  write: (line: string) => void = (line) => process.stderr.write(line),
): void {
  write(`vertexai-proxy API key: ${apiKey}\n`);
}
