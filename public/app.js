const $ = (id) => document.getElementById(id);
let controller = null;
const history = [];

function apiUrl(path) {
  const base = String(window.MIKAEL_API_BASE || "").trim().replace(/\/$/, "");
  if (base) return base + path;
  if (location.protocol === "file:" || location.origin === "null") {
    throw new Error("Configure uma URL HTTPS do servidor antes de usar o APK.");
  }
  return path;
}

function showTab(name) {
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === name + "Panel"));
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("selected", button.dataset.tab === name));
}
document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.tab)));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.go)));

async function refreshHealth() {
  try {
    const response = await fetch(apiUrl("/api/health"));
    if (!response.ok) throw new Error("Servidor indisponível");
    const data = await response.json();
    $("connection").textContent = "Servidor conectado";
    $("statusDot").classList.add("ok");
    for (const key of ["openai", "gemini"]) {
      const ready = Boolean(data.providers?.[key]);
      $(key + "State").textContent = ready ? "API configurada" : "Chave não configurada";
      $(key + "Badge").textContent = ready ? "Configurada" : "Pendente";
      $(key + "Badge").classList.toggle("ready", ready);
    }
  } catch {
    $("connection").textContent = "Servidor indisponível";
    $("statusDot").classList.remove("ok");
  }
}

function addMessage(agent, content, round) {
  const article = document.createElement("article");
  article.className = "message " + (agent === "Gemini" ? "gemini" : "");
  const heading = document.createElement("header");
  heading.textContent = agent + " · Rodada " + round;
  const body = document.createElement("div");
  body.textContent = content;
  article.append(heading, body);
  $("transcript").append(article);
}

$("startDebate").addEventListener("click", async () => {
  const task = $("task").value.trim();
  if (!task) {
    $("debateStatus").textContent = "Escreva uma tarefa antes de iniciar.";
    return;
  }
  controller = new AbortController();
  $("startDebate").disabled = true;
  $("stopDebate").hidden = false;
  $("transcript").replaceChildren();
  $("debateStatus").textContent = "As duas IAs estão trabalhando…";
  try {
    const response = await fetch(apiUrl("/api/debate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, rounds: Number($("rounds").value) }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "Falha no debate");
      error.partialTranscript = data.partialTranscript;
      throw error;
    }
    data.transcript.forEach(message => addMessage(message.agent, message.content, message.round));
    history.push({ task, transcript: data.transcript });
    $("debateStatus").textContent = "Debate concluído. Revise as sugestões e teste qualquer código antes de usar.";
  } catch (error) {
    $("debateStatus").textContent = error.name === "AbortError" ? "Debate interrompido." : error.message;
    (error.partialTranscript || []).forEach(message => addMessage(message.agent, message.content, message.round));
  } finally {
    $("startDebate").disabled = false;
    $("stopDebate").hidden = true;
    controller = null;
  }
});

$("stopDebate").addEventListener("click", () => controller?.abort());
$("clearHistory").addEventListener("click", () => {
  history.length = 0;
  $("transcript").replaceChildren();
  $("debateStatus").textContent = "Histórico desta sessão limpo.";
});
refreshHealth();
