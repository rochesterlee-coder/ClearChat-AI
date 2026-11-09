// ClearChat frontend: local chat history + server-verified owner access.
const $ = id => document.getElementById(id);
const CONFIG = window.CLEARCHAT_CONFIG || {};
const API_BASE = (CONFIG.API_BASE_URL || "").replace(/\/$/, "");
const LIMIT = { image: 30, video: 10, browser: 10, code: 50, music: 20 };
let used = JSON.parse(localStorage.getItem("cc_usage") || '{"image":0,"video":0,"browser":0,"code":0,"music":0}');
let supabaseClient = null, recognition = null, toastTimer = null;
let chats = JSON.parse(localStorage.getItem("cc_chats") || "[]");
let currentChatId = null;
let temporaryChat = null;
let projects = JSON.parse(localStorage.getItem("cc_projects") || "[]");
let activeProjectFilter = null;

if (window.supabase && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY && !CONFIG.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")) {
  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
}

function toast(message) {
  const el = $("toast"); if (!el) return;
  el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function authScreen(id) { ["authWelcome", "authLocal", "authEmail", "authVerified"].forEach(x => $(x)?.classList.toggle("hidden", x !== id)); }
function enterWorkspace(mode, email = "") {
  $("authGate").classList.add("hidden");
  $("accountLabel").textContent = email || "Local workspace";
  $("profilePlan").textContent = "Free plan · " + (mode === "local" ? "Local device" : "Email verified");
  localStorage.setItem("clearchat_mode", mode);
  if (email) localStorage.setItem("clearchat_email", email); else localStorage.removeItem("clearchat_email");
}
function leaveWorkspace() {
  localStorage.removeItem("clearchat_mode"); localStorage.removeItem("clearchat_email");
  sessionStorage.removeItem("cc_owner_token");
  sessionStorage.removeItem("cc_owner_mode");
  if (supabaseClient) supabaseClient.auth.signOut().catch(() => {});
  $("authGate").classList.remove("hidden"); authScreen("authWelcome");
}

$("localChoice").onclick = () => authScreen("authLocal");
$("emailChoice").onclick = () => authScreen("authEmail");
document.querySelectorAll("[data-auth-back]").forEach(b => b.onclick = () => authScreen("authWelcome"));
$("startLocal").onclick = () => enterWorkspace("local");
$("emailForm").onsubmit = async e => {
  e.preventDefault(); const email = $("email").value.trim(), message = $("formMessage"), button = $("sendButton");
  if (!supabaseClient) { message.textContent = "Supabase is not configured. Add your complete publishable key in config.js."; return; }
  button.disabled = true; button.textContent = "Sending…";
  try {
    const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error; message.textContent = "Verification link sent. Check your inbox and click it to continue.";
  } catch (err) { message.textContent = err.message || "Could not send the verification email."; }
  finally { button.disabled = false; button.textContent = "Send verification email →"; }
};
$("continueVerified").onclick = async () => {
  let user = null; if (supabaseClient) { const r = await supabaseClient.auth.getUser(); user = r.data.user; }
  enterWorkspace("email", user?.email || localStorage.getItem("clearchat_email") || "Verified account");
};
$("signOutButton").onclick = leaveWorkspace;

(async () => {
  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session?.user) { enterWorkspace("email", data.session.user.email || ""); if (location.search || location.hash) history.replaceState({}, document.title, location.pathname); }
    else if (new URLSearchParams(location.search).has("code") || location.hash.includes("access_token")) authScreen("authVerified");
  }
  if (localStorage.getItem("clearchat_mode") === "local") enterWorkspace("local");
  else if (!supabaseClient || !(await supabaseClient.auth.getSession()).data.session) {
    $("authGate").classList.remove("hidden");
    if (new URLSearchParams(location.search).get("verified") === "1") authScreen("authVerified");
  }
  renderProjects();
loadLatestChat(); renderHistory();
})();

