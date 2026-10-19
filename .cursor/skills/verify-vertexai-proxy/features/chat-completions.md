# Chat completions

Clients send `POST /v1/chat/completions` with a mapped model id. The proxy calls Vertex and returns an OpenAI-shaped completion.

## Sub-features

- `chat-200` HTTP 200 with non-empty assistant `content`
- `chat-vertex-log` access log shows `vertex_provider`, `vertex_model`, `vertex_upstream_status=200`, and token counts

## How to get to it (user POV)

- Same base URL and bearer key as list models
- POST JSON `{ "model": "<id>", "messages": [{ "role": "user", "content": "..." }] }` to `/v1/chat/completions`
- `stream: true` returns HTTP 200 with buffered OpenAI-style SSE (optional; default recipe uses non-stream JSON)

## Driving it with curl

Preconditions:

- `GOOGLE_CLOUD_PROJECT` matches a project with ADC and model access
- `VERIFY_MODEL` (default `gemini-3.8-flash`) is enabled for `VERTEX_LOCATION`
- Proxy running with that project env (set before `launch`)

- **Completion.** Run `curl -sS -m 90 -w '\n---HTTP_CODE:%{http_code}---\n' -H "Authorization: Bearer $(cat state/api-key.txt)" -H 'Content-Type: application/json' -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"Say ok"}]}' http://127.0.0.1:${PROXY_VERIFY_PORT}/v1/chat/completions`. Expect HTTP 200 and `choices[0].message.content` non-empty.
- **Vertex proof.** Tail log for `vertex_upstream_status=200` on the matching `response POST /v1/chat/completions` line.
- **Proof.** `verify.sh drive` writes `chat.txt` and `access-chat.log` when ADC and project are set.

## Gotchas

- Claude models need separate enablement in Model Garden
- Global location is required for some models (for example `gemini-3.8-flash`)
- Without ADC the harness skips chat and writes `chat-skipped.txt`
