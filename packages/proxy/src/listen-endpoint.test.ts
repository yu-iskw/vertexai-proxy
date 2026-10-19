import { describe, expect, it } from 'vitest';

import { resolveListenEndpoint } from './listen-endpoint.js';

describe('resolveListenEndpoint', () => {
  it('uses 127.0.0.1:8765 when host and port are unset', () => {
    expect(resolveListenEndpoint({})).toEqual({ host: '127.0.0.1', port: 8765 });
  });

  it('uses PROXY_PORT and ignores PORT when the host is unset', () => {
    expect(resolveListenEndpoint({ PROXY_PORT: '18765', PORT: '8080' })).toEqual({
      host: '127.0.0.1',
      port: 18765,
    });
  });

  it('treats a whitespace PROXY_HOST as unset and ignores PORT', () => {
    expect(resolveListenEndpoint({ PROXY_HOST: '   ', PORT: '8080' })).toEqual({
      host: '127.0.0.1',
      port: 8765,
    });
  });

  it('uses PORT when the host is 0.0.0.0 and PROXY_PORT is unset', () => {
    expect(resolveListenEndpoint({ PROXY_HOST: '0.0.0.0', PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it('prefers PROXY_PORT over PORT when the host is set', () => {
    expect(
      resolveListenEndpoint({ PROXY_HOST: '0.0.0.0', PROXY_PORT: '9000', PORT: '8080' }),
    ).toEqual({
      host: '0.0.0.0',
      port: 9000,
    });
  });

  it('uses 8765 when the host is set and neither port variable is present', () => {
    expect(resolveListenEndpoint({ PROXY_HOST: '0.0.0.0' })).toEqual({
      host: '0.0.0.0',
      port: 8765,
    });
  });

  it('uses PORT when PROXY_HOST is explicitly 127.0.0.1', () => {
    expect(resolveListenEndpoint({ PROXY_HOST: '127.0.0.1', PORT: '8080' })).toEqual({
      host: '127.0.0.1',
      port: 8080,
    });
  });

  it('trims a set host', () => {
    expect(resolveListenEndpoint({ PROXY_HOST: '  0.0.0.0  ', PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it('rejects a host other than 127.0.0.1 or 0.0.0.0', () => {
    expect(() => resolveListenEndpoint({ PROXY_HOST: 'localhost' })).toThrow(
      'PROXY_HOST must be 127.0.0.1 or 0.0.0.0.',
    );
  });

  it('rejects an empty PROXY_PORT and does not fall through to PORT', () => {
    expect(() =>
      resolveListenEndpoint({ PROXY_HOST: '0.0.0.0', PROXY_PORT: '', PORT: '8080' }),
    ).toThrow('PROXY_PORT must be an integer between 1 and 65535.');
    expect(() => resolveListenEndpoint({ PROXY_PORT: '', PORT: '8080' })).toThrow(
      'PROXY_PORT must be an integer between 1 and 65535.',
    );
  });

  it('rejects PORT=0 only when the host is set', () => {
    expect(resolveListenEndpoint({ PORT: '0' })).toEqual({ host: '127.0.0.1', port: 8765 });
    expect(() => resolveListenEndpoint({ PROXY_HOST: '0.0.0.0', PORT: '0' })).toThrow(
      'PORT must be an integer between 1 and 65535.',
    );
  });

  it('rejects a non-integer or out-of-range present port', () => {
    expect(() => resolveListenEndpoint({ PROXY_PORT: '65536' })).toThrow(
      'PROXY_PORT must be an integer between 1 and 65535.',
    );
    expect(() => resolveListenEndpoint({ PROXY_HOST: '0.0.0.0', PORT: '8080.5' })).toThrow(
      'PORT must be an integer between 1 and 65535.',
    );
  });
});
