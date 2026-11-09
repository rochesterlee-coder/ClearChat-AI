// ClearChat frontend: local chat history + server-verified owner access.
const $ = id => document.getElementById(id);
const CONFIG = window.CLEARCHAT_CONFIG || {};
const API_BASE = (CONFIG.API_BASE_URL || "").replace(/\/$/, "");
const LIMIT = { image: 30, video: 10, browser: 10, code: 50, music: 20 };
let used = JSON.parse(localStorage.getItem("cc_usage") || '{"image":0,"video":0,"browser":0,"code":0,"music":0}');
let supabaseClient = null, recognition = null, toastTimer = null;
let chats = JSON.parse(localStorage.getItem("cc_chats") || "[]");
let currentChatId = null;

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
  loadLatestChat(); renderHistory();
})();

// Chat history is saved locally in this browser. It is not synced between devices.
function saveChats() { localStorage.setItem("cc_chats", JSON.stringify(chats)); renderHistory(); }
function makeChat() {
  const chat = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), title: "New chat", updatedAt: Date.now(), messages: [] };
  chats.unshift(chat); currentChatId = chat.id; saveChats(); renderCurrentChat(); return chat;
}
function currentChat() { return chats.find(c => c.id === currentChatId); }
function renderHistory() {
  const host = $("chatHistory"); if (!host) return;
  host.innerHTML = "";
  chats.sort((a, b) => b.updatedAt - a.updatedAt).forEach(chat => {
    const row = document.createElement("div"); row.className = "history-row" + (chat.id === currentChatId ? " selected" : "");
    const open = document.createElement("button"); open.className = "history-open"; open.textContent = chat.title || "New chat"; open.title = chat.title || "New chat";
    open.onclick = () => { currentChatId = chat.id; renderCurrentChat(); renderHistory(); switchTool("chat"); };
    const del = document.createElement("button"); del.className = "history-delete"; del.textContent = "×"; del.title = "Delete conversation";
    del.onclick = () => { chats = chats.filter(c => c.id !== chat.id); if (currentChatId === chat.id) currentChatId = chats[0]?.id || null; saveChats(); renderCurrentChat(); };
    row.append(open, del); host.appendChild(row);
  });
}
function renderCurrentChat() {
  const messages = $("messages"); messages.innerHTML = "";
  const chat = currentChat();
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
  $("welcome").classList.add("hidden"); appendMessageElement(text, who); saveChats();
}
$("newChat").onclick = () => { makeChat(); $("chatInput").value = ""; switchTool("chat"); $("chatInput").focus(); };

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
function stopCurrentResponse() {
  if (activeChatController) {
    activeChatController.abort();
    activeChatController = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  voiceIsSpeaking = false;
  voiceIsListening = false;
  if (voiceRecognition) {
    try { voiceRecognition.stop(); } catch {}
    voiceRecognition = null;
  }
  setSendState("done");
  updateVoiceControls("Stopped");
  $("status").textContent = "Stopped";
}
function updateVoiceControls(status) {
  const statusEl = $("voiceStatus");
  if (statusEl && status) statusEl.textContent = status;
  const stop = $("voiceStop");
  if (stop) stop.classList.toggle("voice-stop-active", voiceIsListening || voiceIsSpeaking || !!activeChatController);
  const wave = $("voiceWave");
  if (wave) wave.classList.toggle("active", voiceIsListening || voiceIsSpeaking);
}
function openVoiceMode() {
  voiceModeOpen = true;
  $("voiceOverlay").classList.remove("hidden");
  $("voiceTranscript").textContent = "";
  voiceTranscript = "";
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    updateVoiceControls("Voice recognition isn't available in this browser. You can still type below.");
    return;
  }
  try {
    voiceRecognition = new Speech();
    voiceRecognition.lang = $("voiceLang").value;
    voiceRecognition.interimResults = true;
    voiceRecognition.continuous = true;
    voiceIsListening = true;
    updateVoiceControls("Listening… speak now");
    voiceRecognition.onresult = event => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += part;
        else interimText += part;
      }
      if (finalText) voiceTranscript += (voiceTranscript ? " " : "") + finalText.trim();
      $("voiceTranscript").textContent = (voiceTranscript + " " + interimText).trim();
      $("chatInput").value = (voiceTranscript + " " + interimText).trim();
    };
    voiceRecognition.onerror = () => {
      voiceIsListening = false;
      updateVoiceControls("Microphone unavailable. Check browser permission.");
    };
    voiceRecognition.onend = () => {
      voiceIsListening = false;
      voiceRecognition = null;
      if (!voiceIsSpeaking && !activeChatController) updateVoiceControls("Voice input paused");
    };
    voiceRecognition.start();
  } catch {
    voiceIsListening = false;
    updateVoiceControls("Could not start microphone. Check permission.");
  }
}
function closeVoiceMode() {
  if (voiceRecognition) {
    try { voiceRecognition.stop(); } catch {}
    voiceRecognition = null;
  }
  voiceIsListening = false;
  voiceModeOpen = false;
  $("voiceOverlay").classList.add("hidden");
  updateVoiceControls("");
}
function speakReply(text) {
  if (!voiceModeOpen || !("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = $("voiceLang").value;
  utterance.onstart = () => {
    voiceIsSpeaking = true;
    updateVoiceControls("ClearChat is speaking…");
    setSendState("busy");
  };
  utterance.onend = () => {
    voiceIsSpeaking = false;
    updateVoiceControls("Finished");
    setSendState("done");
  };
  utterance.onerror = () => {
    voiceIsSpeaking = false;
    updateVoiceControls("Speech playback ended");
    setSendState("done");
  };
  window.speechSynthesis.speak(utterance);
}
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
    speakReply(reply);
  } catch (err) {
    if (err.name === "AbortError") {
      addMessage("Response stopped.", "assistant");
    } else {
      const reply = "ClearChat's AI is not connected yet. Your message has been saved in chat history. Connect an AI backend when you're ready.";
      addMessage(reply, "assistant");
      speakReply(reply);
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
$("mic").onclick = openVoiceMode;
$("voiceClose").onclick = closeVoiceMode;
$("voiceStop").onclick = () => {
  if (voiceIsListening && voiceRecognition) {
    try { voiceRecognition.stop(); } catch {}
    voiceRecognition = null;
    voiceIsListening = false;
    updateVoiceControls("Voice input stopped");
  } else {
    stopCurrentResponse();
  }
};
$("voiceSend").onclick = () => {
  if (voiceRecognition) {
    try { voiceRecognition.stop(); } catch {}
    voiceRecognition = null;
  }
  voiceIsListening = false;
  const text = $("chatInput").value.trim();
  if (!text) return updateVoiceControls("Say something first");
  sendChatMessage();
};


function saveUsage() { localStorage.setItem("cc_usage", JSON.stringify(used)); updateUsage(); }
function updateUsage() { $("iu").textContent = used.image + " / 30"; $("vu").textContent = used.video + " / 10"; $("im").style.width = Math.min(100, used.image / 30 * 100) + "%"; $("vm").style.width = Math.min(100, used.video / 10 * 100) + "%"; }
function credit(key) { if (used[key] >= LIMIT[key]) { toast("Free " + key + " allowance used. View plans to upgrade."); switchTool("plans"); return false; } used[key]++; saveUsage(); return true; }
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
$("themeSelect").onchange = e => setTheme(e.target.value);
$("saveSettings").onclick = () => { $("settingsModal").classList.add("hidden"); toast("Preferences saved on this device."); };
$("ownerOpen").onclick = () => { $("ownerModal").classList.remove("hidden"); $("ownerCode").value = ""; $("ownerMessage").textContent = ""; };
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => $(b.dataset.close).classList.add("hidden"));
$("verifyOwner").onclick = async () => {
  const button = $("verifyOwner"), message = $("ownerMessage");
  if (!$("ownerCode").value) { message.textContent = "Enter your owner code."; return; }
  button.disabled = true; message.textContent = "Checking private server…";
  try {
    const data = await api("owner/verify", { code: $("ownerCode").value });
    if (data.token) sessionStorage.setItem("cc_owner_token", data.token);
    message.textContent = data.message || "Owner access verified.";
    $("ownerCode").value = "";
  } catch (err) { message.textContent = err.message || "Could not verify owner access. Check that your backend is deployed."; }
  finally { button.disabled = false; }
};
updateUsage();

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && voiceModeOpen) closeVoiceMode();
});
