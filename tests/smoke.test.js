const { test, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.PORT = "0";
process.env.APP_ACCESS_PASSWORD = "test-access-password";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.MAX_REQUESTS_PER_MINUTE = "100";

const { server, normalizeParticipants, isQuotaError, isTransientProviderError, PROVIDERS, extractGeminiOutput } = require("../server");

test("Gemini uses the current model and extracts Interactions API text", () => {
  assert.equal(PROVIDERS.gemini.defaultModel, "gemini-3.8-flash");
  assert.equal(extractGeminiOutput({ output_text: "  resposta Gemini  " }), "resposta Gemini");
  assert.equal(extractGeminiOutput({ output: [{ type: "message", content: [{ type: "text", text: "resposta alternativa" }] }] }), "resposta alternativa");
  assert.equal(extractGeminiOutput({ output: [] }), "");
});

test("provider catalog contains all seven requested services", () => {
  assert.deepEqual(Object.keys(PROVIDERS), ["openai", "gemini", "groq", "openrouter", "deepseek", "mistral", "claude"]);
  assert.equal(normalizeParticipants(["gemini", "groq", "gemini"], "selected").length, 2);
  assert.equal(normalizeParticipants([], "selected"), null);
  assert.equal(normalizeParticipants(["unknown"], "selected"), null);
});

test("automatic mode only chooses providers with configured keys", () => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GROQ_API_KEY = "test-groq-key";
  assert.deepEqual(normalizeParticipants([], "auto"), ["gemini", "groq"]);
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
});

test("quota errors are recognized for automatic fallback", () => {
  assert.equal(isQuotaError(Object.assign(new Error("No credits remaining"), { status: 429 })), true);
  assert.equal(isQuotaError(Object.assign(new Error("bad request"), { status: 400 })), false);
});

test("temporary provider overloads are recognized for retry and automatic fallback", () => {
  assert.equal(isTransientProviderError(Object.assign(new Error("high demand, try again later"), { status: 503 })), true);
  assert.equal(isTransientProviderError(Object.assign(new Error("rate limited"), { status: 429 })), true);
  assert.equal(isTransientProviderError(Object.assign(new Error("invalid API key"), { status: 401 })), false);
});

test("server starts and health exposes provider status without secrets", async () => {
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/health");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.accessConfigured, true);
  assert.equal(data.providers.openai.configured, false);
  assert.equal(data.providers.gemini.configured, false);
  assert.equal(JSON.stringify(data).includes("test-session-secret"), false);
});

test("unknown API routes return JSON instead of the HTML application shell", async () => {
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/rota-inexistente");
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /application\\/json/);
  assert.deepEqual(await response.json(), { error: "Rota da API não encontrada." });
});

test("debate endpoint rejects unauthenticated requests", async () => {
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/debate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: "Teste", rounds: 1, providers: ["gemini"] })
  });
  assert.equal(response.status, 401);
});

test("login validates password and debate validates provider selection", async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const wrong = await fetch(base + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "senha-errada" })
  });
  assert.equal(wrong.status, 401);
  const right = await fetch(base + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-access-password" })
  });
  assert.equal(right.status, 200);
  const session = await right.json();
  assert.equal(typeof session.token, "string");
  const invalidRounds = await fetch(base + "/api/debate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.token },
    body: JSON.stringify({ task: "Teste", rounds: 5, providers: ["gemini"] })
  });
  assert.equal(invalidRounds.status, 400);
  const invalidProvider = await fetch(base + "/api/debate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.token },
    body: JSON.stringify({ task: "Teste", rounds: 1, providers: ["nao-existe"] })
  });
  assert.equal(invalidProvider.status, 400);
});

after(async () => {
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
