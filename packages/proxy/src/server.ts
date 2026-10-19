import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { GoogleAuth, Impersonated } from 'google-auth-library';

import { logRequest, logResponse, requestPath } from './access-log.js';
import { resolveApiKey } from './api-key-state.js';
import { createApp } from './app.js';
import { resolveListenEndpoint } from './listen-endpoint.js';
import { isSupportedLocation } from './locations.js';
import {
  createLogger,
  logFilePath,
  resolveLogLevel,
  writeBootstrapLine,
  type LogLevel,
} from './logger.js';
import { resolveModels, type ModelDefinition } from './models.js';

const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,62}$/;
const SERVICE_ACCOUNT_PATTERN = /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/;
export const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const USAGE = `Usage: vertexai-proxy [options]

Options:
  --project <id>                         Google Cloud project ID (env: GOOGLE_CLOUD_PROJECT)
  --location <location>                  global, us, eu, or a region (env: VERTEX_LOCATION, default: global)
  --models <ids>                         Comma-separated model IDs (env: VERTEX_MODELS)
  --impersonate-service-account <email>  Target service account (env: IMPERSONATE_SERVICE_ACCOUNT)
  --log-level <level>                    error, warn, info, or debug (env: PROXY_LOG_LEVEL, default: info)
  -h, --help                             Show this help

Environment:
  PROXY_HOST                             Listen host, 127.0.0.1 or 0.0.0.0 (default: 127.0.0.1)
  PROXY_PORT                             Listen port (default: 8765)
  PORT                                   Used only when PROXY_HOST is set and PROXY_PORT is unset
  PROXY_LOG_LEVEL                        Minimum log level (default: info)
  PROXY_ACCESS_LOG                       HTTP access lines at info (default: 1; set 0 to disable)
  PROXY_LOG_FILE                         Append all emitted log lines to this file path
  PROXY_API_KEY                          Fixed bearer key (min 16 characters); overrides state file
  PROXY_STATE_FILE                       JSON file path to load or persist a generated API key (mode 0600)
`;

type CliOptions = {
  project: string;
  location: string;
  models: ReadonlyMap<string, ModelDefinition>;
  impersonateServiceAccount: string | undefined;
  logLevel: LogLevel;
};

type CliResult = { help: true } | { help: false; options: CliOptions };

export type AuthFactory = {
  GoogleAuth: typeof GoogleAuth;
  Impersonated: typeof Impersonated;
};

function parseCliArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        project: { type: 'string' },
        location: { type: 'string' },
        models: { type: 'string' },
        'impersonate-service-account': { type: 'string' },
        'log-level': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid arguments: ${message}`);
  }
}

function resolveProject(value: string | undefined, env: NodeJS.ProcessEnv): string {
  const project = (value ?? env.GOOGLE_CLOUD_PROJECT ?? '').trim();
  if (!PROJECT_PATTERN.test(project)) {
    throw new Error(
      'Configure GOOGLE_CLOUD_PROJECT or pass --project with a valid Google Cloud project id.',
    );
  }
  return project;
}

function resolveLocation(value: string | undefined, env: NodeJS.ProcessEnv): string {
  const location = (value ?? env.VERTEX_LOCATION ?? 'global').trim();
  if (!isSupportedLocation(location)) {
    throw new Error(
      'VERTEX_LOCATION or --location must be global, us, eu, or look like us-central1.',
    );
  }
  return location;
}

function resolveImpersonation(
  value: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (value !== undefined && value.trim() === '') {
    throw new Error('--impersonate-service-account requires a service account email.');
  }
  const serviceAccount = (value ?? env.IMPERSONATE_SERVICE_ACCOUNT ?? '').trim() || undefined;
  if (serviceAccount !== undefined && !SERVICE_ACCOUNT_PATTERN.test(serviceAccount)) {
    throw new Error(
      '--impersonate-service-account or IMPERSONATE_SERVICE_ACCOUNT must be a service account email like name@project.iam.gserviceaccount.com.',
    );
  }
  return serviceAccount;
}

export function parseCli(argv: string[], env: NodeJS.ProcessEnv = process.env): CliResult {
  const { values } = parseCliArgs(argv);
  if (values.help === true) return { help: true };

  return {
    help: false,
    options: {
      project: resolveProject(values.project, env),
      location: resolveLocation(values.location, env),
      models: resolveModels(
        values.models ?? env.VERTEX_MODELS,
        values.models === undefined ? 'VERTEX_MODELS' : '--models',
      ),
      impersonateServiceAccount: resolveImpersonation(values['impersonate-service-account'], env),
      logLevel: resolveLogLevel(values['log-level'], env),
    },
  };
}

export function createGetAccessToken(
  impersonateServiceAccount: string | undefined,
  factory: AuthFactory = { GoogleAuth, Impersonated },
): () => Promise<string> {
  const auth = new factory.GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  let clientPromise: Promise<Awaited<ReturnType<typeof auth.getClient>>> | undefined;
  const getClient = () => {
    clientPromise ??= auth.getClient().then((sourceClient) =>
      impersonateServiceAccount === undefined
        ? sourceClient
        : new factory.Impersonated({
            sourceClient,
            targetPrincipal: impersonateServiceAccount,
            targetScopes: [CLOUD_PLATFORM_SCOPE],
          }),
    );
    return clientPromise;
  };
  return async () => {
    const client = await getClient();
    const token = await client.getAccessToken();
    if (token.token === null || token.token === undefined) {
      const message =
        impersonateServiceAccount === undefined
          ? 'ADC access token unavailable'
          : `Access token unavailable for impersonated account ${impersonateServiceAccount}`;
      throw new Error(message);
    }
    return token.token;
  };
}

export function start(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): void {
  const parsed = parseCli(argv, env);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }
  const endpoint = resolveListenEndpoint(env);
  const { project, location, models, impersonateServiceAccount, logLevel } = parsed.options;
  const logger = createLogger(logLevel, env);
  const { apiKey, source, stateFile } = resolveApiKey(env);
  if (source === 'env') {
    logger.info('API key loaded from PROXY_API_KEY');
  } else {
    writeBootstrapLine(`API key: ${apiKey}`, env);
    if (source === 'state-file' && stateFile !== undefined) {
      logger.info(`API key loaded from ${stateFile}`);
    } else if (stateFile !== undefined) {
      logger.info(`API key generated and persisted to ${stateFile}`);
    } else {
      logger.info(
        'API key generated for this process (set PROXY_API_KEY or PROXY_STATE_FILE to fix across restarts)',
      );
    }
  }

  const getAccessToken = createGetAccessToken(impersonateServiceAccount);
  const app = createApp({ apiKey, models, project, location, getAccessToken, logger });

  const logPath = logFilePath(env);
  if (logPath !== undefined) {
    logger.info(`log file: ${logPath}`);
  }
  logger.info(`log level: ${logLevel}`);
  const server = createServer((req, res) => {
    const started = Date.now();
    const method = req.method ?? 'GET';
    const path = requestPath(req.url ?? '/');
    logRequest(method, path, logger, env);
    void app
      .handle({
        method,
        path,
        authorization: req.headers.authorization,
        body: req,
      })
      .then((response) => {
        logResponse({
          method,
          path,
          status: response.status,
          durationMs: Date.now() - started,
          meta: response.accessMeta,
          logger,
          env,
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        logger.error(`request failed: ${message}`);
        logResponse({
          method,
          path,
          status: 500,
          durationMs: Date.now() - started,
          meta: { error_type: 'api_error' },
          logger,
          env,
        });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ error: { message: 'Internal server error', type: 'api_error' } }),
          );
        }
      });
  });
  server.listen(endpoint.port, endpoint.host, () => {
    writeBootstrapLine(`listening on http://${endpoint.host}:${endpoint.port}`, env);
  });
}

const entrypoint = process.argv[1] ?? '';
if (entrypoint !== '' && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    start();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    createLogger(resolveLogLevel(undefined, process.env), process.env).error(message);
    process.exitCode = 1;
  }
}
