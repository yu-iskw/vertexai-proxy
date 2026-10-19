# Cursor CLI and this proxy

Entrypoint:

```bash
/opt/homebrew/bin/cursor agent [options] [command] [prompt...]
```

`cursor agent` runs **`~/.local/bin/cursor-agent`**, which talks to **Cursor’s backend** (`https://api2.cursor.sh` by default). It is **not** an OpenAI-compatible client.

This proxy speaks **OpenAI HTTP** (`GET /v1/models`, `POST /v1/chat/completions`) and forwards to **Vertex AI**.

## Two different API keys

| Key                  | Purpose                                                                                            | Used with                               |
| -------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **`CURSOR_API_KEY`** | Cursor account (from [cursor.com/dashboard](https://cursor.com/dashboard) or `cursor agent login`) | `/opt/homebrew/bin/cursor agent`        |
| **`PROXY_API_KEY`**  | Bearer auth for **this** proxy (min 16 chars, set at proxy startup)                                | `curl`, OpenAI SDK, IDE custom base URL |

They are **not interchangeable**. Putting `PROXY_API_KEY` in `--api-key` or `CURSOR_API_KEY` does not route the agent to Vertex through the proxy.

## Why `cursor agent -e http://127.0.0.1:8765` fails

Your command:

```bash
/opt/homebrew/bin/cursor agent -e 'http://127.0.0.1:8765' -p 'hi'
```

fails with **Authentication required** when you are **not logged in** and **`CURSOR_API_KEY` is unset**. The agent still expects a **Cursor** credential before it runs, even if you point `-e` at localhost.

If you pass the **proxy** bearer as `--api-key`, the CLI warns that the key is invalid and may call Cursor-specific paths on the proxy, for example:

```text
POST /auth/exchange_user_api_key → 404
```

`-e` / `CURSOR_API_ENDPOINT` only changes **where Cursor RPC** is sent. It does **not** switch the agent to OpenAI `/v1/chat/completions`. The proxy is not a Cursor API server.

## Goal: Claude Haiku 5.5 on Vertex via `cursor agent`

**Underlying intent:** Run the **terminal agent** (`cursor agent`) with model **`claude-haiku-5-5-medium`** (or equivalent) while **inference and billing go through your Vertex proxy**.

**Stated approach:** `-e http://127.0.0.1:8765` plus proxy env vars.

**XY check:** `-e` solves “talk to localhost” but not “use OpenAI chat against Vertex.” The agent’s model loop is Cursor RPC + Cursor auth, not `PROXY_API_KEY` + `/v1/chat/completions`.

### What works today (Vertex Haiku through the proxy)

Proxy model id: **`claude-haiku-5-5`** (see `GET /v1/models`).

```bash
export PROXY_API_KEY='<your-proxy-bearer-key>'

curl -sS http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-haiku-5-5",
    "messages": [{"role": "user", "content": "Say hi in one word"}]
  }'
```

With access logging:

```bash
export PROXY_LOG_FILE=/tmp/vertexai-proxy.log
export PROXY_ACCESS_LOG=1
```

Expect `POST /v1/chat/completions` with `vertex_upstream_status=200` and `model=claude-haiku-5-5`.

### What `cursor agent` does today (measured)

| Setup                                                | Proxy chat logs?                        | Vertex Haiku?             |
| ---------------------------------------------------- | --------------------------------------- | ------------------------- |
| Default `cursor agent` after `cursor agent login`    | No                                      | No (Cursor-hosted models) |
| `OPENAI_*` / `CURSOR_LOCAL_AGENT_*` + `cursor agent` | No (0 log lines)                        | No                        |
| `-e http://127.0.0.1:8765` without `CURSOR_API_KEY`  | No (auth error first)                   | No                        |
| `-e` + `CURSOR_API_KEY` + proxy as endpoint          | Cursor RPC on proxy (404/401), not chat | No                        |

**Conclusion:** Stock **`/opt/homebrew/bin/cursor agent` cannot today satisfy “agent UX + Vertex Haiku via this proxy.”** That requires Cursor to support a custom OpenAI-compatible base URL for the CLI agent (or a supported local-openai mode). See forum thread on provider keys and CLI.

### Closest terminal workaround (not `cursor agent`)

Cursor ships a separate **agent-cli-local** product (hidden `--authless`, `CURSOR_LOCAL_AGENT_BASE_URL`). It is **not** invoked by `/opt/homebrew/bin/cursor agent` (`--authless` errors: _only for agent-cli-local_). We do not ship install scripts for it in this repo; use HTTP/`curl` or the IDE path below for supported workflows.

### IDE path (OpenAI-compatible, not CLI)

For editor chat with a custom base URL, see [cursor-ide.md](cursor-ide.md) (public HTTPS tunnel usually required). That is separate from `cursor agent`.

## Running `cursor agent` normally (Cursor cloud, not this proxy)

```bash
/opt/homebrew/bin/cursor agent login
# or: export CURSOR_API_KEY='<cursor-dashboard-key>'

/opt/homebrew/bin/cursor agent -p --model claude-haiku-5-5-medium "your prompt"
```

This uses **Cursor’s** backend and subscription. It does **not** use `PROXY_API_KEY` or Vertex.

## Summary

| Surface                                      | Vertex Haiku via this proxy?          |
| -------------------------------------------- | ------------------------------------- |
| `curl` / OpenAI SDK → `/v1/chat/completions` | **Yes** (`claude-haiku-5-5`)          |
| `/opt/homebrew/bin/cursor agent`             | **No** (by design today)              |
| `-e` pointed at proxy                        | **No** (wrong protocol + Cursor auth) |

## References

- Cursor CLI parameters: <https://cursor.com/docs/cli/reference/parameters>
- Forum (no BYOK on CLI): <https://forum.cursor.com/t/can-i-use-provider-api-keys-with-cursor-cli-agent/149158/3>
- OpenAI in Cursor (IDE vs CLI): <https://help.openai.com/en/articles/20001506-using-openai-models-in-cursor>
