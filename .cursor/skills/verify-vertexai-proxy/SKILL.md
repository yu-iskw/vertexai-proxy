---
name: verify-vertexai-proxy
description: Launch the OpenAI-compatible Vertex AI proxy on an isolated port, drive HTTP health/models/chat checks with curl, and capture evidence. Use when verifying proxy behavior, access logs, or Vertex routing after code changes.
---

# Verify vertexai-proxy

Primary surface is a **local HTTP API** on `127.0.0.1` (default dev port `8765`; this harness uses **`18765`** to avoid clobbering a developer instance). Drive it with **`curl`** and the repo script `scripts/verify.sh`. Unit tests (`pnpm test`) do not replace a live listen + ADC chat check.

## Launch

From the repository root:

```bash
export RUN_ID="my-run-$$"
export GOOGLE_CLOUD_PROJECT="<your-gcp-project>"   # required for chat proof
export VERTEX_LOCATION="global"
bash .cursor/skills/verify-vertexai-proxy/scripts/verify.sh launch
```

Ready when stdout prints `Ready: http://127.0.0.1:18765` and `packages/proxy/dist/server.js` is listening on **`PROXY_VERIFY_PORT`** (default `18765`).

State for this run lives under `/tmp/vertexai-proxy-verify-$RUN_ID/state/` (PID file, log, API key file, `proxy-state.json`). Evidence is written under `/tmp/vertexai-proxy-verify-$RUN_ID/evidence/` and **is not deleted** by cleanup.

Do not use port `8765` for verification if you already run a personal proxy there. Set `PROXY_VERIFY_PORT` to another free port when needed.

## Doctor

```bash
export RUN_ID="my-run-$$"
bash .cursor/skills/verify-vertexai-proxy/scripts/verify.sh doctor
```

Expect `PASS build`, `PASS port` (free or owned by this run's PID file), and `PASS adc` when chat checks will run. `WARN` for missing `GOOGLE_CLOUD_PROJECT` or ADC means chat will skip.

## Drive

```bash
export RUN_ID="my-run-$$"
export GOOGLE_CLOUD_PROJECT="<your-gcp-project>"
export VERIFY_MODEL="gemini-3.8-flash"
bash .cursor/skills/verify-vertexai-proxy/scripts/verify.sh drive
```

Exercises:

- `GET /healthz` → HTTP 200
- `GET /v1/models` without auth → HTTP 401
- `GET /v1/models` with bearer key → HTTP 200 and `owned_by":"vertex-ai"`
- Access log line for models includes `vertex_project=` and `model_count=`
- When ADC and project are set: `POST /v1/chat/completions` → HTTP 200, non-empty assistant content, access log includes `vertex_upstream_status=200`

Feature recipes and user POV paths live in [`features/README.md`](features/README.md).

## Evidence

Artifacts land in `/tmp/vertexai-proxy-verify-$RUN_ID/evidence/`:

| File                | Proof                                           |
| ------------------- | ----------------------------------------------- |
| `healthz.txt`       | Public health response + HTTP code trailer      |
| `models-unauth.txt` | 401 without bearer                              |
| `models-auth.txt`   | Model list body + 200                           |
| `access-models.log` | Last models response access line from proxy log |
| `chat.txt`          | Live Vertex completion (when not skipped)       |
| `access-chat.log`   | `vertex_upstream_status=200` line               |
| `run.json`          | Run metadata (port, project, paths)             |
| `chat-skipped.txt`  | Present when chat was skipped                   |

Proof standards: use the same HTTP paths clients use (`/v1/...`), not internal modules. Assert HTTP status, JSON shape, and access-log metadata together for chat.

## Cleanup

```bash
export RUN_ID="my-run-$$"
bash .cursor/skills/verify-vertexai-proxy/scripts/verify.sh cleanup
```

Stops only the PID recorded in this run's state dir and removes `state/`. **Does not remove `evidence/`.** Never `pkill node`.

Full loop:

```bash
export RUN_ID="my-run-$$"
export GOOGLE_CLOUD_PROJECT="<your-gcp-project>"
bash .cursor/skills/verify-vertexai-proxy/scripts/verify.sh all
```

## Helpers

```bash
bash .cursor/skills/verify-vertexai-proxy/scripts/verify.sh --help
```

Commands: `doctor`, `launch`, `drive`, `cleanup`, `all`.

Existing repo e2e (heavier, default port from `PROXY_PORT`):

```bash
GOOGLE_CLOUD_PROJECT="<your-gcp-project>" pnpm e2e
```

## Isolation

Each `RUN_ID` gets its own port (default `18765`), state dir, and evidence dir. Two verify runs in parallel must use different `RUN_ID` and `PROXY_VERIFY_PORT` values. The harness refuses to launch if the port is held by a foreign process.

## Not in scope

`cursor agent` does not call this proxy ([`docs/cursor-cli.md`](../../../docs/cursor-cli.md)). Do not use Agent CLI output as proof of proxy behavior.

## Maintenance

Use `/maintain-verification-skill` when routes, env vars, or access-log fields change.
