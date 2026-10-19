import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { announceApiKey, generateApiKey } from './api-key.js';
import { createApp, type App, type AppOptions, type FetchLike, type ProxyResponse } from './app.js';
import { DEFAULT_MODELS, resolveModels } from './models.js';

const FIXED_KEY = 'fixed-test-key';

type RequestOptions = {
  authorization?: string;
  body?: unknown;
  rawBody?: string;
};

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function request(
  app: App,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ProxyResponse> {
  const text =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const chunks = text === undefined ? [] : [Buffer.from(text)];
  return app.handle({
    method,
    path,
    authorization: options.authorization,
    body: Readable.from(chunks),
  });
}

type Harness = {
  app: App;
  fetchMock: ReturnType<typeof vi.fn<FetchLike>>;
  getAccessToken: ReturnType<typeof vi.fn<() => Promise<string>>>;
};

function makeApp(overrides: Partial<AppOptions> = {}): Harness {
  const fetchMock = vi.fn<FetchLike>();
  const getAccessToken = vi.fn(() => Promise.resolve('access-token'));
  const app = createApp({
    apiKey: FIXED_KEY,
    models: resolveModels(undefined),
    project: 'test-project',
    location: 'us-central1',
    getAccessToken,
    fetch: fetchMock,
    ...overrides,
  });
  return { app, fetchMock, getAccessToken };
}

function bearer(key = FIXED_KEY): string {
  return `Bearer ${key}`;
}

function bodyText(init: RequestInit): string {
  if (typeof init.body !== 'string') throw new Error('Expected a string request body');
  return init.body;
}

describe('api key', () => {
  it('generates a 256-bit base64url key', () => {
    const key = generateApiKey();

    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateApiKey()).not.toBe(key);
  });

  it('announces the key once with a clear label', () => {
    const lines: string[] = [];

    announceApiKey('abc', (line) => lines.push(line));

    expect(lines).toEqual(['vertexai-proxy API key: abc\n']);
  });
});

describe('authentication', () => {
  it('rejects a missing bearer token', async () => {
    const { app } = makeApp();

    const response = await request(app, 'GET', '/v1/models');

    expect(response.status).toBe(401);
    expect(parseJson(response.body)).toEqual({
      error: { message: 'Unauthorized', type: 'authentication_error' },
    });
  });

  it('rejects a wrong bearer token', async () => {
    const { app } = makeApp();

    const response = await request(app, 'GET', '/v1/models', { authorization: bearer('wrong') });

    expect(response.status).toBe(401);
  });

  it('accepts the configured bearer token', async () => {
    const { app } = makeApp();

    const response = await request(app, 'GET', '/v1/models', { authorization: bearer() });

    expect(response.status).toBe(200);
  });
});

describe('models', () => {
  it('uses the declared default model map', () => {
    const models = resolveModels(undefined);

    expect([...models.keys()]).toEqual([...DEFAULT_MODELS.keys()]);
    expect(models.get('gemini-2.5-pro')).toEqual({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
    });
  });

  it('overrides the available set from VERTEX_MODELS', () => {
    const models = resolveModels('fast=gemini/gemini-2.0-flash,gemini-2.5-pro');

    expect([...models.keys()]).toEqual(['fast', 'gemini-2.5-pro']);
    expect(models.get('fast')).toEqual({ provider: 'gemini', model: 'gemini-2.0-flash' });
  });

  it('rejects an unknown default model id', () => {
    expect(() => resolveModels('missing-model')).toThrow(/Unknown default model/);
  });

  it('rejects an unsupported provider', () => {
    expect(() => resolveModels('x=openai/gpt-4')).toThrow(/provider/);
  });

  it('rejects a malformed entry', () => {
    expect(() => resolveModels('x=gemini')).toThrow(/alias=provider\/model/);
  });

  it('rejects duplicate aliases', () => {
    expect(() => resolveModels('gemini-2.5-pro,gemini-2.5-pro')).toThrow(/Duplicate/);
  });
});