// Chat history is saved locally in this browser. It is not synced between devices.
function saveChats() { localStorage.setItem("cc_chats", JSON.stringify(chats)); renderHistory(); }
function makeChat(isTemporary = false) {
  if (isTemporary) {
    temporaryChat = { id: "temp-" + Date.now(), title: "Temporary chat", updatedAt: Date.now(), messages: [], temporary: true, pinned: false };
    currentChatId = temporaryChat.id;
    renderCurrentChat();
    renderHistory();
    return temporaryChat;
  }
  temporaryChat = null;
  const chat = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), title: "New chat", updatedAt: Date.now(), messages: [], pinned: false };
  chats.unshift(chat); currentChatId = chat.id; saveChats(); renderCurrentChat(); return chat;
}
function currentChat() {
  if (temporaryChat && temporaryChat.id === currentChatId) return temporaryChat;
  return chats.find(c => c.id === currentChatId);
}
function saveProjects() {
  localStorage.setItem("cc_projects", JSON.stringify(projects));
  renderProjects();
}
function renderProjects() {
  const host = $("projectList");
  if (!host) return;
  host.innerHTML = "";
  const all = document.createElement("button");
  all.className = "project-item" + (activeProjectFilter === null ? " active" : "");
  all.textContent = "▦  All projects";
  all.onclick = () => { activeProjectFilter = null; renderProjects(); renderHistory(); };
  host.appendChild(all);
  projects.forEach(project => {
    const item = document.createElement("button");
    item.className = "project-item" + (activeProjectFilter === project.id ? " active" : "");
    item.textContent = "▰  " + project.name;
    item.title = project.name;
    item.onclick = () => { activeProjectFilter = project.id; renderProjects(); renderHistory(); };
    host.appendChild(item);
  });
}
function createProject() {
  const name = prompt("Name your project:");
  if (!name || !name.trim()) return;
  const project = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), name: name.trim().slice(0, 40), createdAt: Date.now() };
  projects.push(project);
  saveProjects();
  activeProjectFilter = project.id;
  renderHistory();
  toast("Project created.");
}
$("newProject")?.addEventListener("click", createProject);

