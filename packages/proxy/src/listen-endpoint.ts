const LISTEN_HOSTS = ['127.0.0.1', '0.0.0.0'] as const;
const DEFAULT_PORT = 8765;

export type ListenHost = (typeof LISTEN_HOSTS)[number];

export type ListenEndpoint = {
  readonly host: ListenHost;
  readonly port: number;
};

type PortVariable = 'PROXY_PORT' | 'PORT';

type PresentPort = {
  readonly variable: PortVariable;
  readonly raw: string;
};

function isListenHost(value: string): value is ListenHost {
  for (const host of LISTEN_HOSTS) {
    if (host === value) return true;
  }
  return false;
}

function resolveHost(env: NodeJS.ProcessEnv): ListenHost | undefined {
  const trimmed = (env.PROXY_HOST ?? '').trim();
  if (trimmed === '') return undefined;
  if (isListenHost(trimmed)) return trimmed;
  throw new Error('PROXY_HOST must be 127.0.0.1 or 0.0.0.0.');
}

function presentPort(env: NodeJS.ProcessEnv, hostIsSet: boolean): PresentPort | undefined {
  if (env.PROXY_PORT !== undefined) {
    return { variable: 'PROXY_PORT', raw: env.PROXY_PORT };
  }
  if (hostIsSet && env.PORT !== undefined) {
    return { variable: 'PORT', raw: env.PORT };
  }
  return undefined;
}

function parsePort(present: PresentPort): number {
  const port = Number(present.raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${present.variable} must be an integer between 1 and 65535.`);
  }
  return port;
}

export function resolveListenEndpoint(env: NodeJS.ProcessEnv): ListenEndpoint {
  const host = resolveHost(env);
  const present = presentPort(env, host !== undefined);
  return {
    host: host ?? '127.0.0.1',
    port: present === undefined ? DEFAULT_PORT : parsePort(present),
  };
}