describe('http surface', () => {
  it('serves /healthz without authentication', async () => {
    const { app } = makeApp();

    const response = await request(app, 'GET', '/healthz');

    expect(response.status).toBe(200);
    expect(parseJson(response.body)).toEqual({ status: 'ok' });
  });

  it('lists the configured models', async () => {
    const { app } = makeApp({ models: resolveModels('fast=gemini/gemini-2.0-flash') });

    const response = await request(app, 'GET', '/v1/models', { authorization: bearer() });

    expect(response.status).toBe(200);
    expect(parseJson(response.body)).toEqual({
      object: 'list',
      data: [{ id: 'fast', object: 'model', owned_by: 'vertex-ai' }],
    });
  });

  it('returns a model_not_found error for an unknown model', async () => {
    const { app, fetchMock } = makeApp();

    const response = await request(app, 'POST', '/v1/chat/completions', {
      authorization: bearer(),
      body: { model: 'missing', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(response.status).toBe(404);
    expect(parseJson(response.body)).toEqual({
      error: {
        message: 'Model "missing" not found',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects chat bodies larger than 1 MiB', async () => {
    const { app, fetchMock } = makeApp();

    const response = await request(app, 'POST', '/v1/chat/completions', {
      authorization: bearer(),
      body: {
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'x'.repeat(1024 * 1024) }],
      },
    });

    expect(response.status).toBe(413);
    expect(parseJson(response.body)).toEqual({
      error: { message: 'Request body too large', type: 'invalid_request_error' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-text message content', async () => {
    const { app, fetchMock } = makeApp();

    const response = await request(app, 'POST', '/v1/chat/completions', {
      authorization: bearer(),
      body: {
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: [{ type: 'image', text: 'x' }] }],
      },
    });

    expect(response.status).toBe(400);
    expect(parseJson(response.body)).toEqual({
      error: { message: 'Only text messages are supported', type: 'invalid_request_error' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const { app } = makeApp();

    const response = await request(app, 'POST', '/v1/chat/completions', {
      authorization: bearer(),
      rawBody: '{',
    });

    expect(response.status).toBe(400);
    expect(parseJson(response.body)).toEqual({
      error: { message: 'Invalid JSON body', type: 'invalid_request_error' },
    });
  });
});

describe('vertex request mapping', () => {
  it('maps a Gemini request and response', async () => {
    const { app, fetchMock } = makeApp();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'hello' }] } }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
        }),
        { status: 200 },
      ),
    );

    const response = await request(app, 'POST', '/v1/chat/completions', {
      authorization: bearer(),
      body: {
        model: 'gemini-2.5-pro',
        messages: [
          { role: 'system', content: 'be nice' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
        max_tokens: 10,
        temperature: 0.2,
      },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent',
    );
    expect(init.headers).toEqual({
      authorization: 'Bearer access-token',
      'content-type': 'application/json',
    });
    expect(parseJson(bodyText(init))).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
      ],
      systemInstruction: { parts: [{ text: 'be nice' }] },
      generationConfig: { maxOutputTokens: 10, temperature: 0.2 },
    });
    expect(parseJson(response.body)).toMatchObject({
      object: 'chat.completion',
      model: 'gemini-2.5-pro',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hello' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
  });

  it('maps a Claude request and response', async () => {
    const { app, fetchMock } = makeApp({
      models: resolveModels('claude=claude/claude-3-5-haiku@20241022'),
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'bonjour' }],
          usage: { input_tokens: 4, output_tokens: 1 },
        }),
        { status: 200 },
      ),
    );

    const response = await request(app, 'POST', '/v1/chat/completions', {
      authorization: bearer(),
      body: { model: 'claude', messages: [{ role: 'user', content: 'salut' }] },
    });

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/anthropic/models/claude-3-5-haiku@20241022:rawPredict',
    );
    expect(parseJson(bodyText(init))).toEqual({
      anthropic_version: 'vertex-2023-10-16',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'salut' }],
    });
    expect(parseJson(response.body)).toMatchObject({
      model: 'claude',
      choices: [{ message: { role: 'assistant', content: 'bonjour' } }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    });
  });
});
