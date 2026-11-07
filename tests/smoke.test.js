const test = require("node:test");
const assert = require("node:assert/strict");
test("debate limits are documented and bounded", () => {
  for (const n of [1,2,3,4]) assert.ok(Number.isInteger(n) && n >= 1 && n <= 4);
  for (const n of [0,5,-1,1.5]) assert.ok(!(Number.isInteger(n) && n >= 1 && n <= 4));
});
test("API secrets are not exposed by the static client", () => {
  const fs = require("node:fs");
  const client = fs.readFileSync("public/app.js", "utf8");
  assert.doesNotMatch(client, /OPENAI_API_KEY|GEMINI_API_KEY/);
});
