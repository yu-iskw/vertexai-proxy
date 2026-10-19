import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";

type Message = { role: string; content: string | Array<{ type: string; text?: string }> };
type ChatRequest = { model: string; messages: Message[]; max_tokens?: number; temperature?: number; stream?: boolean };
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const project = process.env.GOOGLE_CLOUD_PROJECT ?? "";
const location = process.env.VERTEX_LOCATION ?? "us-central1";
const apiKey = process.env.PROXY_API_KEY ?? "";
const port = Number(process.env.PROXY_PORT ?? "8765");
const models: Record<string, string> = JSON.parse(process.env.VERTEX_MODELS ?? "{}") as Record<string, string>;
const regionPattern = /^[a-z]+(?:-[a-z]+)+[0-9]+$/;
const modelPattern = /^[a-zA-Z0-9_.@-]+$/;
if (!project || !/^[a-z][a-z0-9-]{4,62}$/.test(project) || !regionPattern.test(location) ||
    !apiKey || Object.keys(models).length === 0 || !Number.isInteger(port) || port < 1 || port > 65535 ||
    Object.values(models).some((m) => !/^(gemini|claude):[a-zA-Z0-9_.@-]+$/.test(m))) {
  throw new Error("Configure GOOGLE_CLOUD_PROJECT, VERTEX_LOCATION, PROXY_API_KEY, VERTEX_MODELS and a valid PROXY_PORT");
}
function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function error(res: ServerResponse, status: number, message: string): void {
  respond(res, status, { error: { message, type: "proxy_error" } });
}
function authenticated(header: string | undefined): boolean {
  const candidate = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(candidate), b = Buffer.from(apiKey);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function bodyOf(req: IncomingMessage): Promise<ChatRequest> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += data.length;
    if (size > 1024 * 1024) throw new Error("Request exceeds 1 MiB");
    chunks.push(data);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatRequest;
}
function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content) || message.content.some((part) => part.type !== "text")) {
    throw new Error("Only text messages are supported in this initial implementation");
  }
  return message.content.map((part) => part.text ?? "").join("\n");
}
async function callVertex(input: ChatRequest, model: string): Promise<{ text: string; tokens?: { input: number; output: number } }> {
  const [provider, ...parts] = model.split(":");
  const id = parts.join(":");
  if (!modelPattern.test(id)) throw new Error("Invalid configured model identifier");
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("ADC access token unavailable");
  const base = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}`;
  let url: string, payload: unknown;
  if (provider === "gemini") {
    url = `${base}/publishers/google/models/${id}:generateContent`;
    const system = input.messages.filter((m) => m.role === "system").map(textOf).join("\n");
    const contents = input.messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "model" : "user", parts: [{ text: textOf(m) }],
    }));
    payload = { contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { ...(input.max_tokens ? { maxOutputTokens: input.max_tokens } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}) } };
  } else {
    url = `${base}/publishers/anthropic/models/${id}:rawPredict`;
    const system = input.messages.filter((m) => m.role === "system").map(textOf).join("\n");
    payload = { anthropic_version: "vertex-2023-10-16", max_tokens: input.max_tokens ?? 4096,
      ...(system ? { system } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      messages: input.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: textOf(m) })) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, { method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json" },
      body: JSON.stringify(payload) });
    if (!response.ok) {
      // Do not return upstream response bodies: they may contain sensitive request context.
      throw new Error(`Vertex AI returned HTTP ${response.status}`);
    }
    const data = await response.json() as Record<string, any>;
    if (provider === "gemini") {
      return { text: (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join(""),
        tokens: { input: data.usageMetadata?.promptTokenCount ?? 0, output: data.usageMetadata?.candidatesTokenCount ?? 0 } };
    }
    return { text: (data.content ?? []).filter((p: { type: string }) => p.type === "text")
      .map((p: { text: string }) => p.text).join(""),
      tokens: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 } };
  } finally { clearTimeout(timer); }
}
export const server = createServer(async (req, res) => {
  if (req.url === "/healthz" && req.method === "GET") return respond(res, 200, { status: "ok" });
  if (!authenticated(req.headers.authorization)) return error(res, 401, "Unauthorized");
  if (req.url === "/v1/models" && req.method === "GET") return respond(res, 200, {
    object: "list", data: Object.keys(models).map((id) => ({ id, object: "model", owned_by: "vertex-ai" })) });
  if (req.url !== "/v1/chat/completions" || req.method !== "POST") return error(res, 404, "Not found");
  try {
    const input = await bodyOf(req);
    if (!input || typeof input.model !== "string" || !Array.isArray(input.messages) ||
      !input.messages.every((m) => m && ["system", "user", "assistant"].includes(m.role))) {
      return error(res, 400, "Invalid chat completion request");
    }
    if (input.stream) return error(res, 400, "Streaming is not yet supported");
    if (!Object.hasOwn(models, input.model)) return error(res, 400, "Unknown model alias");
    const output = await callVertex(input, models[input.model]);
    const created = Math.floor(Date.now() / 1000);
    return respond(res, 200, { id: `chatcmpl-${randomUUID()}`, object: "chat.completion", created,
      model: input.model, choices: [{ index: 0, message: { role: "assistant", content: output.text }, finish_reason: "stop" }],
      usage: { prompt_tokens: output.tokens?.input ?? 0, completion_tokens: output.tokens?.output ?? 0,
        total_tokens: (output.tokens?.input ?? 0) + (output.tokens?.output ?? 0) } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unexpected error";
    if (message.includes("1 MiB") || message.includes("Only text") || message.includes("JSON")) {
      return error(res, 400, "Invalid or unsupported request");
    }
    return error(res, 502, "Vertex AI request failed");
  }
});
if (process.env.NODE_ENV !== "test") server.listen(port, "127.0.0.1");
