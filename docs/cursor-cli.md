# Cursor CLI and this proxy

## Conclusion

The Cursor CLI cannot use this proxy today.

`cursor-agent` and `agent` authenticate with a Cursor account or Cursor API key and speak Cursor's private RPC protocol. They do not expose a custom OpenAI-compatible base URL or a provider API key. Pointing the hidden `--endpoint` option at this proxy is not supported.

## Local findings

The `cursor-agent` and `agent` commands are symlinks to the same binary.

```text
/Users/yu/.local/bin/cursor-agent -> /Users/yu/.local/share/cursor-agent/versions/2026.10.12-d47ca18/cursor-agent
/Users/yu/.local/bin/agent        -> /Users/yu/.local/share/cursor-agent/versions/2026.10.12-d47ca18/cursor-agent
```

Source: `command -v cursor-agent agent` and `ls -l` on those paths.

`cursor-agent --help` lists these relevant global options:

- `--api-key <key>` or `CURSOR_API_KEY`
- `-H, --header <header>` to add a custom header to agent requests
- `-e, --endpoint <url>` or `CURSOR_API_ENDPOINT`, default `https://api2.cursor.sh`
- `--model <model>`
- `--list-models`
- `-p, --print`
- `--output-format text|json|stream-json`

There is no option for an OpenAI-compatible base URL or an OpenAI provider key. Source: local `cursor-agent --help`.

A recursive grep of the installed package found no `OPENAI_BASE_URL`, `openaiBaseUrl`, `OPENAI_API_BASE`, or `OPENAI_API_KEY` strings. The only endpoint override is `CURSOR_API_ENDPOINT` in `index.js`. Source: read-only grep in `/Users/yu/.local/share/cursor-agent/versions/2026.10.12-d47ca18`.

A grep for `chat/completions` and `/v1/responses` found no matches in the installed JavaScript. The bundled CLI instead defines Cursor's own service:

```text
aiserver.v1.AiService ... streamChat ... streamChatWeb ... streamChatTryReallyHard
```

Those methods are server-streaming Cursor RPC methods, not OpenAI HTTP routes. Source: `index.js` in the installed package.

## Installed CLI re-check

`cursor` is the Cursor IDE CLI version 3.25.9. Its `agent` subcommand starts the same agent CLI as `cursor-agent` and `agent`, which report version `2026.10.12-d47ca18`.

`cursor agent --help` and `cursor-agent --help` show the same options. There is no option for a custom OpenAI base URL or provider API key. The only endpoint override is `-e/--endpoint` or `CURSOR_API_ENDPOINT`, which selects Cursor's public API base.

Subcommand help for `models`, `status`, `login`, and `mcp` shows no provider or base URL setting. `bedrock configure` configures AWS Bedrock only.

The key structure of `~/.cursor/cli-config.json` contains no provider, API-key, or OpenAI base-URL setting. `serverConfigCache.backendUrl` and `serverConfigCache.agentUrlConfig.agentUrl` are caches of URLs provided by Cursor servers, not a documented override. Editing those cache values would not make the CLI speak OpenAI chat completions.

Read-only grep counts in the installed bundle:

| Pattern                 | Count | Representative context                                    |
| ----------------------- | ----- | --------------------------------------------------------- |
| `OPENAI_BASE_URL`       | 0     | none                                                      |
| `OPENAI_API_BASE`       | 0     | none                                                      |
| `openaiBaseUrl`         | 0     | none                                                      |
| `overrideOpenAIBaseUrl` | 0     | none                                                      |
| `baseUrl`               | 126   | PDF worker, Cursor bridge, metrics, download, local agent |
| `apiBase`               | 5     | Cursor auth and GitHub API                                |
| `CURSOR_API_URL`        | 4     | Cursor public API base override                           |
| `CURSOR_API_ENDPOINT`   | 9     | Cursor public API base override                           |
| `customModel`           | 10    | account custom model IDs                                  |
| `provider`              | 307   | permissions, config, telemetry, desktop providers         |
| `byok`                  | 5     | server feature flags, not a CLI option                    |

No supported way to point the installed CLI at this OpenAI-compatible proxy on `127.0.0.1` was found. There is no proposed config, env var, or test command.

## External confirmation

The official CLI parameter reference lists Cursor authentication, `--header`, `--model`, `--list-models`, `--print`, and `--output-format`. It does not list a custom OpenAI base URL or provider key.

Source: <https://cursor.com/docs/cli/reference/parameters>

Cursor staff state that the CLI does not support BYOK with your own provider API keys yet and only uses Cursor account authentication.

Source: <https://forum.cursor.com/t/can-i-use-provider-api-keys-with-cursor-cli-agent/149158/3>

OpenAI's Cursor integration article says BYOK and custom OpenAI-compatible base URLs apply only to local Chat and Agent in the Cursor desktop app. They do not apply to the Cursor CLI, Cloud or Background agents, Tab, Auto, or the API/SDK.

Source: <https://help.openai.com/en/articles/20001506-using-openai-models-in-cursor>

LiteLLM documents the hidden `--endpoint` / `CURSOR_API_ENDPOINT` option as a Cursor backend selector. The CLI posts to `/auth/exchange_user_api_key` and then uses Cursor-private RPC. Pointing it at an OpenAI-compatible proxy fails with `The provided API key is invalid`.

Source: <https://docs.litellm.ai/docs/tutorials/cursor_integration>

The Cursor desktop app does have an `Override OpenAI Base URL` setting. Requests still route through Cursor's servers, so a `127.0.0.1` proxy is generally not reachable unless it is exposed at a public HTTPS URL.

Sources: <https://cursor.com/help/models-and-usage/api-keys> and <https://forum.cursor.com/t/how-to-use-a-custom-openai-compatible-api-in-cursor-setup-limits-and-tips/171497>

## What this means

- The Cursor CLI cannot connect to this proxy today.
- The Cursor desktop app override is a separate path. It needs a publicly reachable HTTPS URL, not a localhost address.
- Other OpenAI-compatible CLIs can use this proxy with base URL `http://127.0.0.1:8765/v1` and the key printed at startup.

For the desktop Cursor IDE path, see [`docs/cursor-ide.md`](cursor-ide.md).

## Gemini 3.8 Flash notes

- Model ID: `gemini-3.8-flash`.
- Status: GA, published 2026-09-02.
- Regions: `global`, and multi-region `us` and `eu`. It is not available in regional endpoints such as `us-central1`.
- Global endpoint: `https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/publishers/google/models/gemini-3.8-flash:generateContent`.
- `temperature`, `top_p`, and `top_k` are ignored.
- `frequency_penalty`, `presence_penalty`, and `candidate_count` return errors.
- Thinking levels are `LOW`, `MEDIUM`, and `HIGH`. There is no `MINIMAL`.
- History must not end with a model turn.

Sources: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash> and <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash>
