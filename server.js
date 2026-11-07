require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "64kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: Number(process.env.MAX_REQUESTS_PER_MINUTE) || 20, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  service: "Mikael AI Team",
  providers: {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY)
  }
}));

async function askOpenAI(messages) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: messages.map(m => ({ role: m.role, content: [{ type: "input_text", text: m.content }] }))
    }),
    signal: AbortSignal.timeout(90_000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OPENAI_REQUEST_FAILED");
  const text = data.output?.flatMap(item => item.content || []).filter(part => part.type === "output_text").map(part => part.text).join("\n");
  if (!text) throw new Error("OPENAI_EMPTY_RESPONSE");
  return text;
}

async function askGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_NOT_CONFIGURED");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(90_000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "GEMINI_REQUEST_FAILED");
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n");
  if (!text) throw new Error("GEMINI_EMPTY_RESPONSE");
  return text;
}

app.post("/api/debate", async (req, res) => {
  const task = typeof req.body?.task === "string" ? req.body.task.trim() : "";
  const rounds = Number(req.body?.rounds ?? 2);
  if (!task || task.length > 12_000) return res.status(400).json({ error: "A tarefa deve ter entre 1 e 12000 caracteres." });
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 4) return res.status(400).json({ error: "Rodadas deve ser um número inteiro entre 1 e 4." });
  if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "Configure as chaves OpenAI e Gemini no servidor.", missing: { openai: !process.env.OPENAI_API_KEY, gemini: !process.env.GEMINI_API_KEY } });
  }
  const transcript = [];
  try {
    let previous = "";
    for (let i = 1; i <= rounds; i++) {
      const proposal = await askOpenAI([
        { role: "system", content: "Você é a IA desenvolvedora do Mikael AI Team. Proponha soluções técnicas claras, seguras e testáveis. Não afirme que executou ações que não realizou." },
        { role: "user", content: `Tarefa: ${task}\n\nContexto e críticas anteriores do Gemini:\n${previous || "Nenhum. Apresente a primeira proposta."}` }
      ]);
      transcript.push({ round: i, agent: "ChatGPT", content: proposal });
      const critique = await askGemini(`Você é a IA revisora independente do Mikael AI Team. Analise a proposta, discorde quando houver motivos, identifique bugs, riscos, lacunas e testes necessários. Seja objetiva.\n\nTarefa original:\n${task}\n\nProposta do ChatGPT:\n${proposal}`);
      transcript.push({ round: i, agent: "Gemini", content: critique });
      previous = critique;
    }
    res.json({ ok: true, rounds, transcript, note: "As respostas são sugestões das APIs; valide e teste alterações antes de aplicá-las." });
  } catch (error) {
    const message = String(error.message || "Falha nas APIs");
    const status = message.includes("_NOT_CONFIGURED") ? 503 : 502;
    res.status(status).json({ error: message.slice(0, 500), partialTranscript: transcript });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`Mikael AI Team ouvindo na porta ${PORT}`));
