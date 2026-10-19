import { describe, expect, it } from 'vitest';

import { formatAccessLogMeta } from './access-log.js';
import { createLogger } from './logger.js';

describe('formatAccessLogMeta', () => {
  it('returns an empty string when meta is undefined', () => {
    expect(formatAccessLogMeta(undefined)).toBe('');
  });

  it('formats key=value pairs with a leading space', () => {
    expect(
      formatAccessLogMeta({
        model: 'claude-haiku-5-5',
        finish_reason: 'stop',
        prompt_tokens: 12,
        total_tokens: 20,
      }),
    ).toBe(' model=claude-haiku-5-5 finish_reason=stop prompt_tokens=12 total_tokens=20');
  });
});

describe('log levels and access logs', () => {
  it('does not emit access lines when the logger level is warn', () => {
    const logger = createLogger('warn', {});
    expect(logger.isEnabled('info')).toBe(false);
  });
});
