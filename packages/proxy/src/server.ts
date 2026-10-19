import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { GoogleAuth } from 'google-auth-library';

import { announceApiKey, generateApiKey } from './api-key.js';
import { createApp } from './app.js';
import { resolveModels } from './models.js';

const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,62}$/;
const REGION_PATTERN = /^[a-z]+-[a-z]+[0-9]+$/;
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export function start(): void {
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? '';
  if (!PROJECT_PATTERN.test(project)) {
    throw new Error('Configure GOOGLE_CLOUD_PROJECT with a valid Google Cloud project id.');
  }
  const location = process.env.VERTEX_LOCATION ?? 'us-central1';
  if (!REGION_PATTERN.test(location)) {
    throw new Error('VERTEX_LOCATION must look like us-central1.');
  }
  const port = Number(process.env.PROXY_PORT ?? '8765');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PROXY_PORT must be an integer between 1 and 65535.');
  }
  const models = resolveModels(process.env.VERTEX_MODELS);
  const apiKey = generateApiKey();
  announceApiKey(apiKey);

  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  const getAccessToken = async (): Promise<string> => {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (token.token === null || token.token === undefined) {
      throw new Error('ADC access token unavailable');
    }
    return token.token;
  };
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
