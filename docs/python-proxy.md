# Python Vertex AI proxy prototype

This repository also contains a Python OpenAI-compatible Vertex AI proxy under `src/vertexai_proxy`.

## Quickstart

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project
export VERTEX_LOCATION=us-east5
export PROXY_API_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export VERTEX_MODELS='{"gemini":"vertex_ai/gemini-2.5-pro","claude":"vertex_ai/claude-sonnet-4-5@20250929"}'
vertexai-proxy
```

Model IDs and regional availability must be checked against the Vertex AI project and LiteLLM provider support.

Configure a compatible coding agent with base URL `http://127.0.0.1:8765/v1`, the configured bearer API key, and a model alias.

Supported endpoints: `GET /healthz`, `GET /v1/models`, and `POST /v1/chat/completions` (streaming and non-streaming). LiteLLM performs provider-specific message/tool translation.

Security: loopback-only CLI binding, bearer authentication, model allowlisting, and Google Cloud ADC. Do not publish the port to a public network.

Limitations: no Responses API; Cursor may route BYOK requests remotely, making loopback URLs inaccessible; tool calling, streaming and multimodal compatibility require end-to-end testing with the actual models and coding agents. No live Vertex AI validation has been performed.
