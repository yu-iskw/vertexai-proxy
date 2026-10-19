# TypeScript Vertex AI proxy

The implementation is in `packages/proxy` and uses Node.js 22+ with `google-auth-library` and native `fetch`. No Python runtime is required.

## Setup

```bash
pnpm install
pnpm --filter @vertexai-proxy/server build
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT="your-project"
export VERTEX_LOCATION="us-east5"
export PROXY_API_KEY="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
export VERTEX_MODELS='{"gemini":"gemini:gemini-2.5-pro","claude":"claude:claude-sonnet-4-5@20250929"}'
pnpm --filter @vertexai-proxy/server start
```

For **optional keyless service account impersonation**, replace the ADC login with:

```bash
gcloud auth application-default login --impersonate-service-account=vertex-proxy@your-project.iam.gserviceaccount.com
```

The caller needs `roles/iam.serviceAccountTokenCreator` on the target service account; the service account needs Vertex AI inference permissions in the inference project. Ensure relevant APIs and model access are enabled.

Use `http://127.0.0.1:8765/v1` as the OpenAI-compatible base URL, `PROXY_API_KEY` as the bearer key, and `gemini` or `claude` as model aliases.

## Scope and limitations

This is a **text-only, non-streaming** initial implementation of `GET /v1/models` and `POST /v1/chat/completions`. It does **not** support tool calling, streaming, multimodal inputs, or Responses API. These are essential for many coding agents and must be added before claiming broad compatibility. Cursor may not be able to reach a local proxy if it routes BYOK requests through remote infrastructure.

Security defaults: localhost binding, required bearer key, explicit model allowlist, request body limit, upstream timeout, and ADC (no downloaded service-account key). Real Vertex AI and agent integration tests remain outstanding.
