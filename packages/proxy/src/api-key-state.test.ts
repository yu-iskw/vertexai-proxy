import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  apiKeyBootstrapText,
  resolveApiKey,
  validateApiKey,
  writeStateFile,
} from './api-key-state.js';

describe('apiKeyBootstrapText', () => {
  const apiKey = 'fixed-key-at-least-16-chars';

  it('does not produce a bootstrap line for an env-sourced key', () => {
    expect(apiKeyBootstrapText('env', apiKey)).toBeUndefined();
  });

  it('prints a generated key', () => {
    expect(apiKeyBootstrapText('generated', apiKey)).toBe(`API key: ${apiKey}`);
  });

  it('prints a state-file key', () => {
    expect(apiKeyBootstrapText('state-file', apiKey)).toBe(`API key: ${apiKey}`);
  });
});

describe('validateApiKey', () => {
  it('rejects short keys', () => {
    expect(() => validateApiKey('short')).toThrow(/at least/);
  });
});

describe('resolveApiKey', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses PROXY_API_KEY when set', () => {
    const resolved = resolveApiKey({ PROXY_API_KEY: 'fixed-key-at-least-16-chars' });
    expect(resolved.source).toBe('env');
    expect(resolved.apiKey).toBe('fixed-key-at-least-16-chars');
  });

  it('reuses a persisted key from PROXY_STATE_FILE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vertexai-proxy-state-'));
    dirs.push(dir);
    const file = join(dir, 'state.json');
    writeStateFile(file, 'persisted-key-0123456789ab');
    const resolved = resolveApiKey({ PROXY_STATE_FILE: file });
    expect(resolved.source).toBe('state-file');
    expect(resolved.apiKey).toBe('persisted-key-0123456789ab');
  });

  it('creates a state file when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vertexai-proxy-state-'));
    dirs.push(dir);
    const file = join(dir, 'nested', 'state.json');
    const resolved = resolveApiKey({ PROXY_STATE_FILE: file });
    expect(resolved.source).toBe('generated');
    expect(resolved.stateFile).toBe(file);
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { apiKey: string };
    expect(onDisk.apiKey).toBe(resolved.apiKey);
  });

  it('returns the same key on a second start when PROXY_STATE_FILE is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vertexai-proxy-state-'));
    dirs.push(dir);
    const file = join(dir, 'state.json');
    const first = resolveApiKey({ PROXY_STATE_FILE: file });
    const second = resolveApiKey({ PROXY_STATE_FILE: file });
    expect(first.source).toBe('generated');
    expect(second.source).toBe('state-file');
    expect(second.apiKey).toBe(first.apiKey);
  });

  it('generates an ephemeral key when no env or state file is configured', () => {
    const first = resolveApiKey({});
    const second = resolveApiKey({});
    expect(first.source).toBe('generated');
    expect(second.source).toBe('generated');
    expect(first.apiKey).not.toBe(second.apiKey);
  });
});
