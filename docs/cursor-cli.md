# Cursor CLI setup attempt

## Outcome

The Cursor CLI cannot use this proxy today.

The CLI authenticates with a Cursor account or Cursor API key and speaks Cursor's private RPC protocol. It has no custom OpenAI-compatible base URL and no provider API key. This page is a step-by-step verification guide so you can confirm that on your machine. It is not a working setup guide.

## Before you start

- `cursor-agent` and `agent` are the terminal agent CLI. `cursor` is the Cursor IDE CLI, and `cursor agent` starts the same terminal agent.
- The proxy exposes OpenAI-compatible HTTP routes. The CLI does not use those routes.
- For the desktop Cursor IDE path, see [`docs/cursor-ide.md`](cursor-ide.md).

## Step 1: Check the installed CLI

```bash
command -v cursor cursor-agent agent
cursor --version
cursor-agent --version
cursor agent --help
cursor-agent --help
```

The help shows `--api-key` or `CURSOR_API_KEY`, `-H/--header`, `-e/--endpoint` or `CURSOR_API_ENDPOINT`, `--model`, `--list-models`, `-p/--print`, and `--output-format`.

There is no option for a custom OpenAI base URL or an OpenAI provider key. Source: local `cursor-agent --help` and `cursor agent --help`.

## Step 2: Check the only endpoint override

`-e/--endpoint` and `CURSOR_API_ENDPOINT` select Cursor's public API base. They do not select an OpenAI-compatible API.

Cursor staff state that the CLI does not support BYOK with your own provider API keys yet and only uses Cursor account authentication. Source: <https://forum.cursor.com/t/can-i-use-provider-api-keys-with-cursor-cli-agent/149158/3>

LiteLLM documents that the CLI posts to `/auth/exchange_user_api_key` and then uses Cursor-private RPC. Pointing it at an OpenAI-compatible proxy fails with `The provided API key is invalid`. Source: <https://docs.litellm.ai/docs/tutorials/cursor_integration>

Do not point this proxy at `--endpoint`.

## Step 3: Confirm the CLI protocol

A read-only grep of the installed bundle found no `OPENAI_BASE_URL`, `OPENAI_API_BASE`, `openaiBaseUrl`, or `overrideOpenAIBaseUrl` strings. It found no `chat/completions` or `/v1/responses` routes.

The bundle defines Cursor's own service:

```text
aiserver.v1.AiService ... streamChat ... streamChatWeb ... streamChatTryReallyHard
```

Those are server-streaming Cursor RPC methods, not OpenAI HTTP routes. Source: installed bundle at `/Users/yu/.local/share/cursor-agent/versions/2026.10.12-d47ca18`.

## Step 4: Check the CLI config

`~/.cursor/cli-config.json` has no provider, API-key, or OpenAI base-URL setting.

`serverConfigCache.backendUrl` and `serverConfigCache.agentUrlConfig.agentUrl` are caches of URLs provided by Cursor servers. They are not a documented override. Editing those cache values would not make the CLI speak OpenAI chat completions.

## Step 5: Choose a supported path

- Use the desktop Cursor IDE with a public HTTPS URL. See [`docs/cursor-ide.md`](cursor-ide.md).
- Use another OpenAI-compatible CLI with base URL `http://127.0.0.1:8765/v1` and the key printed at startup.

OpenAI's Cursor integration article says BYOK and custom OpenAI-compatible base URLs apply only to local Chat and Agent in the Cursor desktop app. They do not apply to the Cursor CLI, Cloud or Background Agents, Tab, Auto, or the API/SDK. Source: <https://help.openai.com/en/articles/20001506-using-openai-models-in-cursor>

## Evidence

Grep counts from the installed bundle:

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

The official CLI parameter reference also has no custom base URL or provider key. Source: <https://cursor.com/docs/cli/reference/parameters>

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