function closeChatMenus(except) {
  document.querySelectorAll(".chat-menu").forEach(menu => {
    if (menu !== except) menu.classList.add("hidden");
  });
}
function renderHistory() {
  const host = $("chatHistory"); if (!host) return;
  host.innerHTML = "";
  const filtered = activeProjectFilter === null
    ? chats
    : chats.filter(c => c.projectId === activeProjectFilter);
  const ordered = filtered.slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  ordered.forEach(chat => {
    const row = document.createElement("div");
    row.className = "history-row" + (chat.id === currentChatId ? " selected" : "");
    const open = document.createElement("button");
    open.className = "history-open";
    open.textContent = (chat.pinned ? "📌 " : "") + (chat.title || "New chat");
    open.title = chat.title || "New chat";
    open.onclick = () => {
      temporaryChat = null; currentChatId = chat.id;
      renderCurrentChat(); renderHistory(); switchTool("chat");
    };

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const pin = document.createElement("button");
    pin.className = "history-pin";
    pin.textContent = chat.pinned ? "📌" : "☆";
    pin.title = chat.pinned ? "Unpin chat" : "Pin chat";
    pin.setAttribute("aria-label", pin.title);
    pin.onclick = e => { e.stopPropagation(); chat.pinned = !chat.pinned; saveChats(); };

    const more = document.createElement("button");
    more.className = "history-more";
    more.textContent = "•••";
    more.title = "Chat options";
    more.setAttribute("aria-label", "Chat options");
    const menu = document.createElement("div");
    menu.className = "chat-menu hidden";

    const addMenuAction = (label, action, danger = false) => {
      const button = document.createElement("button");
      button.className = "chat-menu-item" + (danger ? " danger" : "");
      button.textContent = label;
      button.onclick = e => { e.stopPropagation(); menu.classList.add("hidden"); action(); };
      menu.appendChild(button);
    };
    addMenuAction("✎  Rename", () => {
      const name = prompt("Rename chat:", chat.title || "");
      if (name && name.trim()) { chat.title = name.trim().slice(0, 80); chat.updatedAt = Date.now(); saveChats(); }
    });
    addMenuAction(chat.pinned ? "📌  Unpin" : "📌  Pin", () => {
      chat.pinned = !chat.pinned; saveChats();
    });
    if (projects.length) {
      const moveLabel = document.createElement("div");
      moveLabel.className = "chat-menu-label";
      moveLabel.textContent = "Move to project";
      menu.appendChild(moveLabel);
      projects.forEach(project => addMenuAction("▰  " + project.name, () => {
        chat.projectId = project.id; saveChats();
        if (currentChatId === chat.id && activeProjectFilter !== null) {
          activeProjectFilter = project.id;
        }
        renderProjects(); renderHistory();
      }));
      if (chat.projectId) addMenuAction("↩  Remove from project", () => {
        delete chat.projectId;
        if (activeProjectFilter !== null) activeProjectFilter = null;
        saveChats(); renderProjects(); renderHistory();
      });
    }
    addMenuAction("🗑  Delete", () => {
      if (!confirm("Delete this chat? This cannot be undone.")) return;
      chats = chats.filter(c => c.id !== chat.id);
      if (currentChatId === chat.id) { currentChatId = null; temporaryChat = null; }
      saveChats(); renderCurrentChat();
    }, true);

    more.onclick = e => {
      e.stopPropagation();
      const opening = menu.classList.contains("hidden");
      closeChatMenus(menu);
      menu.classList.toggle("hidden", !opening);
    };
    actions.append(pin, more);
    row.append(open, actions, menu);
    host.appendChild(row);
  });
}
document.addEventListener("click", () => closeChatMenus());
function renderCurrentChat() {
  const messages = $("messages"); messages.innerHTML = "";
  const chat = currentChat();
  $("temporaryChatNotice")?.classList.toggle("hidden", !chat?.temporary);
  $("welcome").classList.toggle("hidden", !!(chat && chat.messages.length));
  if (!chat) return;
  chat.messages.forEach(m => appendMessageElement(m.text, m.who));
}
function loadLatestChat() {
  const latest = chats.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
  currentChatId = latest?.id || null; renderCurrentChat();
}
function appendMessageElement(text, who) {
  const div = document.createElement("div"); div.className = "message " + who; div.textContent = text;
  $("messages").appendChild(div); div.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function addMessage(text, who) {
  let chat = currentChat() || makeChat();
  chat.messages.push({ text, who, at: Date.now() }); chat.updatedAt = Date.now();
  if (who === "user" && chat.title === "New chat") chat.title = text.slice(0, 36) + (text.length > 36 ? "…" : "");
  $("welcome").classList.add("hidden"); appendMessageElement(text, who);
  if (chat.temporary) renderHistory(); else saveChats();
}
$("newChat").onclick = () => { makeChat(false); $("chatInput").value = ""; switchTool("chat"); $("chatInput").focus(); };
$("newTemporaryChat").onclick = () => { makeChat(true); $("chatInput").value = ""; switchTool("chat"); $("chatInput").focus(); };

function switchTool(tool) {
  document.querySelectorAll(".view").forEach(x => x.classList.add("hidden"));
  $(tool + "View").classList.remove("hidden");
  document.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("active", x.dataset.tool === tool));
  $("crumb").textContent = ({ chat: "AI Chat", image: "Image Studio", video: "Video Studio", code: "Code Studio", music: "Music Studio", browser: "Browser Assistant", plans: "Plans" })[tool] || "Workspace";
  $("sidebar").classList.remove("open");
}
document.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => switchTool(b.dataset.tool));
$("mobile").onclick = () => $("sidebar").classList.toggle("open");
document.querySelectorAll("[data-prompt]").forEach(b => b.onclick = () => { $("chatInput").value = b.dataset.prompt; $("chatInput").focus(); });
async function api(path, body) {
  const response = await fetch(`${API_BASE}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}
let activeChatController = null;
let voiceModeOpen = false;
let voiceRecognition = null;
let voiceTranscript = "";
let voiceIsListening = false;
let voiceIsSpeaking = false;
let voiceAudioContext = null;
let voiceAnalyser = null;
let voiceMediaStream = null;
let voiceMeterFrame = 0;

function setSendState(state) {
  const button = $("send");
  if (!button) return;
  if (state === "busy") {
    button.textContent = "■";
    button.setAttribute("aria-label", "Stop response");
    button.classList.add("send-stop");
  } else if (state === "done") {
    button.textContent = "✨";
    button.setAttribute("aria-label", "Ready for another message");
    button.classList.remove("send-stop");
  } else {
    button.textContent = "↑";
    button.setAttribute("aria-label", "Send message");
    button.classList.remove("send-stop");
  }
}
function stopVoiceMeter() {
  if (voiceMeterFrame) cancelAnimationFrame(voiceMeterFrame);
  voiceMeterFrame = 0;
  if (voiceMediaStream) voiceMediaStream.getTracks().forEach(track => track.stop());
  voiceMediaStream = null;
  if (voiceAudioContext) voiceAudioContext.close().catch(() => {});
  voiceAudioContext = null;
  voiceAnalyser = null;
  $("voiceWave")?.classList.remove("active");
  $("voiceWave")?.style.removeProperty("--voice-level");
}
async function startVoiceMeter() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = voiceAudioContext.createMediaStreamSource(voiceMediaStream);
    voiceAnalyser = voiceAudioContext.createAnalyser();
    voiceAnalyser.fftSize = 256;
    source.connect(voiceAnalyser);
    const data = new Uint8Array(voiceAnalyser.frequencyBinCount);
    const meter = () => {
      if (!voiceAnalyser || !voiceModeOpen) return;
      voiceAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, Math.max(0, (rms - 0.012) * 12));
      const wave = $("voiceWave");
      if (wave) {
        wave.classList.toggle("active", level > 0.035);
        wave.style.setProperty("--voice-level", String(level));
      }
      voiceMeterFrame = requestAnimationFrame(meter);
    };
    meter();
  } catch {
    $("voiceStatus").textContent = "Microphone permission is needed for live sound waves.";
  }
}
function setSendState(state) {
  const button = $("send");
  if (!button) return;
  if (state === "busy") {
    button.textContent = "■";
    button.setAttribute("aria-label", "Stop response");
    button.classList.add("send-stop");
  } else if (state === "done") {
    button.textContent = "✨";
    button.setAttribute("aria-label", "Ready for another message");
    button.classList.remove("send-stop");
  } else {
    button.textContent = "↑";
    button.setAttribute("aria-label", "Send message");
    button.classList.remove("send-stop");
  }
}
function updateVoiceControls(status) {
  if (status && $("voiceStatus")) $("voiceStatus").textContent = status;
  const stop = $("voiceStop");
  if (stop) stop.classList.toggle("voice-stop-active", voiceIsListening);
}
function openVoiceMode() {
  voiceModeOpen = true;
  $("voiceBar").classList.remove("hidden");
  voiceTranscript = $("chatInput").value.trim();
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    updateVoiceControls("Voice recognition isn't supported in this browser.");
    return;
  }
  startVoiceMeter();
  try {
    voiceRecognition = new Speech();
    voiceRecognition.lang = $("voiceLang").value;
    voiceRecognition.interimResults = true;
    voiceRecognition.continuous = true;
    voiceIsListening = true;
    updateVoiceControls("Listening… speak whenever you're ready.");
    voiceRecognition.onresult = event => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += part;
        else interimText += part;
      }
      if (finalText) voiceTranscript += (voiceTranscript ? " " : "") + finalText.trim();
      $("chatInput").value = (voiceTranscript + " " + interimText).trim();
      if ((finalText + interimText).trim()) updateVoiceControls("Hearing you…");
    };
    voiceRecognition.onerror = event => {
      voiceIsListening = false;
      updateVoiceControls(event.error === "not-allowed" ? "Allow microphone access in your browser." : "Microphone paused. You can still edit the text.");
    };
    voiceRecognition.onend = () => {
      voiceIsListening = false;
      updateVoiceControls("Voice paused — your words are in the message box.");
    };
    voiceRecognition.start();
  } catch {
    voiceIsListening = false;
    updateVoiceControls("Could not start microphone. Check browser permission.");
  }
}
function stopVoiceInput() {
  if (voiceRecognition) {
    try { voiceRecognition.stop(); } catch {}
    voiceRecognition = null;
  }
  voiceIsListening = false;
  stopVoiceMeter();
  updateVoiceControls("Stopped. Your words are in the message box.");
}
function closeVoiceMode() {
  stopVoiceInput();
  voiceModeOpen = false;
  $("voiceBar").classList.add("hidden");
  $("chatInput").focus();
}
// Voice input is speech-to-text only. ClearChat does not read replies aloud.
function speakReply() {}

async function sendChatMessage() {
  const prompt = $("chatInput").value.trim();
  if (!prompt || activeChatController) return;
  $("chatInput").value = "";
  addMessage(prompt, "user");
  $("status").textContent = "Thinking…";
  setSendState("busy");
  activeChatController = new AbortController();
  const controller = activeChatController;
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, language: $("voiceLang").value }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
    const reply = data.reply || "No reply returned.";
    addMessage(reply, "assistant");

  } catch (err) {
    if (err.name === "AbortError") {
      addMessage("Response stopped.", "assistant");
    } else {
      const reply = "ClearChat's AI is not connected yet. Your message has been saved in chat history. Connect an AI backend when you're ready.";
      addMessage(reply, "assistant");
  
    }
  } finally {
    if (activeChatController === controller) activeChatController = null;
    $("status").textContent = "AI provider pending backend setup";
    if (!voiceIsSpeaking) setSendState("done");
    updateVoiceControls(voiceIsSpeaking ? "ClearChat is speaking…" : "Finished");
  }
}
$("send").onclick = () => {
  if (activeChatController || voiceIsSpeaking) return stopCurrentResponse();
  if ($("send").textContent === "✨") { $("chatInput").focus(); setSendState("ready"); return; }
  sendChatMessage();
};
$("chatInput").oninput = () => { if (!activeChatController && !voiceIsSpeaking) setSendState("ready"); };
$("chatInput").onkeydown = e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (activeChatController || voiceIsSpeaking) stopCurrentResponse();
    else sendChatMessage();
  }
};
$("mic").onclick = () => voiceModeOpen ? closeVoiceMode() : openVoiceMode();
$("voiceClose").onclick = closeVoiceMode;
$("voiceStop").onclick = stopVoiceInput;
$("voiceSend").onclick = () => {
  stopVoiceInput();
  const transcript = $("chatInput").value.trim();
  closeVoiceMode();
  if (transcript) sendChatMessage();
  else toast("Say something first.");
};

function saveUsage() { localStorage.setItem("cc_usage", JSON.stringify(used)); applyDisplayName(localStorage.getItem("cc_display_name") || "");
updateUsage(); }
function updateUsage() {
  if (isOwnerMode()) {
    $("iu").textContent = "Unlimited";
    $("vu").textContent = "Unlimited";
    $("im").style.width = "100%"; $("vm").style.width = "100%";
    return;
  }
  $("iu").textContent = used.image + " / 30"; $("vu").textContent = used.video + " / 10";
  $("im").style.width = Math.min(100, used.image / 30 * 100) + "%";
  $("vm").style.width = Math.min(100, used.video / 10 * 100) + "%";
}
function isOwnerMode() { return sessionStorage.getItem("cc_owner_mode") === "enabled"; }
function credit(key) {
  if (isOwnerMode()) return true;
  if (used[key] >= LIMIT[key]) { toast("Free " + key + " allowance used. View plans to upgrade."); switchTool("plans"); return false; }
  used[key]++; saveUsage(); return true;
}
async function generate(kind, promptId, outputId, extra = {}) {
  const prompt = $(promptId).value.trim(); if (!prompt) return toast("Describe what you want first."); if (!credit(kind)) return;
  $(outputId).textContent = "Preparing request…";
  try {
    const data = await api(kind, { prompt, ...extra });
    if (data.image_url) $(outputId).innerHTML = `<img src="${data.image_url}" alt="Generated image" style="max-width:100%;border-radius:10px">`;
    else if (data.video_url) $(outputId).innerHTML = `<video controls src="${data.video_url}" style="max-width:100%"></video>`;
    else if (data.audio_url) $(outputId).innerHTML = `<audio controls src="${data.audio_url}"></audio>`;
    else $(outputId).textContent = data.message || "Provider returned a result.";
  } catch (err) { $(outputId).textContent = "Provider not connected: " + err.message; }
}
$("makeImage").onclick = () => generate("image", "imagePrompt", "imageOut", { style: $("imageStyle").value });
$("makeVideo").onclick = () => generate("video", "videoPrompt", "videoOut", { duration: $("videoLength").value });
$("makeMusic").onclick = () => generate("music", "musicPrompt", "musicOut", { genre: $("genre").value });
$("makeCode").onclick = async () => {
  const prompt = $("codePrompt").value.trim(); if (!prompt) return toast("Describe the code first."); if (!credit("code")) return;
  $("codeOut").classList.remove("hidden"); $("codeOut").querySelector("code").textContent = "Generating…";
  try { const data = await api("code", { prompt, language: $("codeLang").value }); $("codeOut").querySelector("code").textContent = data.code || "No code returned."; }
  catch (err) { $("codeOut").querySelector("code").textContent = "// Backend not connected\n// " + err.message; }
};
$("copyCode").onclick = async () => { try { await navigator.clipboard.writeText($("codeOut").querySelector("code").textContent); toast("Copied."); } catch { toast("Clipboard permission unavailable."); } };
$("planBrowser").onclick = async () => {
  const prompt = $("browserPrompt").value.trim(); if (!prompt) return toast("Describe the browser task first."); if (!credit("browser")) return;
  $("browserOut").classList.remove("hidden"); $("browserOut").textContent = "Preparing a safe action plan…";
  try { const data = await api("browser", { prompt }); $("browserOut").textContent = (data.steps || []).join("\n") || data.message || "No action plan returned."; }
  catch { $("browserOut").textContent = "This starter can preview plans, but browser automation is not connected."; }
};

const planData = [["Free", "RM0", ["Unlimited chat", "30 images", "10 videos", "10 browser prompts", "50 code generations", "20 songs"]], ["Go", "RM3", ["Paid tier preview", "More room to create"]], ["Plus", "RM10", ["Paid tier preview", "Expanded workspace"]], ["Pro", "RM30", ["Paid tier preview", "Advanced workspace"]], ["Ultra", "RM50", ["Paid tier preview", "Top-tier workspace"]]];
$("plans").innerHTML = planData.map((p, i) => `<article class="plan-card ${i === 2 ? "featured" : ""}"><h3>${p[0]}</h3><div class="price">${p[1]}<small> / month</small></div><p>${p[2].join("<br>• ")}</p><button data-plan="${p[0]}">${i ? "Select " + p[0] : "Current plan"}</button></article>`).join("");
$("plans").onclick = e => { const button = e.target.closest("[data-plan]"); if (button && button.dataset.plan !== "Free") toast("Secure checkout is not configured. No payment has been taken."); };
function setTheme(theme) { document.body.dataset.theme = theme; localStorage.setItem("cc_theme", theme); $("themeSelect").value = theme; }
setTheme(localStorage.getItem("cc_theme") || "dark");
$("themeQuick").onclick = () => { const options = ["dark", "black", "light", "white", "midnight"]; setTheme(options[(options.indexOf(document.body.dataset.theme) + 1) % options.length]); toast("Theme: " + document.body.dataset.theme); };
$("settingsOpen").onclick = () => $("settingsModal").classList.remove("hidden");

function applyDisplayName(name) {
  const clean = (name || "").trim().slice(0, 32);
  if (clean) localStorage.setItem("cc_display_name", clean);
  else localStorage.removeItem("cc_display_name");
  const label = clean || localStorage.getItem("clearchat_email") || "Local workspace";
  $("accountLabel").textContent = label;
  const avatar = document.querySelector(".profile .avatar");
  if (avatar) avatar.textContent = (label.trim()[0] || "C").toUpperCase();
  if ($("displayNameInput")) $("displayNameInput").value = clean;
}
$("settingsOpen").addEventListener("click", () => {
  if ($("displayNameInput")) $("displayNameInput").value = localStorage.getItem("cc_display_name") || "";
});
$("saveDisplayName").onclick = () => {
  applyDisplayName($("displayNameInput").value);
  toast("Display name saved on this device.");
};

$("themeSelect").onchange = e => setTheme(e.target.value);
$("saveSettings").onclick = () => { $("settingsModal").classList.add("hidden"); toast("Preferences saved on this device."); };
$("ownerOpen").onclick = () => { $("ownerModal").classList.remove("hidden"); $("ownerCode").value = ""; $("ownerMessage").textContent = ""; };
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => $(b.dataset.close).classList.add("hidden"));
$("verifyOwner").onclick = () => {
  const message = $("ownerMessage");
  const entered = $("ownerCode").value;
  if (entered === "Shuowei") {
    sessionStorage.setItem("cc_owner_mode", "enabled");
    message.textContent = "Owner mode enabled on this browser. Usage limits are bypassed.";
    $("ownerCode").value = "";
    updateUsage();
    toast("Owner mode enabled.");
  } else {
    sessionStorage.removeItem("cc_owner_mode");
    message.textContent = "Incorrect owner code.";
  }
};

applyDisplayName(localStorage.getItem("cc_display_name") || "");
updateUsage();

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && voiceModeOpen) closeVoiceMode();
});
