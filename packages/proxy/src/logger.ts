import { createWriteStream, type WriteStream } from 'node:fs';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

function levelRank(level: LogLevel): number {
  switch (level) {
    case 'error':
      return 0;
    case 'warn':
      return 1;
    case 'info':
      return 2;
    case 'debug':
      return 3;
    default: {
      const exhaustive: never = level;
      return exhaustive;
    }
  }
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  const normalized = (value ?? fallback).trim().toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(normalized)) {
    return normalized as LogLevel;
  }
  throw new Error(
    `PROXY_LOG_LEVEL or --log-level must be one of: ${LOG_LEVELS.join(', ')} (got "${value ?? ''}").`,
  );
}

export function resolveLogLevel(flag: string | undefined, env: NodeJS.ProcessEnv): LogLevel {
  const fromEnv = env.PROXY_LOG_LEVEL?.trim();
  if (flag !== undefined && flag.trim() !== '') {
    return parseLogLevel(flag.trim());
  }
  if (fromEnv !== undefined && fromEnv !== '') {
    return parseLogLevel(fromEnv);
  }
  return 'info';
}

export type Logger = {
  readonly level: LogLevel;
  isEnabled(level: LogLevel): boolean;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
};

let fileSink: WriteStream | undefined;
let fileSinkPath: string | undefined;

function resetLogSink(): void {
  fileSink?.end();
  fileSink = undefined;
  fileSinkPath = undefined;
}

function logFileFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const path = (env.PROXY_LOG_FILE ?? '').trim();
  return path === '' ? undefined : path;
}

function resolveFileSink(env: NodeJS.ProcessEnv): WriteStream | undefined {
  const path = logFileFromEnv(env);
  if (path === undefined) return undefined;
  if (fileSinkPath === path && fileSink !== undefined) return fileSink;
  resetLogSink();
  fileSinkPath = path;
  fileSink = createWriteStream(path, { flags: 'a' });
  return fileSink;
}

export function logFilePath(env: NodeJS.ProcessEnv): string | undefined {
  return logFileFromEnv(env);
}

function formatLine(level: LogLevel, message: string): string {
  if (level === 'info') return `vertexai-proxy ${message}\n`;
  return `vertexai-proxy [${level}] ${message}\n`;
}

/** Startup lines scripts grep for; not filtered by log level. */
export function writeBootstrapLine(message: string, env: NodeJS.ProcessEnv = process.env): void {
  const line = formatLine('info', message);
  process.stderr.write(line);
  resolveFileSink(env)?.write(line);
}

export function createLogger(level: LogLevel, env: NodeJS.ProcessEnv = process.env): Logger {
  const minimum = levelRank(level);
  const write = (entryLevel: LogLevel, message: string) => {
    if (levelRank(entryLevel) > minimum) return;
    const line = formatLine(entryLevel, message);
    process.stderr.write(line);
    resolveFileSink(env)?.write(line);
  };
  return {
    level,
    isEnabled(entryLevel: LogLevel) {
      return levelRank(entryLevel) <= minimum;
    },
    error(message: string) {
      write('error', message);
    },
    warn(message: string) {
      write('warn', message);
    },
    info(message: string) {
      write('info', message);
    },
    debug(message: string) {
      write('debug', message);
    },
  };
}
