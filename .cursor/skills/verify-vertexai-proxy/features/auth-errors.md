# Auth errors

Protected routes reject missing or wrong bearer tokens before any Vertex call.

## Sub-features

- `models-no-key` `GET /v1/models` without `Authorization` returns HTTP 401

## How to get to it (user POV)

- Call `/v1/models` or `/v1/chat/completions` without `Authorization: Bearer`

## Driving it with curl

Preconditions:

- Proxy running

- **Unauthorized models.** Run `curl -sS -w '\n---HTTP_CODE:%{http_code}---\n' http://127.0.0.1:${PROXY_VERIFY_PORT}/v1/models`. Expect trailer `401`.
- **Proof.** `verify.sh drive` saves `models-unauth.txt`.

## Gotchas

- `/healthz` remains public
- Wrong key also returns 401; this recipe only covers a missing header
