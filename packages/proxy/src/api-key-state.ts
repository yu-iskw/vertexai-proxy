import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

import { generateApiKey } from './api-key.js';

const MIN_API_KEY_LENGTH = 16;

type ApiKeySource = 'env' | 'state-file' | 'generated';

type ResolvedApiKey = {
  apiKey: string;
  source: ApiKeySource;
  stateFile?: string;
};

type StateFilePayload = {
  apiKey: string;
  createdAt: string;
};

export function validateApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed.length < MIN_API_KEY_LENGTH) {
    throw new Error(`API key must be at least ${MIN_API_KEY_LENGTH} characters.`);
  }
}

function parseStateFile(contents: string, path: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    throw new Error(`PROXY_STATE_FILE at ${path} is not valid JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`PROXY_STATE_FILE at ${path} must be a JSON object with apiKey.`);
  }
  const apiKey = (parsed as { apiKey?: unknown }).apiKey;
  if (typeof apiKey !== 'string') {
    throw new Error(`PROXY_STATE_FILE at ${path} must include a string apiKey field.`);
  }
  validateApiKey(apiKey);
  return apiKey.trim();
}

function readStateFile(path: string): string | undefined {
  try {
    return parseStateFile(readFileSync(path, 'utf8'), path);
  } catch (cause: unknown) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return undefined;
    }
    throw cause;
  }
}

function stateFileBody(apiKey: string): string {
  const payload: StateFilePayload = {
    apiKey,
    createdAt: new Date().toISOString(),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function writeStateFile(path: string, apiKey: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = stateFileBody(apiKey);
  let fd: number | undefined;
  try {
    fd = openSync(path, 'wx', 0o600);
    writeSync(fd, body);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  chmodSync(path, 0o600);
}

function createStateFileOrRead(path: string, apiKey: string): ResolvedApiKey {
  try {
    writeStateFile(path, apiKey);
    return { apiKey, source: 'generated', stateFile: path };
  } catch (cause: unknown) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EEXIST') {
      const existing = readStateFile(path);
      if (existing !== undefined) {
        return { apiKey: existing, source: 'state-file', stateFile: path };
      }
    }
    throw cause;
  }
}

export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): ResolvedApiKey {
  const fromEnv = (env.PROXY_API_KEY ?? '').trim();
  if (fromEnv !== '') {
    validateApiKey(fromEnv);
    return { apiKey: fromEnv, source: 'env' };
  }

  const statePath = (env.PROXY_STATE_FILE ?? '').trim();
  if (statePath !== '') {
    const existing = readStateFile(statePath);
    if (existing !== undefined) {
      return { apiKey: existing, source: 'state-file', stateFile: statePath };
    }
    const apiKey = generateApiKey();
    return createStateFileOrRead(statePath, apiKey);
  }

  return { apiKey: generateApiKey(), source: 'generated' };
}
