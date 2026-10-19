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


## Optional service account impersonation (keyless)

The proxy uses Google Application Default Credentials (ADC). You can choose either
direct user ADC or **impersonated service account ADC** without modifying proxy code.
Impersonation is configured on the operator's machine, not via the client request.

```bash
export GOOGLE_CLOUD_PROJECT="vertex-consumer-project"
export VERTEX_LOCATION="us-east5"
export IMPERSONATED_SA="vertex-proxy@vertex-consumer-project.iam.gserviceaccount.com"

# One-time: the calling identity needs roles/iam.serviceAccountTokenCreator
# on the target service account; an administrator should grant this narrowly.
gcloud auth application-default login \
  --impersonate-service-account="$IMPERSONATED_SA"

# Check the ADC identity can mint a token.
gcloud auth application-default print-access-token >/dev/null

vertexai-proxy
```

The target service account needs the minimum Vertex AI permissions in the
resource project (commonly `roles/aiplatform.user`, narrowed where feasible).
Enable the IAM Service Account Credentials API in the project required for token
minting and Vertex AI API in the inference project. If the service account and
Vertex AI project differ, grant permissions in the inference project.

**Alternative:** `gcloud auth application-default login` without impersonation
uses the operator's ADC identity directly. On Cloud Run, prefer an attached
service identity rather than local user ADC.

**Security:** No downloadable service account keys are required. Keep the
generated ADC file private, avoid logging tokens, and revoke the impersonation
grant when access is no longer required. This option applies to the local
Google auth library and LiteLLM's ADC resolution; actual Gemini/Claude
requests still require integration testing.

Note: `gcloud config set auth/impersonate_service_account ...` controls gcloud
CLI requests, **not necessarily ADC used by Python applications**. Use the
`gcloud auth application-default login --impersonate-service-account` flow above.
