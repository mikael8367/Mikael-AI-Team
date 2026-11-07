require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const APP_ACCESS_PASSWORD = process.env.APP_ACCESS_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const allowedOrigins = new Set(["https://localhost", "http://localhost", "capacitor://localhost"]);
const PROVIDERS = {
  openai: { label: "ChatGPT / OpenAI", env: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", defaultModel: "gpt-4.1-mini", kind: "openai" },
  gemini: { label: "Gemini", env: "GEMINI_API_KEY", modelEnv: "GEMINI_MODEL", defaultModel: "gemini-2.5-flash", kind: "gemini" },
  groq: { label: "Groq", env: "GROQ_API_KEY", modelEnv: "GROQ_MODEL", defaultModel: "llama-3.3-70b-versatile", kind: "compatible", base: "https://api.groq.com/openai/v1/chat/completions" },
  openrouter: { label: "OpenRouter", env: "OPENROUTER_API_KEY", modelEnv: "OPENROUTER_MODEL", defaultModel: "meta-llama/llama-3.3-70b-instruct:free", kind: "compatible", base: "https://openrouter.ai/api/v1/chat/completions" },
  deepseek: { label: "DeepSeek", env: "DEEPSEEK_API_KEY", modelEnv: "DEEPSEEK_MODEL", defaultModel: "deepseek-chat", kind: "compatible", base: "https://api.deepseek.com/chat/completions" },
  mistral: { label: "Mistral AI", env: "MISTRAL_API_KEY", modelEnv: "MISTRAL_MODEL", defaultModel: "mistral-small-latest", kind: "compatible", base: "https://api.mistral.ai/v1/chat/completions" },
  claude: { label: "Claude / Anthropic", env: "ANTHROPIC_API_KEY", modelEnv: "CLAUDE_MODEL", defaultModel: "claude-3-5-haiku-latest", kind: "anthropic" }
};
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json({ limit: "64kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: Number(process.env.MAX_REQUESTS_PER_MINUTE) || 20, standardHeaders: "draft-7", legacyHeaders: false }));

function providerStatus() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, {
    label: p.label, configured: Boolean(process.env[p.env]), model: process.env[p.modelEnv] || p.defaultModel
  }]));
}
app.get("/api/health", (_req, res) => res.json({
  ok: true, service: "Mikael AI Team", providers: providerStatus(),
  accessConfigured: Boolean(APP_ACCESS_PASSWORD && SESSION_SECRET)
}));

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return payload + "." + signature;
}
function requireAuth(req, res, next) {
  if (!APP_ACCESS_PASSWORD || !SESSION_SECRET) return res.status(503).json({ error: "A proteção de acesso ainda não foi configurada no servidor." });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 2) return res.status(401).json({ error: "Faça login para iniciar o debate." });
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], "base64url"); } catch { return res.status(401).json({ error: "Sessão inválida." }); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(401).json({ error: "Sessão inválida." });
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
  } catch { return res.status(401).json({ error: "Sessão inválida." }); }
  next();
}
app.post("/api/login", (req, res) => {
  if (!APP_ACCESS_PASSWORD || !SESSION_SECRET) return res.status(503).json({ error: "A senha de acesso ainda não foi configurada no servidor." });
  const supplied = typeof req.body?.password === "string" ? req.body.password : "";
  const expectedHash = crypto.createHash("sha256").update(APP_ACCESS_PASSWORD).digest();
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  if (!crypto.timingSafeEqual(expectedHash, suppliedHash)) return res.status(401).json({ error: "Senha incorreta." });
  res.json({ ok: true, token: createSessionToken(), expiresIn: 43200 });
}

function extractOpenAIText(data) {
  return data.output?.flatMap(item => item.content || []).filter(part => part.type === "output_text").map(part => part.text).join("\n") || "";
}
async function requestJson(url, options, signal) {
  const response = await fetch(url, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || "PROVIDER_REQUEST_FAILED");
    error.status = response.status;
    error.code = data.error?.code || data.error?.type || "";
    throw error;
  }
  return data;
}
async function askProvider(id, messages, signal) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error("PROVIDER_NOT_SUPPORTED");
  const key = process.env[provider.env];
  if (!key) {
    const error = new Error(id.toUpperCase() + "_NOT_CONFIGURED");
    error.status = 503;
    throw error;
  }
  const model = process.env[provider.modelEnv] || provider.defaultModel;
  let data;
  if (provider.kind === "gemini") {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
    data = await requestJson(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: messages.map(m => m.role.toUpperCase() + ":\n" + m.content).join("\n\n") }] }] })
    }, signal);
    const output = data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("\n") || "";
    if (!output) throw new Error("GEMINI_EMPTY_RESPONSE");
    return output;
  }
  if (provider.kind === "anthropic") {
    data = await requestJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 4096,
        system: messages.filter(m => m.role === "system").map(m => m.content).join("\n\n"),
        messages: messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }))
      })
    }, signal);
    const output = data.content?.filter(part => part.type === "text").map(part => part.text).join("\n") || "";
    if (!output) throw new Error("CLAUDE_EMPTY_RESPONSE");
    return output;
  }
  const url = provider.kind === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : provider.base;
  const headers = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
  if (id === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "https://mikael-ai-team.onrender.com";
    headers["X-Title"] = "Mikael AI Team";
  }
  data = await requestJson(url, {
    method: "POST", headers,
    body: JSON.stringify({ model, messages, temperature: 0.4 })
  }, signal);
  const output = data.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim()) throw new Error(id.toUpperCase() + "_EMPTY_RESPONSE");
  return output.trim();
}
function normalizeParticipants(input, mode) {
  const available = Object.keys(PROVIDERS);
  const selected = Array.isArray(input) ? [...new Set(input)] : [];
  if (mode === "auto") return available.filter(id => process.env[PROVIDERS[id].env]);
  if (!selected.length || selected.some(id => !available.includes(id))) return null;
  if (selected.length > available.length) return null;
  return selected;
}
function isQuotaError(error) {
  const code = String(error.code || "").toLowerCase();
  const message = String(error.message || "").toLowerCase();
  return error.status === 429 || ["insufficient_quota", "billing_hard_limit_reached", "rate_limit_exceeded"].includes(code) ||
    /no credits|quota|billing|credit balance|exceeded your current quota/.test(message);
}

