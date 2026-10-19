# Health check

Clients poll liveness without credentials before configuring OpenAI base URL and API key.

## Sub-features

- `healthz-ok` returns JSON `{ "status": "ok" }` with HTTP 200

## How to get to it (user POV)

- Open or request `GET http://127.0.0.1:<port>/healthz` from a browser, curl, or health probe

## Driving it with curl

Preconditions:

- Proxy launched for this `RUN_ID` on `PROXY_VERIFY_PORT`

- **Liveness.** Run `curl -sS -w '\n---HTTP_CODE:%{http_code}---\n' http://127.0.0.1:${PROXY_VERIFY_PORT}/healthz`. Trailer shows `200` and body contains `"status":"ok"`.
- **Proof.** Save output to `evidence/healthz.txt` via `verify.sh drive` or manually under the run evidence dir.

## Gotchas

- `/healthz` does not require the bearer key
- A passing health check does not prove Vertex ADC or model access
