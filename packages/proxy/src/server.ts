import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { GoogleAuth, Impersonated } from 'google-auth-library';

import { announceApiKey, generateApiKey } from './api-key.js';
import { createApp } from './app.js';
import { resolveModels, type ModelDefinition } from './models.js';

const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,62}$/;
const REGION_PATTERN = /^[a-z]+-[a-z]+[0-9]+$/;
const SERVICE_ACCOUNT_PATTERN = /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/;
export const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const USAGE = `Usage: vertexai-proxy [options]

Options:
  --project <id>                         Google Cloud project ID (env: GOOGLE_CLOUD_PROJECT)
  --location <region>                    Vertex AI location (env: VERTEX_LOCATION, default: global)
  --models <ids>                         Comma-separated model IDs (env: VERTEX_MODELS)
  --impersonate-service-account <email>  Target service account (env: IMPERSONATE_SERVICE_ACCOUNT)
  -h, --help                             Show this help

Environment:
  PROXY_PORT                             Listen port (default: 8765)
`;

type CliOptions = {
  project: string;
  location: string;
  models: ReadonlyMap<string, ModelDefinition>;
  impersonateServiceAccount: string | undefined;
  port: number;
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
  if (location !== 'global' && !REGION_PATTERN.test(location)) {
    throw new Error('VERTEX_LOCATION or --location must be global or look like us-central1.');
  }
  return location;
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const port = Number(env.PROXY_PORT ?? '8765');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PROXY_PORT must be an integer between 1 and 65535.');
  }
  return port;
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
      port: resolvePort(env),
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
  const { project, location, models, impersonateServiceAccount, port } = parsed.options;
  const apiKey = generateApiKey();
  announceApiKey(apiKey);

  const getAccessToken = createGetAccessToken(impersonateServiceAccount);
  const app = createApp({ apiKey, models, project, location, getAccessToken });

  const server = createServer((req, res) => {
    void app
      .handle({
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        authorization: req.headers.authorization,
        body: req,
      })
      .then((response) => {
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        process.stderr.write(`vertexai-proxy request failed: ${message}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ error: { message: 'Internal server error', type: 'api_error' } }),
          );
        }
      });
  });
  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`vertexai-proxy listening on http://127.0.0.1:${port}\n`);
  });
}

const entrypoint = process.argv[1] ?? '';
if (entrypoint !== '' && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    start();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`vertexai-proxy: ${message}\n`);
    process.exitCode = 1;
  }
}
