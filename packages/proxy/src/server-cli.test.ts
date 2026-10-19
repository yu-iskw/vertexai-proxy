import { describe, expect, it, vi } from 'vitest';

import {
  CLOUD_PLATFORM_SCOPE,
  createGetAccessToken,
  parseCli,
  type AuthFactory,
} from './server.js';

const PROJECT = 'test-project';
const SERVICE_ACCOUNT = 'proxy@test-project.iam.gserviceaccount.com';

function options(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const result = parseCli(argv, env);
  if (result.help) throw new Error('Expected CLI options');
  return result.options;
}

describe('cli', () => {
  it('uses environment values when flags are absent', () => {
    const parsed = options([], {
      GOOGLE_CLOUD_PROJECT: PROJECT,
      VERTEX_LOCATION: 'us-central1',
      VERTEX_MODELS: 'gemini-2.5-pro',
      IMPERSONATE_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
      PROXY_PORT: '9999',
    });

    expect(parsed.project).toBe(PROJECT);
    expect(parsed.location).toBe('us-central1');
    expect([...parsed.models.keys()]).toEqual(['gemini-2.5-pro']);
    expect(parsed.impersonateServiceAccount).toBe(SERVICE_ACCOUNT);
    expect(parsed.port).toBe(9999);
  });

  it('prefers flags over environment values', () => {
    const parsed = options(
      [
        '--project',
        'flag-project',
        '--location',
        'global',
        '--models',
        'gemini-3.8-flash',
        '--impersonate-service-account',
        'flag@flag-project.iam.gserviceaccount.com',
      ],
      {
        GOOGLE_CLOUD_PROJECT: 'env-project',
        VERTEX_LOCATION: 'us-central1',
        VERTEX_MODELS: 'gemini-2.5-pro',
        IMPERSONATE_SERVICE_ACCOUNT: 'env@env-project.iam.gserviceaccount.com',
        PROXY_PORT: '9999',
      },
    );

    expect(parsed.project).toBe('flag-project');
    expect(parsed.location).toBe('global');
    expect([...parsed.models.keys()]).toEqual(['gemini-3.8-flash']);
    expect(parsed.impersonateServiceAccount).toBe('flag@flag-project.iam.gserviceaccount.com');
    expect(parsed.port).toBe(9999);
  });

  it('returns help without requiring a project', () => {
    expect(parseCli(['--help'], {})).toEqual({ help: true });
    expect(parseCli(['-h'], {})).toEqual({ help: true });
  });

  it('rejects unknown flags', () => {
    expect(() => parseCli(['--unknown'], {})).toThrow(/Invalid arguments/);
  });

  it.each(['us', 'eu'])('accepts multi-region location %s', (location) => {
    expect(options(['--project', PROJECT, '--location', location], {}).location).toBe(location);
  });

  it('rejects an invalid location', () => {
    expect(() => parseCli(['--project', PROJECT, '--location', 'us-central'], {})).toThrow(
      /global, us, eu/,
    );
  });

  it('rejects an invalid port', () => {
    expect(() => parseCli([], { GOOGLE_CLOUD_PROJECT: PROJECT, PROXY_PORT: '0' })).toThrow(
      /PROXY_PORT/,
    );
  });

  it('rejects an empty impersonation flag', () => {
    expect(() => parseCli(['--project', PROJECT, '--impersonate-service-account', ''], {})).toThrow(
      /requires a service account email/,
    );
  });

  it('parses model aliases and restricts the map', () => {
    const parsed = options(
      ['--project', PROJECT, '--models', 'gemini-3.8-flash,fast=gemini/gemini-3.7-flash'],
      {},
    );

    expect([...parsed.models.keys()]).toEqual(['gemini-3.8-flash', 'fast']);
    expect(parsed.models.get('fast')).toEqual({ provider: 'gemini', model: 'gemini-3.7-flash' });
  });

  it('rejects a missing project', () => {
    expect(() => parseCli([], {})).toThrow(/GOOGLE_CLOUD_PROJECT|--project/);
  });

  it('rejects an invalid service account', () => {
    expect(() =>
      parseCli(['--project', PROJECT, '--impersonate-service-account', 'not-an-email'], {}),
    ).toThrow(/service account email/);
  });

  it('uses the flag name in model errors', () => {
    expect(() => parseCli(['--project', PROJECT, '--models', 'missing-model'], {})).toThrow(
      /Invalid --models|Unknown default model/,
    );
  });
});

describe('access token', () => {
  it('uses plain ADC when no service account is configured', async () => {
    const getAccessToken = vi.fn(() => Promise.resolve({ token: 'adc-token' }));
    const sourceClient = { getAccessToken };
    const getClient = vi.fn(() => Promise.resolve(sourceClient));
    const GoogleAuth = vi.fn(function GoogleAuthMock() {
      return { getClient };
    });
    const Impersonated = vi.fn();
    const token = createGetAccessToken(undefined, {
      GoogleAuth,
      Impersonated,
    } as unknown as AuthFactory);

    await expect(token()).resolves.toBe('adc-token');
    expect(GoogleAuth).toHaveBeenCalledWith({ scopes: [CLOUD_PLATFORM_SCOPE] });
    expect(Impersonated).not.toHaveBeenCalled();
  });

  it('wires Impersonated with plain ADC as the source client', async () => {
    const sourceClient = { getAccessToken: vi.fn() };
    const impersonatedToken = vi.fn(() => Promise.resolve({ token: 'impersonated-token' }));
    const getClient = vi.fn(() => Promise.resolve(sourceClient));
    const GoogleAuth = vi.fn(function GoogleAuthMock() {
      return { getClient };
    });
    const Impersonated = vi.fn(function ImpersonatedMock() {
      return { getAccessToken: impersonatedToken };
    });
    const token = createGetAccessToken(SERVICE_ACCOUNT, {
      GoogleAuth,
      Impersonated,
    } as unknown as AuthFactory);

    await expect(token()).resolves.toBe('impersonated-token');
    await expect(token()).resolves.toBe('impersonated-token');
    expect(GoogleAuth).toHaveBeenCalledWith({ scopes: [CLOUD_PLATFORM_SCOPE] });
    expect(Impersonated).toHaveBeenCalledTimes(1);
    expect(Impersonated).toHaveBeenCalledWith({
      sourceClient,
      targetPrincipal: SERVICE_ACCOUNT,
      targetScopes: [CLOUD_PLATFORM_SCOPE],
    });
  });
});
