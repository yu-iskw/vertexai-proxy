# vertexai-proxy

An OpenAI-compatible, text-only proxy to Vertex AI for Gemini and Claude.

It exposes `GET /healthz`, `GET /v1/models`, and `POST /v1/chat/completions`. It binds to `127.0.0.1` and authenticates every `/v1` request with a random bearer key generated at startup.

## Quick start

Prerequisites:

- Node.js 22+ and pnpm 11 (for example via `corepack enable`).
- The `gcloud` CLI, for ADC. Run `gcloud auth application-default login`.
- `lsof`, required by `pnpm e2e`.
- The model must be enabled in Model Garden for that project. Claude models need separate enablement.

```bash
pnpm install
pnpm build
export GOOGLE_CLOUD_PROJECT="<your-project-id>"
export VERTEX_LOCATION="global"
pnpm --filter @vertexai-proxy/server start
```

The server prints its key once to stderr:

```text
vertexai-proxy API key: <generated-key>
```

Send the key as `Authorization: Bearer <generated-key>`. The key is regenerated on every start.

```bash
curl -sS http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer <generated-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"Hello"}]}'
```

OpenAI clients use base URL `http://127.0.0.1:8765/v1` and the printed key.

`PROXY_PORT` defaults to `8765`. `VERTEX_LOCATION` defaults to `global`. Regional locations such as `us-central1` are accepted, but model availability varies by region. For `gemini-3.8-flash`, use `global`. See [`docs/typescript-proxy.md`](docs/typescript-proxy.md).

## Configuration

Flags override environment variables:

- `--project <id>` or `GOOGLE_CLOUD_PROJECT`
- `--location <region>` or `VERTEX_LOCATION`, default `global`
- `--models <ids>` or `VERTEX_MODELS`, restricting the predefined map
- `--impersonate-service-account <email>` or `IMPERSONATE_SERVICE_ACCOUNT`
- `-h, --help`

For service account impersonation, keep plain ADC and pass `--impersonate-service-account "<sa>@<your-project-id>.iam.gserviceaccount.com"`. The caller needs `roles/iam.serviceAccountTokenCreator` on the target service account.

## Models

The proxy ships with a predefined Gemini and Claude model map. See [`docs/typescript-proxy.md`](docs/typescript-proxy.md) for the full list.

`VERTEX_MODELS` overrides the available set:

```bash
export VERTEX_MODELS='gemini-3.8-flash,fast=gemini/gemini-3.7-flash'
```

Entries are bare aliases from the default map or `alias=provider/model` entries, where `provider` is `gemini` or `claude`. Unknown models return HTTP 404.

## End-to-end test

```bash
GOOGLE_CLOUD_PROJECT="<your-project-id>" pnpm e2e
E2E_MODELS=gemini-3.8-flash,claude-sonnet-5-5 GOOGLE_CLOUD_PROJECT="<your-project-id>" pnpm e2e
```

`pnpm e2e` requires ADC, model access, `lsof`, and a free `PROXY_PORT`. `E2E_MODELS` replaces the model map and defaults to `gemini-3.8-flash`. The script builds the proxy, starts it from `dist`, checks `/healthz`, authenticated and unauthenticated `/v1/models`, and one chat completion per model, then stops the proxy. See [`docs/typescript-proxy.md`](docs/typescript-proxy.md).

## Cursor

- [Cursor IDE](docs/cursor-ide.md) is documented for a public HTTPS URL. The proxy binds `127.0.0.1`, so a tunnel or reverse proxy is required. This path is not verified end-to-end; use neutral aliases such as `vx-sonnet-5-5`.
- [Cursor CLI](docs/cursor-cli.md) cannot use this proxy today.

## Limitations

The proxy is text-only. It has no SSE streaming and no tool calling, and it rejects `stream: true` with HTTP 400. The request body limit is 1 MiB. Live Vertex integration tests are not part of CI. Use `pnpm e2e` with a real project.

## Development

```bash
pnpm lint
pnpm test
pnpm knip
```

Linting and formatting use Trunk. Dependency installs use the pnpm 11 supply-chain settings in [`pnpm-workspace.yaml`](pnpm-workspace.yaml), including a 7-day minimum release age, exotic subdependency blocking, and a build-script allowlist. CI runs build, tests, Trunk, CodeQL, and SBOM checks.

## Project structure

- `packages/proxy`: OpenAI-compatible Vertex AI proxy.
- `dev/e2e.sh`: live Vertex end-to-end script.
- `dev/codeql.sh`: local CodeQL helper.
- `docs/`: proxy, Cursor IDE, and Cursor CLI guides.

## License

Apache-2.0. See [LICENSE](LICENSE).
