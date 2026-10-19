# TypeScript Vertex AI proxy

The implementation is in `packages/proxy` and uses Node.js 22+ with `google-auth-library` and native `fetch`. No Python runtime is required.

## Setup

```bash
pnpm install
pnpm --filter @vertexai-proxy/server build
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT="<your-project-id>"
export VERTEX_LOCATION="global"
pnpm --filter @vertexai-proxy/server start
```

On startup the proxy generates a random API key and prints it once to stderr:

```text
vertexai-proxy API key: <generated-key>
```

Copy that key and send it as `Authorization: Bearer <generated-key>`. The key is regenerated every time the process starts, so restarting the proxy invalidates the old key.

## Configuration

Flags override environment variables.

| Option                                  | Environment                   | Default        |
| --------------------------------------- | ----------------------------- | -------------- |
| `--project <id>`                        | `GOOGLE_CLOUD_PROJECT`        | required       |
| `--location <region>`                   | `VERTEX_LOCATION`             | `global`       |
| `--models <ids>`                        | `VERTEX_MODELS`               | predefined map |
| `--impersonate-service-account <email>` | `IMPERSONATE_SERVICE_ACCOUNT` | none           |
| `-h, --help`                            |                               |                |

`--models` accepts the same comma-separated syntax as `VERTEX_MODELS` and restricts the available set. `PROXY_PORT` sets the listen port and has no flag.

For optional service account impersonation, keep plain ADC and pass the target service account:

```bash
pnpm --filter @vertexai-proxy/server start -- \
  --project "<your-project-id>" \
  --impersonate-service-account "<sa>@<your-project-id>.iam.gserviceaccount.com"
```

The proxy uses the plain ADC client as the source and google-auth-library `Impersonated` for the target. The caller needs `roles/iam.serviceAccountTokenCreator` on the target service account. The service account needs Vertex AI inference permissions.

Use `http://127.0.0.1:8765/v1` as the OpenAI-compatible base URL and the printed key as the bearer token.

## Models

The proxy ships with a predefined model map. Each entry maps an OpenAI-style model id to a Vertex AI provider and model id.

| Alias                    | Provider | Vertex model             |
| ------------------------ | -------- | ------------------------ |
| `gemini-4-argon`         | `gemini` | `gemini-4-argon`         |
| `gemini-3.8-flash`       | `gemini` | `gemini-3.8-flash`       |
| `gemini-3.7-flash`       | `gemini` | `gemini-3.7-flash`       |
| `gemini-3.1-pro-preview` | `gemini` | `gemini-3.1-pro-preview` |
| `gemini-2.5-pro`         | `gemini` | `gemini-2.5-pro`         |
| `gemini-2.5-flash`       | `gemini` | `gemini-2.5-flash`       |
| `claude-opus-5-5`        | `claude` | `claude-opus-5-5`        |
| `claude-sonnet-5-5`      | `claude` | `claude-sonnet-5-5`      |
| `claude-haiku-5-5`       | `claude` | `claude-haiku-5-5`       |
| `claude-fable-5-1`       | `claude` | `claude-fable-5-1`       |
| `claude-opus-4-8`        | `claude` | `claude-opus-4-8`        |
| `claude-sonnet-4-6`      | `claude` | `claude-sonnet-4-6`      |

Gemini models use the `google` publisher and `:generateContent`. Claude models use the `anthropic` publisher, `:rawPredict`, and `anthropic_version` `vertex-2023-10-16`.

Sources: [Gemini model catalog](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/google-models), [Gemini 4 Argon](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon), [Gemini 3.8 Flash](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash), [Claude on Vertex AI](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude), and [Vertex AI locations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations).

Set `VERTEX_MODELS` to override the available set. The value is a comma-separated list of entries:

- A bare id selects an entry from the default map, for example `gemini-3.8-flash`.
- `alias=provider/model` defines or overrides an alias, for example `fast=gemini/gemini-3.7-flash`.
- `provider` must be `gemini` or `claude`.

```bash
export VERTEX_MODELS='gemini-3.8-flash,claude-sonnet-5-5,fast=gemini/gemini-3.7-flash'
```

If `VERTEX_MODELS` is unset or empty, the default map is used. Invalid input fails startup with a clear error and a non-zero exit code. An unknown model in a request returns HTTP 404 with an OpenAI-style `model_not_found` error. There is no fallback model.

## Run with Gemini 3.8 Flash

For `gemini-3.8-flash`, use the global location.

```bash
export GOOGLE_CLOUD_PROJECT="<your-project-id>"
export VERTEX_LOCATION="global"
export VERTEX_MODELS="gemini-3.8-flash"
pnpm --filter @vertexai-proxy/server start
```

Copy the printed key, then call the proxy:

```bash
export VERTEX_PROXY_KEY="<printed-key>"
curl -sS http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer ${VERTEX_PROXY_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"Hello"}]}'
```

The global endpoint is `https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global`. Regional locations such as `us-central1` use `https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1`.

## End-to-end test

Prerequisites:

- ADC is configured with `gcloud auth application-default login`.
- The model is enabled in Model Garden for your project. Claude models must be enabled separately.

```bash
GOOGLE_CLOUD_PROJECT="<your-project-id>" pnpm e2e
E2E_MODELS=gemini-3.8-flash,claude-sonnet-5-5 GOOGLE_CLOUD_PROJECT="<your-project-id>" pnpm e2e
```

Defaults are `VERTEX_LOCATION=global`, `PROXY_PORT=8765`, and `E2E_MODELS=gemini-3.8-flash`. `E2E_MODELS` replaces the proxy's model map and accepts the same `VERTEX_MODELS` syntax. The script requires `lsof` and a free `PROXY_PORT`; a busy port exits 3. It builds the proxy, starts it from `dist`, captures the printed key from a private temporary log, and checks `/healthz`, authenticated and unauthenticated `/v1/models`, and one chat completion per model. ADC or model-access errors appear as chat failures. It stops the proxy on exit. It does not run in CI.

## Endpoints

- `GET /healthz` returns `{"status":"ok"}` without authentication.
- `GET /v1/models` lists the configured aliases.
- `POST /v1/chat/completions` accepts text-only, non-streaming OpenAI chat requests.

## Scope and limitations

This is a **text-only, non-streaming** initial implementation. It does **not** support tool calling, streaming, multimodal inputs, or the Responses API. These are essential for many coding agents and must be added before claiming broad compatibility. Cursor may not be able to reach a local proxy if it routes BYOK requests through remote infrastructure.

Security defaults: localhost binding, a random bearer key printed at startup, an explicit model allowlist, a 1 MiB request body limit, an upstream timeout, and ADC (no downloaded service-account key). Real Vertex AI and agent integration tests remain outstanding. The Cursor CLI cannot use this proxy today. See [`docs/cursor-cli.md`](cursor-cli.md) for the evidence and alternatives. The desktop Cursor IDE path is documented in [`docs/cursor-ide.md`](cursor-ide.md).
