require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("node:crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_ACCESS_PASSWORD = process.env.APP_ACCESS_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const allowedOrigins = new Set(["https://localhost", "http://localhost", "capacitor://localhost"]);
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
app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.MAX_REQUESTS_PER_MINUTE) || 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  service: "Mikael AI Team",
  providers: {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY)
  },
  accessConfigured: Boolean(APP_ACCESS_PASSWORD && SESSION_SECRET)
}));


function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return payload + "." + signature;
}

function requireAuth(req, res, next) {
  if (!APP_ACCESS_PASSWORD || !SESSION_SECRET) {
    return res.status(503).json({ error: "A proteção de acesso ainda não foi configurada no servidor." });
  }
  const token = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 2) return res.status(401).json({ error: "Faça login para iniciar o debate." });
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], "base64url"); } catch { return res.status(401).json({ error: "Sessão inválida." }); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: "Sessão inválida." });
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) {
      return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
    }
  } catch {
    return res.status(401).json({ error: "Sessão inválida." });
  }
  next();
}

app.post("/api/login", (req, res) => {
  if (!APP_ACCESS_PASSWORD || !SESSION_SECRET) {
    return res.status(503).json({ error: "A senha de acesso ainda não foi configurada no servidor." });
  }
  const supplied = typeof req.body?.password === "string" ? req.body.password : "";
  const expectedHash = crypto.createHash("sha256").update(APP_ACCESS_PASSWORD).digest();
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  if (!crypto.timingSafeEqual(expectedHash, suppliedHash)) {
    return res.status(401).json({ error: "Senha incorreta." });
  }
  res.json({ ok: true, token: createSessionToken(), expiresIn: 43200 });
});

async function askOpenAI(messages, signal) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: messages.map(message => ({
        role: message.role,
        content: [{ type: "input_text", text: message.content }]
      }))
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)])
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OPENAI_REQUEST_FAILED");
  const output = data.output?.flatMap(item => item.content || [])
    .filter(part => part.type === "output_text")
    .map(part => part.text).join("\n");
  if (!output) throw new Error("OPENAI_EMPTY_RESPONSE");
  return output;
}

async function askGemini(prompt, signal) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_NOT_CONFIGURED");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)])
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "GEMINI_REQUEST_FAILED");
  const output = data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("\n");
  if (!output) throw new Error("GEMINI_EMPTY_RESPONSE");
  return output;
}

app.post("/api/debate", requireAuth, async (req, res) => {
  const task = typeof req.body?.task === "string" ? req.body.task.trim() : "";
  const rounds = Number(req.body?.rounds ?? 2);
  if (!task || task.length > 12_000) {
    return res.status(400).json({ error: "A tarefa deve ter entre 1 e 12000 caracteres." });
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 4) {
    return res.status(400).json({ error: "Rodadas deve ser um número inteiro entre 1 e 4." });
  }
  if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: "Configure as chaves OpenAI e Gemini no servidor.",
      missing: { openai: !process.env.OPENAI_API_KEY, gemini: !process.env.GEMINI_API_KEY }
    });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  const transcript = [];
  try {
    let previous = "";
    for (let round = 1; round <= rounds; round++) {
      const proposal = await askOpenAI([
        {
          role: "system",
          content: "Você é a IA desenvolvedora do Mikael AI Team. Proponha soluções técnicas claras, seguras e testáveis. Não afirme que executou ações que não realizou."
        },
        {
          role: "user",
          content: `Tarefa: ${task}\n\nContexto e críticas anteriores do Gemini:\n${previous || "Nenhum. Apresente a primeira proposta."}`
        }
      ], controller.signal);
      transcript.push({ round, agent: "ChatGPT", content: proposal });

      const critique = await askGemini(
        `Você é a IA revisora independente do Mikael AI Team. Analise a proposta, discorde quando houver motivos, identifique bugs, riscos, lacunas e testes necessários. Seja objetiva.\n\nTarefa original:\n${task}\n\nProposta do ChatGPT:\n${proposal}`,
        controller.signal
      );
      transcript.push({ round, agent: "Gemini", content: critique });
      previous = critique;
    }
    if (!res.destroyed) {
      res.json({
        ok: true,
        rounds,
        transcript,
        note: "As respostas são sugestões das APIs; valide e teste alterações antes de aplicá-las."
      });
    }
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    const message = String(error.message || "Falha nas APIs");
    const status = message.includes("_NOT_CONFIGURED") ? 503 : 502;
    res.status(status).json({ error: message.slice(0, 500), partialTranscript: transcript });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`Mikael AI Team ouvindo na porta ${PORT}`));
