import type { Logger } from './logger.js';

export function accessLogEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = (env.PROXY_ACCESS_LOG ?? '1').trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'no';
}

export function logRequest(
  method: string,
  path: string,
  logger: Logger,
  env: NodeJS.ProcessEnv,
): void {
  if (!accessLogEnabled(env) || !logger.isEnabled('info')) return;
  logger.info(`request ${method} ${path}`);
}

export type LogResponseInput = {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  meta: AccessLogMeta | undefined;
  logger: Logger;
  env: NodeJS.ProcessEnv;
};

export function logResponse(input: LogResponseInput): void {
  if (!accessLogEnabled(input.env) || !input.logger.isEnabled('info')) return;
  input.logger.info(
    `response ${input.method} ${input.path} ${input.status} ${input.durationMs}ms${formatAccessLogMeta(input.meta)}`,
  );
}

export function requestPath(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

export type AccessLogMeta = Record<string, string | number>;

export function formatAccessLogMeta(meta: AccessLogMeta | undefined): string {
  if (meta === undefined) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    parts.push(`${key}=${String(value)}`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}
