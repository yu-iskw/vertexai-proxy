"""Local-only OpenAI-compatible proxy backed by Vertex AI via LiteLLM."""
from __future__ import annotations

import json
import os
import secrets
from typing import Any

import litellm
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(title="Vertex AI Proxy", docs_url=None, redoc_url=None)
litellm.drop_params = False


def models() -> dict[str, str]:
    raw = os.getenv("VERTEX_MODELS", "{}")
    try:
        mapping = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("VERTEX_MODELS must be valid JSON") from exc
    if not isinstance(mapping, dict) or not mapping or any(
        not isinstance(k, str) or not isinstance(v, str) or not k or not v
        for k, v in mapping.items()
    ):
        raise RuntimeError("VERTEX_MODELS must map nonempty aliases to LiteLLM Vertex model IDs")
    if any(not v.startswith("vertex_ai/") for v in mapping.values()):
        raise RuntimeError("Every model must use the vertex_ai/ provider prefix")
    return mapping


def authenticate(authorization: str | None) -> None:
    key = os.getenv("PROXY_API_KEY")
    if not key:
        raise HTTPException(503, "PROXY_API_KEY must be configured")
    token = authorization.removeprefix("Bearer ") if authorization else ""
    if not secrets.compare_digest(token, key):
        raise HTTPException(401, "Unauthorized", headers={"WWW-Authenticate": "Bearer"})


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/models")
async def list_models(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    authenticate(authorization)
    return {"object": "list", "data": [
        {"id": alias, "object": "model", "owned_by": "vertex-ai"}
        for alias in models()
    ]}


@app.post("/v1/chat/completions")
async def chat(request: Request, authorization: str | None = Header(default=None)):
    authenticate(authorization)
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Expected a JSON object")
    alias = body.get("model")
    mapping = models()
    if alias not in mapping:
        raise HTTPException(400, "Unknown or disallowed model")
    params = dict(body)
    params["model"] = mapping[alias]
    params["vertex_project"] = os.getenv("GOOGLE_CLOUD_PROJECT")
    params["vertex_location"] = os.getenv("VERTEX_LOCATION", "us-central1")
    if not params["vertex_project"]:
        raise HTTPException(503, "GOOGLE_CLOUD_PROJECT must be configured")
    streaming = params.get("stream") is True
    try:
        result = await litellm.acompletion(**params)
        if streaming:
            async def events():
                try:
                    async for chunk in result:
                        data = chunk.model_dump(exclude_none=True)
                        data["model"] = alias
                        yield "data: " + json.dumps(data) + "\n\n"
                except Exception:
                    # Never leak provider error details into an SSE stream.
                    yield 'data: {"error":{"message":"Upstream streaming failed","type":"upstream_error"}}\n\n'
                yield "data: [DONE]\n\n"
            return StreamingResponse(events(), media_type="text/event-stream",
                                     headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        data = result.model_dump(exclude_none=True)
        data["model"] = alias
        return JSONResponse(data)
    except litellm.AuthenticationError:
        raise HTTPException(502, "Vertex AI authentication failed")
    except litellm.RateLimitError:
        raise HTTPException(429, "Vertex AI rate limit exceeded")
    except litellm.BadRequestError:
        raise HTTPException(400, "Vertex AI rejected the request")
    except Exception:
        raise HTTPException(502, "Vertex AI request failed")


def main() -> None:
    host = os.getenv("PROXY_HOST", "127.0.0.1")
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("Refusing non-loopback bind; use a separately secured gateway")
    models()  # Fail fast on misconfiguration.
    if not os.getenv("PROXY_API_KEY"):
        raise SystemExit("PROXY_API_KEY is required")
    if not os.getenv("GOOGLE_CLOUD_PROJECT"):
        raise SystemExit("GOOGLE_CLOUD_PROJECT is required")
    uvicorn.run(app, host=host, port=int(os.getenv("PROXY_PORT", "8765")))


if __name__ == "__main__":
    main()
