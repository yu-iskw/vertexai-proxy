# vertexai-proxy verification map

Read this index before driving the proxy. Each feature file is a recipe for one user-visible HTTP capability.

## Baseline preconditions

- Repository builds: `pnpm --filter @vertexai-proxy/server build`
- Verification harness port **`PROXY_VERIFY_PORT`** default `18765` is free (or owned by this run)
- `RUN_ID` set so state and evidence dirs do not collide
- For chat completion proofs: `GOOGLE_CLOUD_PROJECT`, `gcloud auth application-default login`, and the model enabled in Vertex Model Garden
- Start the instance with `scripts/verify.sh launch` for this `RUN_ID` only

## Driving conventions

- Base URL `http://127.0.0.1:${PROXY_VERIFY_PORT}`
- Bearer token from `${VERIFY_DIR}/state/api-key.txt` after launch (or parse `vertexai-proxy API key:` from the run log)
- Use `curl` with `-w` trailers or save bodies via `scripts/verify.sh drive`
- Correlate HTTP responses with `access-*.log` excerpts from the run log

## Proof and skip reporting

- Capture status code, response body snippet, and matching access-log line when available
- Chat proofs require live Vertex; report `SKIP` with reason if ADC or project is missing
- Do not treat `cursor agent` traffic as proxy proof

## Features

- [Health check](./health-check.md) public liveness
- [List models](./list-models.md) authenticated OpenAI model list
- [Chat completions](./chat-completions.md) Vertex-backed completion
- [Auth errors](./auth-errors.md) missing or invalid bearer token
