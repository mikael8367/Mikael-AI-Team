const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PORT = "0";
process.env.APP_ACCESS_PASSWORD = "test-access-password";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.MAX_REQUESTS_PER_MINUTE = "100";

const { server } = require("../server");

test("server starts and exposes provider configuration without secrets", async () => {
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.accessConfigured, true);
  assert.equal(data.providers.openai, false);
  assert.equal(data.providers.gemini, false);
});

test("debate endpoint rejects unauthenticated requests", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/debate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: "Teste", rounds: 1 })
  });
  assert.equal(response.status, 401);
});

test("login rejects wrong password and issues a signed session for the right one", async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const wrong = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "senha-errada" })
  });
  assert.equal(wrong.status, 401);

  const right = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-access-password" })
  });
  assert.equal(right.status, 200);
  const session = await right.json();
  assert.equal(typeof session.token, "string");
  assert.ok(session.token.includes("."));

  const invalidRounds = await fetch(base + "/api/debate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.token },
    body: JSON.stringify({ task: "Teste", rounds: 5 })
  });
  assert.equal(invalidRounds.status, 400);
});

test("server closes cleanly after integration tests", async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
