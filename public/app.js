const $ = (id) => document.getElementById(id);
let controller = null;
let accessToken = "";
const history = [];
const providerIds = ["openai", "gemini", "groq", "openrouter", "deepseek", "mistral", "claude"];

function apiUrl(path) {
  const base = String(window.MIKAEL_API_BASE || "").trim().replace(/\/$/, "");
  if (base) return base + path;
  if (location.protocol === "file:" || location.origin === "null") throw new Error("Configure uma URL HTTPS do servidor antes de usar o APK.");
  return path;
}
function showTab(name) {
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === name + "Panel"));
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("selected", button.dataset.tab === name));
}
document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.tab)));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.go)));

function setProviderMode() {
  const automatic = $("providerMode").value === "auto";
  $("providerPicker").hidden = automatic;
  $("providerPicker").querySelectorAll("input").forEach(input => { input.disabled = automatic || input.dataset.configured !== "true"; });
}
$("providerMode").addEventListener("change", setProviderMode);

async function refreshHealth() {
  try {
    const response = await fetch(apiUrl("/api/health"));
    if (!response.ok) throw new Error("Servidor indisponível");
    const data = await response.json();
    $("connection").textContent = "Servidor conectado";
    if (!data.accessConfigured) $("loginStatus").textContent = "O administrador ainda precisa configurar APP_ACCESS_PASSWORD e SESSION_SECRET no servidor.";
    $("statusDot").classList.add("ok");
    for (const id of providerIds) {
      const provider = data.providers?.[id] || {};
      const ready = Boolean(provider.configured);
      const label = provider.label || id;
      const badge = $(id + "Badge");
      const state = $(id + "State");
      if (badge) {
        badge.textContent = ready ? "Configurada" : "Sem chave";
        badge.classList.toggle("ready", ready);
      }
      if (state) state.textContent = ready ? "Disponível para seleção" : "Não configurada";
      const checkbox = document.querySelector('input[name="provider"][value="' + id + '"]');
      if (checkbox) {
        checkbox.dataset.configured = String(ready);
        checkbox.disabled = !ready || $("providerMode").value === "auto";
        const option = checkbox.closest(".provider-option");
        if (option) option.classList.toggle("unavailable", !ready);
      }
      const setting = document.createElement("div");
      setting.className = "setting";
      const info = document.createElement("div");
      const name = document.createElement("b");
      name.textContent = label;
      const model = document.createElement("small");
      model.textContent = "Modelo: " + (provider.model || "não definido no servidor");
      info.append(name, model);
      const status = document.createElement("span");
      status.className = "pill" + (ready ? " ready" : "");
      status.textContent = ready ? "Configurada" : "Pendente";
      setting.append(info, status);
      if ($("providerSettings")) $("providerSettings").append(setting);
    }
    setProviderMode();
  } catch {
    $("connection").textContent = "Servidor indisponível";
    $("statusDot").classList.remove("ok");
  }
}
function addMessage(agent, content, round, status) {
  const article = document.createElement("article");
  article.className = "message " + (agent.toLowerCase().includes("gemini") ? "gemini" : "");
  const heading = document.createElement("header");
  heading.textContent = agent + " · Rodada " + round + (status ? " · " + status : "");
  const body = document.createElement("div");
  body.textContent = content;
  article.append(heading, body);
  $("transcript").append(article);
}
$("startDebate").addEventListener("click", async () => {
  const task = $("task").value.trim();
  if (!task) { $("debateStatus").textContent = "Escreva uma tarefa antes de iniciar."; return; }
  const mode = $("providerMode").value;
  const providers = Array.from(document.querySelectorAll('input[name="provider"]:checked')).map(input => input.value);
  if (mode === "selected" && !providers.length) {
    $("debateStatus").textContent = "Selecione pelo menos uma IA que esteja configurada.";
    return;
  }
  controller = new AbortController();
  $("startDebate").disabled = true;
  $("stopDebate").hidden = false;
  $("transcript").replaceChildren();
  $("debateStatus").textContent = mode === "auto" ? "Verificando as IAs configuradas…" : "As IAs selecionadas estão trabalhando…";
  try {
    const response = await fetch(apiUrl("/api/debate"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ task, rounds: Number($("rounds").value), providers, mode }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "Falha no debate");
      error.partialTranscript = data.partialTranscript;
      throw error;
    }
    data.transcript.forEach(message => addMessage(message.agent, message.content, message.round, message.status));
    history.push({ task, transcript: data.transcript });
    $("debateStatus").textContent = data.mode === "single-ai"
      ? "Concluído com uma IA. Nenhuma segunda IA participou desta execução."
      : "Debate concluído com " + data.participants.length + " IAs. Confira as participações no histórico.";
  } catch (error) {
    $("debateStatus").textContent = error.name === "AbortError" ? "Debate interrompido." : error.message;
    (error.partialTranscript || []).forEach(message => addMessage(message.agent, message.content, message.round, message.status));
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
$("loginButton").addEventListener("click", async () => {
  const password = $("accessPassword").value;
  if (!password) { $("loginStatus").textContent = "Digite a senha de acesso."; return; }
  $("loginButton").disabled = true;
  $("loginStatus").textContent = "Verificando acesso…";
  try {
    const response = await fetch(apiUrl("/api/login"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível entrar.");
    accessToken = data.token;
    $("accessPassword").value = "";
    $("loginBox").hidden = true;
    $("debateBox").hidden = false;
    $("loginStatus").textContent = "";
  } catch (error) {
    $("loginStatus").textContent = error.message;
  } finally {
    $("loginButton").disabled = false;
  }
});
$("logoutButton").addEventListener("click", () => {
  accessToken = "";
  if (controller) controller.abort();
  $("debateBox").hidden = true;
  $("loginBox").hidden = false;
  $("transcript").replaceChildren();
  $("debateStatus").textContent = "";
});
refreshHealth();
