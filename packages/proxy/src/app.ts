import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import type { ModelDefinition } from './models.js';

type MessageRole = 'system' | 'user' | 'assistant';
type MessageContentPart = { type: string; text?: string };

type ChatMessage = {
  role: MessageRole;
  content: string | MessageContentPart[];
};

type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type AppOptions = {
  apiKey: string;
  models: ReadonlyMap<string, ModelDefinition>;
  project: string;
  location: string;
  getAccessToken: () => Promise<string>;
  fetch?: FetchLike;
};

export type ProxyRequest = {
  method: string;
  path: string;
  authorization: string | undefined;
  body: AsyncIterable<Uint8Array>;
};

export type ProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type App = {
  handle: (request: ProxyRequest) => Promise<ProxyResponse>;
};

type JsonRecord = Record<string, unknown>;
type VertexOutput = { text: string; tokens: { input: number; output: number } };
type VertexRequest = { url: string; payload: unknown };

const ROLE_SYSTEM = 'system';
const ROLE_USER = 'user';
const ROLE_ASSISTANT = 'assistant';
const PART_TEXT = 'text';
const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string | undefined;

  constructor(status: number, message: string, type: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value) || typeof value.role !== 'string') return false;
  if (![ROLE_SYSTEM, ROLE_USER, ROLE_ASSISTANT].includes(value.role)) return false;
  if (typeof value.content === 'string') return true;
  return (
    Array.isArray(value.content) &&
    value.content.every(
      (part) =>
        isRecord(part) &&
        typeof part.type === 'string' &&
        (part.text === undefined || typeof part.text === 'string'),
    )
  );
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!isRecord(value) || typeof value.model !== 'string' || !Array.isArray(value.messages)) {
    return false;
  }
  if (!value.messages.every(isMessage)) return false;
  if (value.max_tokens !== undefined && typeof value.max_tokens !== 'number') return false;
  if (value.temperature !== undefined && typeof value.temperature !== 'number') return false;
  if (value.stream !== undefined && typeof value.stream !== 'boolean') return false;
  return true;
}

function json(status: number, body: unknown): ProxyResponse {
  return {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function errorResponse(
  status: number,
  message: string,
  type: string,
  code?: string,
): ProxyResponse {
  return json(status, { error: { message, type, ...(code === undefined ? {} : { code }) } });
}

function authorized(header: string | undefined, apiKey: string): boolean {
  const candidate = header?.startsWith('Bearer ') === true ? header.slice(7) : '';
  const left = createHash('sha256').update(candidate).digest();
  const right = createHash('sha256').update(apiKey).digest();
  return timingSafeEqual(left, right);
}

async function bodyOf(body: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large', 'invalid_request_error');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
    ) as unknown;
  } catch {
    throw new HttpError(400, 'Invalid JSON body', 'invalid_request_error');
  }
}

function textOf(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (message.content.some((part) => part.type !== PART_TEXT)) {
    throw new HttpError(400, 'Only text messages are supported', 'invalid_request_error');
  }
  return message.content.map((part) => part.text ?? '').join('\n');
}

function geminiOutput(data: unknown): VertexOutput {
  if (!isRecord(data)) return { text: '', tokens: { input: 0, output: 0 } };
  const candidates = data.candidates;
  const first: unknown = Array.isArray(candidates) ? (candidates[0] as unknown) : undefined;
  const content = isRecord(first) ? first.content : undefined;
  const parts = isRecord(content) ? content.parts : undefined;
  const text = Array.isArray(parts)
    ? parts
        .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
        .join('')
    : '';
  const usage = isRecord(data.usageMetadata) ? data.usageMetadata : undefined;
  const input = usage?.promptTokenCount;
  const output = usage?.candidatesTokenCount;
  return {
    text,
    tokens: {
      input: typeof input === 'number' ? input : 0,
      output: typeof output === 'number' ? output : 0,
    },
  };
}

function anthropicOutput(data: unknown): VertexOutput {
  if (!isRecord(data)) return { text: '', tokens: { input: 0, output: 0 } };
  const content = data.content;
  const text = Array.isArray(content)
    ? content
        .flatMap((part) =>
          isRecord(part) && part.type === PART_TEXT && typeof part.text === 'string'
            ? [part.text]
            : [],
        )
        .join('')
    : '';
  const usage = isRecord(data.usage) ? data.usage : undefined;
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  return {
    text,
    tokens: {
      input: typeof input === 'number' ? input : 0,
      output: typeof output === 'number' ? output : 0,
    },
  };
}

