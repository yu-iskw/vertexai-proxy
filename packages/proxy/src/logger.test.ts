import { describe, expect, it, vi } from 'vitest';

import { createLogger, parseLogLevel, resolveLogLevel, writeBootstrapLine } from './logger.js';

describe('parseLogLevel', () => {
  it('accepts known levels', () => {
    expect(parseLogLevel('error')).toBe('error');
    expect(parseLogLevel('DEBUG')).toBe('debug');
  });

  it('rejects unknown levels', () => {
    expect(() => parseLogLevel('trace')).toThrow(/PROXY_LOG_LEVEL/);
  });
});

describe('resolveLogLevel', () => {
  it('prefers the flag over the environment', () => {
    expect(resolveLogLevel('warn', { PROXY_LOG_LEVEL: 'debug' })).toBe('warn');
  });

  it('defaults to info', () => {
    expect(resolveLogLevel(undefined, {})).toBe('info');
  });
});

describe('createLogger', () => {
  it('filters messages below the configured level', () => {
    const logger = createLogger('warn', {});
    expect(logger.isEnabled('info')).toBe(false);
    expect(logger.isEnabled('warn')).toBe(true);
    expect(logger.isEnabled('error')).toBe(true);
  });
});

describe('writeBootstrapLine', () => {
  it('writes even when the configured log level is warn', () => {
    const writes: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    createLogger('warn', {});
    writeBootstrapLine('listening on http://127.0.0.1:8765', {});
    stderr.mockRestore();
    expect(writes).toEqual(['vertexai-proxy listening on http://127.0.0.1:8765\n']);
  });
});
