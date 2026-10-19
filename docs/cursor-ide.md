# Cursor IDE setup with this proxy

This page is a step-by-step guide for the desktop Cursor IDE. It does not apply to the Cursor CLI, Cloud or Background Agents, Automations, Tab, Auto, or the API/SDK (D).

Sources are cited inline and listed at the end.

## Before you start

- Cursor routes these requests through its servers, so `127.0.0.1` is not reachable (A). The proxy currently binds `127.0.0.1` only, so you need a public HTTPS tunnel or reverse proxy.
- ADC must be configured for the proxy, and the target model must be enabled in Model Garden. Claude models must be enabled separately.
- Use a dedicated low-privilege project and service account for the proxy. Prompts transit Cursor's backend (A).

## Step 1: Start the proxy

Use aliases with a neutral prefix. A third-party source reports that Cursor never sends model names starting with `claude-` through the base URL override, and that names resembling Cursor's own models may be treated as Cursor models (E).

```bash
pnpm install
pnpm --filter @vertexai-proxy/server build
export GOOGLE_CLOUD_PROJECT="<your-project-id>"
export VERTEX_LOCATION="global"
export VERTEX_MODELS='vx-gemini-3.8-flash=gemini/gemini-3.8-flash,vx-sonnet-5-5=claude/claude-sonnet-5-5'
pnpm --filter @vertexai-proxy/server start
```

The proxy prints its API key once at startup (stderr and `PROXY_LOG_FILE` when set). Set `PROXY_API_KEY` for a fixed key or `PROXY_STATE_FILE` to persist a generated key across restarts. Without either, a new key is generated each start. The key is mandatory for every `/v1` request.

The proxy also accepts `--project`, `--location`, `--models`, and `--impersonate-service-account`; flags override environment variables. For impersonation, keep plain ADC and pass `--impersonate-service-account "<sa>@<your-project-id>.iam.gserviceaccount.com"`. The caller needs `roles/iam.serviceAccountTokenCreator` on the target service account.

The alias format accepts dots and hyphens, so `vx-gemini-3.8-flash` and `vx-sonnet-5-5` are valid.

## Step 2: Expose the proxy on public HTTPS

Cursor reaches the proxy from its own servers. Expose the local proxy at a public HTTPS URL. The OpenAI-compatible base URL is then `https://<your-public-host>/v1` (A).

### ngrok (local dev)

With the proxy on `127.0.0.1:8765`:

```bash
ngrok http 8765
```

Public URL from the ngrok dashboard (`http://127.0.0.1:4040`) or:

```bash
curl -sS http://127.0.0.1:4040/api/tunnels | rtk json /dev/stdin
```

Use **Override OpenAI Base URL** = `https://<subdomain>.ngrok-free.app/v1` (include `/v1`).

Sanity check:

```bash
curl -sS -H 'ngrok-skip-browser-warning: 1' \
  -H "Authorization: Bearer <PROXY_API_KEY>" \
  "https://<subdomain>.ngrok-free.app/v1/models"
```

Free ngrok URLs change when you restart `ngrok` unless you use a reserved domain.

## Step 3: Configure Cursor

1. Open Cursor Settings > Models (A, B).
2. Find the OpenAI provider, paste the proxy's startup key into the API key field, and save (A).
3. Scroll to the bottom of Models and expand API Keys (B).
4. If your Cursor version shows the API Keys section, paste the key under OpenAI API Key and turn on "Use OpenAI API Key" (B).
5. Turn on "Override OpenAI Base URL" and enter `https://<your-public-host>/v1` (B).

## Step 4: Add the proxy models

Add custom model names that exactly match the proxy's `/v1/models` IDs, for example `vx-gemini-3.8-flash` and `vx-sonnet-5-5` (B).

## Step 5: Restart and test

1. Restart Cursor.
2. Open a new chat.
3. Select your custom model (for example `vx-haiku-5-5`).
4. Send a short prompt.

## Step 6: Confirm traffic hits the proxy (logging)

Access lines are **not** a separate file format. They are `info` log lines on **stderr** and, when set, appended to **`PROXY_LOG_FILE`**.

Start the proxy with:

```bash
export PROXY_ACCESS_LOG=1
export PROXY_LOG_FILE=/tmp/vertexai-proxy.log
export PROXY_LOG_LEVEL=info
```

In another terminal:

```bash
rtk grep 'chat/completions' /tmp/vertexai-proxy.log
# or live:
tail -f /tmp/vertexai-proxy.log
```

After one IDE message you should see pairs like:

```text
vertexai-proxy request POST /v1/chat/completions
vertexai-proxy response POST /v1/chat/completions 200 … model=vx-haiku-5-5 vertex_upstream_status=200 …
```

**If chat works in the IDE but the log file does not grow:**

1. **Proxy not running** on the machine the tunnel forwards to (`lsof -i :8765` or `curl -sS http://127.0.0.1:8765/healthz`).
2. **Wrong log sink** — you are watching a terminal where the proxy is not running; use `PROXY_LOG_FILE` or the stderr of the `node dist/server.js` process.
3. **`PROXY_ACCESS_LOG=0`** — HTTP lines are suppressed.
4. **Override URL points elsewhere** — tunnel hostname must forward to this host’s `8765`, with base URL `https://<host>/v1`.
5. **Custom model name not on the proxy** — `GET /v1/models` from the public URL must list your ID (for example `vx-haiku-5-5`). If the list has only `claude-haiku-5-5` and never `vx-haiku-5-5`, restart the proxy with `VERTEX_MODELS` (Step 1) before trusting the IDE picker. A reply in chat does **not** prove Vertex traffic; only new `POST /v1/chat/completions` lines do.

**Quick proof the override reaches this process:** stop the proxy and send another IDE message. If chat still succeeds, traffic is **not** going through your proxy.

## Known limitations

- Cursor describes the OpenAI provider as standard, non-reasoning chat models (A).
- Custom API keys only work with chat models. Tab completion continues to use Cursor's built-in models (A).
- Cursor sends the key to its backend with every request because all requests are routed through Cursor's servers for final prompt building (A).
- Zero Data Retention does not apply when you use your own keys (A).
- The override key and base URL apply to all models, including Cursor's own models such as Composer 2. Toggle the override off before using built-in models (C).
- The proxy is text-only. Chat `stream: true` is buffered into minimal OpenAI-style SSE. There is no incremental token streaming from Vertex and no tool calling.

## Sources

- A. Official Cursor docs, API keys: <https://cursor.com/docs/settings/api-keys>
- B. Cursor staff forum post on custom model settings: <https://forum.cursor.com/t/how-to-adjust-settings-for-custom-added-models/173253/21>
- C. Cursor staff forum post on the override affecting native models: <https://forum.cursor.com/t/does-adding-a-custom-model-override-cursor-s-native-models/157521>
- D. OpenAI Help Center, using OpenAI models in Cursor: <https://help.openai.com/en/articles/20001506-using-openai-models-in-cursor>
- E. Third-party Router docs, Cursor coding agents: <https://docs.router.com/coding-agents/cursor>
