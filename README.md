# vertexai-proxy

An OpenAI-compatible, text-only proxy to Vertex AI for Gemini and Claude.

It exposes `GET /healthz`, `GET /v1/models`, and `POST /v1/chat/completions`. It binds to `127.0.0.1` unless `PROXY_HOST` is `0.0.0.0`, and authenticates every `/v1` request with a bearer key.

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

A generated key is printed once to stderr. A key loaded from `PROXY_STATE_FILE` is printed the same way.

```text
vertexai-proxy API key: <generated-key>
```

A key loaded from `PROXY_API_KEY` is not printed. Send the key as `Authorization: Bearer <generated-key>`.

By default the key is random on every start. Set `PROXY_API_KEY` to a fixed secret (at least 16 characters) for a stable key you choose. Set `PROXY_STATE_FILE` (for example `/tmp/vertexai-proxy.json`) to persist a generated key across restarts. The file is written with mode `0600` and contains only `apiKey` and `createdAt`. `PROXY_API_KEY` wins when both are set. Treat the state file like a credential on shared machines.

```bash
curl -sS http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer <generated-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"Hello"}]}'
```

OpenAI clients use base URL `http://127.0.0.1:8765/v1` and the printed key.

Unset `PROXY_HOST` listens on `127.0.0.1`. `PROXY_PORT` defaults to `8765`. `PORT` is used only when `PROXY_HOST` is set and `PROXY_PORT` is unset. `VERTEX_LOCATION` defaults to `global`. `PROXY_LOG_LEVEL` (or `--log-level`) is `error`, `warn`, `info`, or `debug` (default `info`). At `info`, each HTTP call logs a `request` and `response` line with status, duration, and response metadata. List models responses include `vertex_project`, `vertex_location`, `model_count`, and a comma-separated `models` list. Chat completions include `vertex_provider`, `vertex_model`, `vertex_upstream_status`, token counts, and `finish_reason`. Set `PROXY_ACCESS_LOG=0` to suppress those HTTP lines while keeping other `info` messages. At `debug`, upstream Vertex URLs are logged. Set `PROXY_LOG_FILE` (for example `/tmp/vertexai-proxy.log`) to append all emitted log lines to a file (including a generated or state-file API key line when one is printed; treat the file as a credential on shared hosts). It accepts `global`, `us`, `eu`, or a regional location such as `us-central1`. Model availability varies by region. For `gemini-3.8-flash`, use `global` or the `us`/`eu` multi-region. See [`docs/typescript-proxy.md`](docs/typescript-proxy.md).

## Configuration

Flags override environment variables:

- `--project <id>` or `GOOGLE_CLOUD_PROJECT`
- `--location <region>` or `VERTEX_LOCATION`, default `global`
- `--models <ids>` or `VERTEX_MODELS`, restricting the predefined map
- `--impersonate-service-account <email>` or `IMPERSONATE_SERVICE_ACCOUNT`
- `-h, --help`

Listen settings have no flags.

- `PROXY_HOST` is `127.0.0.1` or `0.0.0.0` (default `127.0.0.1`)
- `PROXY_PORT` sets the listen port (default `8765`)
- `PORT` is used only when `PROXY_HOST` is set and `PROXY_PORT` is unset

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

- [Cursor IDE](docs/cursor-ide.md) is documented for a public HTTPS URL. The default bind is `127.0.0.1`, so a tunnel is required for a local process. [Host the proxy on Cloud Run](docs/cloud-run.md) is the HTTPS path in this repo. The IDE path is not verified end-to-end. Use neutral aliases such as `vx-sonnet-5-5`.
- [Cursor CLI](docs/cursor-cli.md): `/opt/homebrew/bin/cursor agent` uses Cursor auth and RPC, not this proxy. Vertex Haiku: `curl`/`OpenAI SDK` with model `claude-haiku-5-5` and `PROXY_API_KEY`.

## Limitations

The proxy is text-only. Chat `stream: true` is buffered into a minimal OpenAI-style SSE response (one content chunk, then finish). There is no incremental token streaming from Vertex and no tool calling. A function call is reported as `finish_reason: tool_calls`, but no tool-call payload is forwarded. The request body limit is 1 MiB. Live Vertex integration tests are not part of CI. Use `pnpm e2e` with a real project.

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
- `docs/`: proxy, Cloud Run, Cursor IDE, and Cursor CLI guides.
- `infra/`: Cloud Run Terraform. See [`docs/cloud-run.md`](docs/cloud-run.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
