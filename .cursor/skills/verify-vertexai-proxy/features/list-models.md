# List models

OpenAI-compatible clients call `GET /v1/models` with the proxy API key to discover model IDs mapped to Vertex.

## Sub-features

- `models-auth` returns HTTP 200 and `owned_by: vertex-ai`
- `models-metadata` access log includes `vertex_project`, `vertex_location`, `model_count`, and `models`

## How to get to it (user POV)

- Configure client base URL `http://127.0.0.1:<port>/v1`
- Send `Authorization: Bearer <proxy-api-key>`
- Request `GET /v1/models`

## Driving it with curl

Preconditions:

- Proxy running for this `RUN_ID`
- API key in `state/api-key.txt`

- **Authenticated list.** Run `curl -sS -w '\n---HTTP_CODE:%{http_code}---\n' -H "Authorization: Bearer $(cat state/api-key.txt)" http://127.0.0.1:${PROXY_VERIFY_PORT}/v1/models`. Expect HTTP 200 and a JSON `data` array.
- **Log metadata.** Grep the run log for `vertexai-proxy response GET /v1/models` and confirm `vertex_project=` and `model_count=` appear.
- **Proof.** `verify.sh drive` writes `models-auth.txt` and `access-models.log`.

## Gotchas

- Model IDs are the proxy aliases, not raw Vertex resource names
- `VERTEX_MODELS` restricts the list for that process
