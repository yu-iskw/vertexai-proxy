import { describe, expect, it } from 'vitest';

import { createLogger, parseLogLevel, resolveLogLevel } from './logger.js';

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
