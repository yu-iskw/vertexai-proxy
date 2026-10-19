# Cursor IDE with this proxy

This page describes the desktop Cursor IDE path. It does not apply to the Cursor CLI, Cloud or Background Agents, Automations, Tab, Auto, or the API/SDK (D).

Sources are listed at the end and cited inline. Menu paths below come from the official Cursor docs and Cursor staff posts (A, B).

## Prerequisites

- Cursor routes these requests through its servers, so `127.0.0.1` is not reachable (A). The proxy currently binds `127.0.0.1` only, so expose it through a public HTTPS tunnel or reverse proxy at `https://<your-public-host>/v1`.
- ADC must be configured for the proxy, and the target model must be enabled in Model Garden. Claude models must be enabled separately.
- Use a dedicated low-privilege project and service account for the proxy. Prompts transit Cursor's backend (A).

## Start the proxy

Use aliases with a neutral prefix. A third-party source reports that Cursor never sends model names starting with `claude-` through the base URL override, and that names resembling Cursor's own models may be treated as Cursor models (E).

```bash
pnpm install
pnpm --filter @vertexai-proxy/server build
export GOOGLE_CLOUD_PROJECT="<your-project-id>"
export VERTEX_LOCATION="global"
export VERTEX_MODELS='vx-gemini-3.8-flash=gemini/gemini-3.8-flash,vx-sonnet-5-5=claude/claude-sonnet-5-5'
pnpm --filter @vertexai-proxy/server start
```

The alias format accepts dots and hyphens, so `vx-gemini-3.8-flash` and `vx-sonnet-5-5` are valid. The proxy prints its API key once at startup. The key is regenerated at every start and is mandatory for every `/v1` request.

Expose the local proxy at a public HTTPS URL. The OpenAI-compatible base URL is then `https://<your-public-host>/v1`.

## Configure Cursor

1. Open Cursor Settings > Models (A, B).
2. Find the OpenAI provider, paste the proxy's startup key into the API key field, and save (A).
3. Scroll to the bottom of Models and expand API Keys (B).
4. If your Cursor version shows the API Keys section, paste the key under OpenAI API Key and turn on "Use OpenAI API Key" (B).
5. Turn on "Override OpenAI Base URL" and enter `https://<your-public-host>/v1` (B).
6. Add custom model names that exactly match the proxy's `/v1/models` IDs, for example `vx-gemini-3.8-flash` and `vx-sonnet-5-5` (B).
7. Restart Cursor, open a new chat, and select the custom model (B).

## Important caveats

- Cursor describes the OpenAI provider as standard, non-reasoning chat models (A).
- Custom API keys only work with chat models. Tab completion continues to use Cursor's built-in models (A).
- Cursor sends the key to its backend with every request because all requests are routed through Cursor's servers for final prompt building (A).
- Zero Data Retention does not apply when you use your own keys (A).
- The override key and base URL apply to all models, including Cursor's own models such as Composer 2. Toggle the override off before using built-in models (C).
- The proxy is text-only and non-streaming. It has no tool calling and no SSE streaming. If Cursor sends `stream: true`, the proxy returns HTTP 400. This setup is not verified end-to-end. Treat Chat as experimental until SSE streaming exists.

## Sources

- A. Official Cursor docs, API keys: <https://cursor.com/docs/settings/api-keys>
- B. Cursor staff forum post on custom model settings: <https://forum.cursor.com/t/how-to-adjust-settings-for-custom-added-models/173253/21>
- C. Cursor staff forum post on the override affecting native models: <https://forum.cursor.com/t/does-adding-a-custom-model-override-cursor-s-native-models/157521>
- D. OpenAI Help Center, using OpenAI models in Cursor: <https://help.openai.com/en/articles/20001506-using-openai-models-in-cursor>
- E. Third-party Router docs, Cursor coding agents: <https://docs.router.com/coding-agents/cursor>
