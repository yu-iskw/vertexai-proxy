# TypeScript Vertex AI proxy

The implementation is in `packages/proxy` and uses Node.js 22+ with `google-auth-library` and native `fetch`. No Python runtime is required.

## Setup

```bash
pnpm install
pnpm --filter @vertexai-proxy/server build
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT="your-project"
export VERTEX_LOCATION="us-east5"
pnpm --filter @vertexai-proxy/server start
```

On startup the proxy generates a random API key and prints it once to stderr:

```text
vertexai-proxy API key: <generated-key>
```

Copy that key and send it as `Authorization: Bearer <generated-key>`. The key is regenerated every time the process starts, so restarting the proxy invalidates the old key.

For **optional keyless service account impersonation**, replace the ADC login with:

```bash
gcloud auth application-default login --impersonate-service-account=vertex-proxy@your-project.iam.gserviceaccount.com
```

The caller needs `roles/iam.serviceAccountTokenCreator` on the target service account; the service account needs Vertex AI inference permissions in the inference project. Ensure relevant APIs and model access are enabled.

Use `http://127.0.0.1:8765/v1` as the OpenAI-compatible base URL and the printed key as the bearer token.

## Models

The proxy ships with a predefined model map. Each entry maps an OpenAI-style model id to a Vertex AI provider and model id.

| Alias              | Provider | Vertex model                |
| ------------------ | -------- | --------------------------- |
| `gemini-2.5-pro`   | `gemini` | `gemini-2.5-pro`            |
| `gemini-2.5-flash` | `gemini` | `gemini-2.5-flash`          |
| `gemini-2.0-flash` | `gemini` | `gemini-2.0-flash`          |
| `claude-sonnet-4`  | `claude` | `claude-sonnet-4@20250514`  |
| `claude-3-5-haiku` | `claude` | `claude-3-5-haiku@20241022` |

Set `VERTEX_MODELS` to override the available set. The value is a comma-separated list of entries:

- A bare id selects an entry from the default map, for example `gemini-2.5-pro`.
- `alias=provider/model` defines or overrides an alias, for example `fast=gemini/gemini-2.0-flash`.
- `provider` must be `gemini` or `claude`.

```bash
export VERTEX_MODELS='gemini-2.5-pro,claude-sonnet-4,fast=gemini/gemini-2.0-flash'
```

If `VERTEX_MODELS` is unset or empty, the default map is used. Invalid input fails startup with a clear error and a non-zero exit code. An unknown model in a request returns HTTP 404 with an OpenAI-style `model_not_found` error. There is no fallback model.

## Endpoints

- `GET /healthz` returns `{"status":"ok"}` without authentication.
- `GET /v1/models` lists the configured aliases.
- `POST /v1/chat/completions` accepts text-only, non-streaming OpenAI chat requests.

## Scope and limitations

This is a **text-only, non-streaming** initial implementation. It does **not** support tool calling, streaming, multimodal inputs, or the Responses API. These are essential for many coding agents and must be added before claiming broad compatibility. Cursor may not be able to reach a local proxy if it routes BYOK requests through remote infrastructure.

Security defaults: localhost binding, a random bearer key printed at startup, an explicit model allowlist, a 1 MiB request body limit, an upstream timeout, and ADC (no downloaded service-account key). Real Vertex AI and agent integration tests remain outstanding.