function systemText(input: ChatRequest): string {
  return input.messages
    .filter((message) => message.role === ROLE_SYSTEM)
    .map(textOf)
    .join('\n');
}

function geminiRequest(input: ChatRequest, model: string, base: string): VertexRequest {
  const system = systemText(input);
  const contents = input.messages
    .filter((message) => message.role !== ROLE_SYSTEM)
    .map((message) => ({
      role: message.role === ROLE_ASSISTANT ? 'model' : ROLE_USER,
      parts: [{ text: textOf(message) }],
    }));
  return {
    url: `${base}/publishers/google/models/${model}:generateContent`,
    payload: {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        ...(input.max_tokens ? { maxOutputTokens: input.max_tokens } : {}),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      },
    },
  };
}

function anthropicRequest(input: ChatRequest, model: string, base: string): VertexRequest {
  const system = systemText(input);
  return {
    url: `${base}/publishers/anthropic/models/${model}:rawPredict`,
    payload: {
      anthropic_version: 'vertex-2023-10-16',
      max_tokens: input.max_tokens ?? 4096,
      ...(system ? { system } : {}),
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      messages: input.messages
        .filter((message) => message.role !== ROLE_SYSTEM)
        .map((message) => ({ role: message.role, content: textOf(message) })),
    },
  };
}

async function callVertex(
  input: ChatRequest,
  target: ModelDefinition,
  options: AppOptions,
): Promise<VertexOutput> {
  const token = await options.getAccessToken();
  if (!token) throw new HttpError(502, 'ADC access token unavailable', 'api_error');
  const base = `https://${options.location}-aiplatform.googleapis.com/v1/projects/${options.project}/locations/${options.location}`;
  const request =
    target.provider === 'gemini'
      ? geminiRequest(input, target.model, base)
      : anthropicRequest(input, target.model, base);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request.payload),
    });
    if (!response.ok) {
      throw new HttpError(502, `Vertex AI returned HTTP ${response.status}`, 'api_error');
    }
    const data = (await response.json()) as unknown;
    return target.provider === 'gemini' ? geminiOutput(data) : anthropicOutput(data);
  } finally {
    clearTimeout(timer);
  }
}

export function createApp(options: AppOptions): App {
  return {
    async handle(request) {
      try {
        if (request.method === 'GET' && request.path === '/healthz') {
          return json(200, { status: 'ok' });
        }
        if (!authorized(request.authorization, options.apiKey)) {
          return errorResponse(401, 'Unauthorized', 'authentication_error');
        }
        if (request.method === 'GET' && request.path === '/v1/models') {
          return json(200, {
            object: 'list',
            data: [...options.models.keys()].map((id) => ({
              id,
              object: 'model',
              owned_by: 'vertex-ai',
            })),
          });
        }
        if (request.method !== 'POST' || request.path !== '/v1/chat/completions') {
          return errorResponse(404, 'Not found', 'invalid_request_error');
        }
        const input = await bodyOf(request.body);
        if (!isChatRequest(input)) {
          return errorResponse(400, 'Invalid chat completion request', 'invalid_request_error');
        }
        if (input.stream === true) {
          return errorResponse(400, 'Streaming is not yet supported', 'invalid_request_error');
        }
        const target = options.models.get(input.model);
        if (target === undefined) {
          return errorResponse(
            404,
            `Model "${input.model}" not found`,
            'invalid_request_error',
            'model_not_found',
          );
        }
        const output = await callVertex(input, target, options);
        return json(200, {
          id: `chatcmpl-${randomUUID()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: input.model,
          choices: [
            {
              index: 0,
              message: { role: ROLE_ASSISTANT, content: output.text },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: output.tokens.input,
            completion_tokens: output.tokens.output,
            total_tokens: output.tokens.input + output.tokens.output,
          },
        });
      } catch (cause) {
        if (cause instanceof HttpError) {
          return errorResponse(cause.status, cause.message, cause.type, cause.code);
        }
        return errorResponse(502, 'Vertex AI request failed', 'api_error');
      }
    },
  };
}