app.post("/api/debate", requireAuth, async (req, res) => {
  const task = typeof req.body?.task === "string" ? req.body.task.trim() : "";
  const rounds = Number(req.body?.rounds ?? 2);
  const mode = ["auto", "selected"].includes(req.body?.mode) ? req.body.mode : "selected";
  const participants = normalizeParticipants(req.body?.providers, mode);
  if (!task || task.length > 12_000) return res.status(400).json({ error: "A tarefa deve ter entre 1 e 12000 caracteres." });
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 4) return res.status(400).json({ error: "Rodadas deve ser um número inteiro entre 1 e 4." });
  if (!participants) return res.status(400).json({ error: "Escolha pelo menos uma IA válida." });
  const unavailable = participants.filter(id => !process.env[PROVIDERS[id].env]);
  if (unavailable.length) return res.status(503).json({ error: "Configure as chaves das IAs selecionadas no servidor.", missing: unavailable });
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  const transcript = [];
  const used = [];
  try {
    for (let round = 1; round <= rounds; round++) {
      for (const id of participants) {
        const prior = transcript.map(entry => entry.agent + " (rodada " + entry.round + "):\n" + entry.content).join("\n\n");
        const messages = [
          { role: "system", content: "Você é " + PROVIDERS[id].label + ", participante independente do Mikael AI Team. Responda à tarefa, avalie as ideias anteriores, discorde quando houver razões, identifique riscos e testes. Não afirme que executou ações que não realizou." },
          { role: "user", content: "Tarefa original:\n" + task + "\n\nDebate compartilhado até agora:\n" + (prior || "Você inicia o debate. Apresente sua proposta.") + "\n\nRodada atual: " + round + ". Contribua de forma objetiva e útil." }
        ];
        try {
          const content = await askProvider(id, messages, controller.signal);
          transcript.push({ round, agent: PROVIDERS[id].label, provider: id, content });
          if (!used.includes(id)) used.push(id);
        } catch (error) {
          if (isQuotaError(error) && mode === "auto" && id === "openai") {
            transcript.push({ round, agent: PROVIDERS[id].label, provider: id, status: "indisponível", content: "OpenAI indisponível por limite de créditos ou requisições. O debate continuará sem ela." });
            continue;
          }
          throw error;
        }
      }
    }
    const synthesizer = participants.slice().reverse().find(id => used.includes(id));
    if (synthesizer && transcript.length) {
      const context = transcript.map(e => e.agent + " (rodada " + e.round + "):\n" + e.content).join("\n\n");
      const conclusion = await askProvider(synthesizer, [
        { role: "system", content: "Você é responsável pela síntese final. Consolide as contribuições, destaque consenso, divergências, riscos e próximos passos. Não invente testes ou execuções." },
        { role: "user", content: "Tarefa:\n" + task + "\n\nDebate completo:\n" + context + "\n\nEscreva a conclusão final." }
      ], controller.signal);
      transcript.push({ round: rounds, agent: "Síntese · " + PROVIDERS[synthesizer].label, provider: synthesizer, content: conclusion });
    }
    if (!res.destroyed) res.json({ ok: true, rounds, participants: used, transcript, mode: used.length > 1 ? "multi-ai" : "single-ai", note: "Somente as IAs identificadas no histórico participaram efetivamente. Valide e teste sugestões antes de aplicá-las." });
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    const message = String(error.message || "Falha nas APIs");
    const status = error.status === 429 ? 429 : error.status === 503 || message.includes("_NOT_CONFIGURED") ? 503 : 502;
    res.status(status).json({ error: message.slice(0, 500), providerError: { status: error.status || null, code: error.code || null }, partialTranscript: transcript });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const server = app.listen(PORT, "0.0.0.0", () => console.log("Mikael AI Team ouvindo na porta " + PORT));
module.exports = { app, server, PROVIDERS, normalizeParticipants, isQuotaError };
