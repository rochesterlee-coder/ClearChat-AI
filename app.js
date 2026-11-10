// ClearChat frontend: local chat history + server-verified owner access.
const $ = id => document.getElementById(id);
const CONFIG = window.CLEARCHAT_CONFIG || {};
const API_BASE = (CONFIG.API_BASE_URL || "").replace(/\/$/, "");
const PLAN_LIMITS = {
  Free:  { image: 30,  video: 10,  browser: 10,  code: 50,  music: 20 },
  Go:    { image: 50,  video: 20,  browser: 50,  code: 100, music: 30 },
  Plus:  { image: 70,  video: 50,  browser: 70,  code: 150, music: 40 },
  Pro:   { image: 100, video: 100, browser: 150, code: 200, music: 100 },
  Ultra: { image: Infinity, video: Infinity, browser: Infinity, code: Infinity, music: Infinity }
};
let currentPlan = PLAN_LIMITS[localStorage.getItem("cc_plan")] ? localStorage.getItem("cc_plan") : "Free";
let LIMIT = PLAN_LIMITS[currentPlan];
let used = JSON.parse(localStorage.getItem("cc_usage") || '{"image":0,"video":0,"browser":0,"code":0,"music":0}');
let usageResetAt = Number(localStorage.getItem("cc_usage_reset_at") || 0);
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
const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
const regionNames = new Intl.DisplayNames([navigator.language || "en"], { type: "region" });
function setupLocationPicker() {
  const country = $("countrySelect"), zone = $("timezoneSelect");
  if (!country || !zone || country.options.length) return;
  COUNTRY_CODES.map(code => [regionNames.of(code), code]).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([name,code]) => {
    const option=document.createElement("option"); option.value=code; option.textContent=name; country.appendChild(option);
  });
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : ["Etc/UTC"];
  zones.forEach(tz => { const o=document.createElement("option"); o.value=tz; o.textContent=tz.replaceAll("_"," "); zone.appendChild(o); });
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  zone.value = detected;
  const detectedCountry = detected === "Asia/Kuala_Lumpur" ? "MY" : detected.split("/")[0] === "America" ? "US" : detected.split("/")[0] === "Europe" ? "GB" : "MY";
  country.value = detectedCountry;
  const saved = localStorage.getItem("cc_timezone");
  if (saved && zones.includes(saved)) zone.value = saved;
  const savedCountry = localStorage.getItem("cc_country");
  if (savedCountry && COUNTRY_CODES.includes(savedCountry)) country.value=savedCountry;
}
function showStartupLocation() {
  setupLocationPicker();
  const saved = localStorage.getItem("cc_timezone");
  if (saved) authScreen("authWelcome");
  else { ["authWelcome","authLocal","authEmail","authVerified"].forEach(id=>$(id)?.classList.add("hidden")); $("locationSetup")?.classList.remove("hidden"); }
}
$("saveLocation")?.addEventListener("click", () => {
  const country=$("countrySelect")?.value, timezone=$("timezoneSelect")?.value;
  if (!country || !timezone) return toast("Choose your country and time zone first.");
  localStorage.setItem("cc_country",country);
  localStorage.setItem("cc_timezone",timezone);
  $("locationSetup")?.classList.add("hidden");
  authScreen("authWelcome");
});

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
  showStartupLocation();
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
    const row = document.createElement("div"); row.className = "project-row";
    const item = document.createElement("button");
    item.className = "project-item" + (activeProjectFilter === project.id ? " active" : "");
    item.textContent = "▰  " + project.name; item.title = project.name;
    item.onclick = () => { activeProjectFilter = project.id; renderProjects(); renderHistory(); };
    const more = document.createElement("button"); more.className = "project-more"; more.textContent = "•••"; more.title = "Project options";
    more.onclick = e => {
      e.stopPropagation();
      const choice = prompt("Project options: type R to rename or D to delete", "R");
      if (!choice) return;
      if (choice.toLowerCase() === "r") {
        const name = prompt("Rename project:", project.name);
        if (name && name.trim()) { project.name = name.trim().slice(0,40); saveProjects(); renderHistory(); toast("Project renamed."); }
      } else if (choice.toLowerCase() === "d") {
        if (!confirm(`Delete project \"${project.name}\"? Chats will stay in All projects.`)) return;
        projects = projects.filter(x => x.id !== project.id);
        chats.forEach(chat => { if (chat.projectId === project.id) delete chat.projectId; });
        if (activeProjectFilter === project.id) activeProjectFilter = null;
        saveChats(); saveProjects(); renderHistory(); toast("Project deleted. Chats were kept.");
      }
    };
    row.append(item, more); host.appendChild(row);
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
  chat.messages.forEach(m => appendMessageElement(m.text, m.who, m.attachments || []));
}
function loadLatestChat() {
  const latest = chats.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
  currentChatId = latest?.id || null; renderCurrentChat();
}
function appendMessageElement(text, who, attachments = []) {
  const div = document.createElement("div"); div.className = "message " + who;
  if (text) { const body = document.createElement("div"); body.textContent = text; div.appendChild(body); }
  if (attachments.length) {
    const list = document.createElement("div"); list.className = "message-attachments";
    attachments.forEach(file => {
      const item = document.createElement("div"); item.className = "message-file";
      if (file.type && file.type.startsWith("image/") && file.id) {
        getStoredAttachment(file.id).then(blob => { if (blob) { const img = document.createElement("img"); img.src = URL.createObjectURL(blob); img.alt = file.name; item.prepend(img); } });
      }
      const label = document.createElement("span"); label.textContent = file.name + (file.size ? " · " + formatFileSize(file.size) : ""); item.appendChild(label); list.appendChild(item);
    });
    div.appendChild(list);
  }
  $("messages").appendChild(div); div.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function formatFileSize(bytes) { if (bytes < 1024) return bytes + " B"; if (bytes < 1048576) return (bytes/1024).toFixed(1)+" KB"; return (bytes/1048576).toFixed(1)+" MB"; }

function addMessage(text, who, attachments = []) {
  let chat = currentChat() || makeChat();
  chat.messages.push({ text, who, attachments, at: Date.now() }); chat.updatedAt = Date.now();
  if (who === "user" && chat.title === "New chat") { const title = text || (attachments[0]?.name || "Attached files"); chat.title = title.slice(0, 36) + (title.length > 36 ? "…" : ""); }
  $("welcome").classList.add("hidden"); appendMessageElement(text, who, attachments);
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
async function api(path, body, signal) {
  if (!API_BASE) throw new Error("AI backend is not connected yet. Set API_BASE_URL in config.js.");
  const response = await fetch(`${API_BASE}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
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

// Attachments are kept in the current browser's local chat history.
let pendingAttachments = [];
let attachmentDBPromise;
function attachmentDB() {
  if (!window.indexedDB) return Promise.reject(new Error("This browser does not support local file storage."));
  if (!attachmentDBPromise) attachmentDBPromise = new Promise((resolve,reject) => {
    const request = indexedDB.open("ClearChatAttachments",1);
    request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath:"id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return attachmentDBPromise;
}
async function storeAttachment(id, blob) {
  const db = await attachmentDB();
  return new Promise((resolve,reject) => { const tx=db.transaction("files","readwrite"); tx.objectStore("files").put({id,blob}); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
}
async function getStoredAttachment(id) {
  const db = await attachmentDB();
  return new Promise((resolve,reject) => { const req=db.transaction("files","readonly").objectStore("files").get(id); req.onsuccess=()=>resolve(req.result?.blob || null); req.onerror=()=>reject(req.error); });
}
function renderPendingAttachments() {
  const host = $("attachmentPreview"); if (!host) return; host.innerHTML = "";
  pendingAttachments.forEach((file, index) => {
    const chip = document.createElement("div"); chip.className = "attachment-chip";
    const name = document.createElement("span"); name.textContent = file.name;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = "Remove attachment";
    remove.onclick = () => { pendingAttachments.splice(index,1); renderPendingAttachments(); };
    chip.append(name, remove); host.appendChild(chip);
  });
  host.classList.toggle("hidden", !pendingAttachments.length);
}
function addFiles(fileList) {
  const files = Array.from(fileList || []);
  const maxFileSize = 15 * 1024 * 1024;
  files.forEach(file => {
    if (file.size > maxFileSize) { toast(file.name + " is over 15 MB and was skipped."); return; }
    if (pendingAttachments.length >= 10) { toast("You can attach up to 10 files per message."); return; }
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    storeAttachment(id, file).then(() => {
      pendingAttachments.push({ id, name:file.name, type:file.type || "application/octet-stream", size:file.size });
      renderPendingAttachments();
    }).catch(() => toast("Could not store " + file.name + " in this browser."));
  });
}
$("attachButton")?.addEventListener("click", () => $("filePicker").click());
$("filePicker")?.addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
$("chatInput")?.addEventListener("paste", e => {
  const items = Array.from(e.clipboardData?.items || []);
  const images = items.filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
  if (images.length) { e.preventDefault(); addFiles(images); toast("Screenshot pasted as an attachment."); }
});
$("chatInput")?.addEventListener("dragover", e => e.preventDefault());
$("chatInput")?.addEventListener("drop", e => { e.preventDefault(); addFiles(e.dataTransfer?.files); });

function detectChatTool(prompt) {
  const text = prompt.toLowerCase();
  // More specific media/code intents are checked before general chat.
  if (/\b(make|create|generate|draw|design)\b.{0,45}\b(video|clip|animation|short film)\b|\b(video|clip|animation)\b.{0,35}\b(of|about|showing|where)\b/.test(text)) return "video";
  if (/\b(make|create|generate|compose|write)\b.{0,45}\b(song|music|soundtrack|jingle|beat|melody|instrumental|audio track)\b|\b(song|soundtrack|instrumental)\b.{0,35}\b(about|for|with)\b/.test(text)) return "music";
  if (/\b(generate|make|create|draw|design|show me)\b.{0,45}\b(image|picture|photo|illustration|wallpaper|logo|poster|artwork)\b|\b(image|picture|photo|illustration|wallpaper)\b.{0,25}\b(of|showing|for)\b/.test(text)) return "image";
  if (/\b(write|generate|create|build|debug|fix|code|program|script|function|website|html|css|javascript|python)\b/.test(text) && /\b(code|python|javascript|java|html|css|program|script|function|bug|error|website|app)\b/.test(text)) return "code";
  if (/\b(search the web|browse|look up|find online|latest news|current news|search online|research online)\b/.test(text)) return "browser";
  return "chat";
}
function detectCodeLanguage(prompt) {
  const t = prompt.toLowerCase();
  for (const name of ["python","javascript","typescript","java","c++","c#","html","css","sql","php","ruby","go","rust"]) {
    if (t.includes(name)) return name;
  }
  return "Python";
}
function canUseFeature(key) {
  resetExpiredUsageWindow();
  if (isOwnerMode()) return true;
  if (used[key] < LIMIT[key]) return true;
  toast((currentPlan === "Free" ? "Free plan limit reached." : currentPlan + " plan limit reached.") + " See your usage counters in the sidebar.");
  return false;
}
function appendToolCard(label, data, kind) {
  const host = $("messages").lastElementChild;
  if (!host) return;
  host.classList.add("tool-message");
  const card = document.createElement("div"); card.className = "tool-result";
  const heading = document.createElement("div"); heading.className = "tool-label"; heading.textContent = label; card.appendChild(heading);
  const mediaUrl = data.image_url || data.video_url || data.audio_url || data.url;
  if (kind === "image" && mediaUrl) {
    const img = document.createElement("img"); img.src = mediaUrl; img.alt = "Generated image"; card.appendChild(img);
  } else if (kind === "video" && mediaUrl) {
    const video = document.createElement("video"); video.src = mediaUrl; video.controls = true; card.appendChild(video);
  } else if (kind === "music" && mediaUrl) {
    const audio = document.createElement("audio"); audio.src = mediaUrl; audio.controls = true; card.appendChild(audio);
  } else if (kind === "code") {
    const pre = document.createElement("pre"); pre.textContent = data.code || data.output || "No code was returned."; card.appendChild(pre);
    const copy = document.createElement("button"); copy.className = "secondary"; copy.textContent = "Copy code";
    copy.onclick = async () => { try { await navigator.clipboard.writeText(pre.textContent); toast("Code copied."); } catch { toast("Clipboard permission unavailable."); } };
    card.appendChild(copy);
  } else {
    const note = document.createElement("p"); note.textContent = data.message || data.reply || "The provider returned a result."; card.appendChild(note);
  }
  host.appendChild(card); card.scrollIntoView({behavior:"smooth",block:"nearest"});
}
async function runChatTool(kind, prompt) {
  if (kind === "chat") {
    const data = await api("chat", { message: prompt, language: $("voiceLang").value }, activeChatController?.signal);
    addMessage(data.reply || "No reply returned.", "assistant");
    return;
  }
  if (!canUseFeature(kind)) { addMessage("You've reached your " + currentPlan + " plan limit for " + kind + ". Check the usage panel in the sidebar.", "assistant"); return; }
  const body = { prompt };
  if (kind === "code") body.language = detectCodeLanguage(prompt);
  if (kind === "image") body.style = "Photorealistic";
  if (kind === "video") { const match = prompt.match(/\b(5|10|15|20|30)\s*(?:-| )?seconds?\b/i); body.duration = match ? match[1] + " seconds" : "5 seconds"; }
  if (kind === "music") body.genre = "Ambient";
  if (kind === "browser") {
    const data = await api("browser", { prompt }, activeChatController?.signal);
    addMessage("Here is a browser action plan. Review each step and carry it out yourself; this version does not control your browser.\n\n" + ((data.steps || []).join("\n") || data.message || "No steps returned."), "assistant");
    const host = $("messages").lastElementChild; host.classList.add("tool-message");
    const card = document.createElement("div"); card.className = "tool-result";
    const label = document.createElement("div"); label.className = "tool-label"; label.textContent = "BROWSER ASSISTANT"; card.appendChild(label);
    const pre = document.createElement("pre"); pre.textContent = (data.steps || []).join("\n") || data.message || "No steps returned."; card.appendChild(pre); host.appendChild(card);
    credit("browser"); return;
  }
  const data = await api(kind, body, activeChatController?.signal);
  const labels = {image:"IMAGE GENERATION",video:"VIDEO GENERATION",code:"CODE GENERATION",music:"MUSIC GENERATION"};
  const summary = {image:"Your image request is ready.",video:"Your video request is ready.",code:"Here's the code.",music:"Your music request is ready."};
  addMessage(kind === "code" ? (data.code || data.output || summary[kind]) : (data.message || summary[kind]), "assistant");
  appendToolCard(labels[kind], data, kind);
  credit(kind);
}
async function sendChatMessage() {
  const prompt = $("chatInput").value.trim();
  if ((!prompt && !pendingAttachments.length) || activeChatController) return;
  const attached = pendingAttachments.slice(); pendingAttachments = []; renderPendingAttachments();
  $("chatInput").value = "";
  addMessage(prompt, "user", attached);
  if (!prompt && attached.length) { addMessage("Your files are attached to this conversation. File reading and image understanding need to be connected to the AI backend before ClearChat can analyse them.", "assistant"); return; }
  const kind = detectChatTool(prompt);
  const names = {chat:"AI Chat",image:"Image Studio",video:"Video Studio",code:"Code Studio",music:"Music Studio",browser:"Browser Assistant"};
  $("status").textContent = kind === "chat" ? "Thinking…" : "Using " + names[kind] + "…";
  setSendState("busy");
  activeChatController = new AbortController();
  const controller = activeChatController;
  try {
    await runChatTool(kind, prompt);
  } catch (err) {
    const providerUnavailable = /not connected|not implemented|501|provider/i.test(err.message || "");
    const message = providerUnavailable
      ? `${names[kind]} is not connected to a generation provider yet. Your request was not charged a credit. You can still use normal AI chat and any backend tools that are connected.`
      : `ClearChat couldn't complete that request: ${err.message}. No credit was charged.`;
    addMessage(message, "assistant");
  } finally {
    if (activeChatController === controller) activeChatController = null;
    $("status").textContent = "Describe anything — ClearChat detects the tool automatically";
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
  const items = [
    ["image", "iu", "im"], ["video", "vu", "vm"],
    ["browser", "bu", "bm"], ["code", "cu", "cm"],
    ["music", "mu", "mm"]
  ];
  const owner = isOwnerMode();
  LIMIT = PLAN_LIMITS[currentPlan] || PLAN_LIMITS.Free;
  const title = $("usagePlanTitle");
  if (title) title.childNodes[0].textContent = owner ? "OWNER ACCESS " : currentPlan.toUpperCase() + " PLAN ";
  items.forEach(([key, valueId, meterId]) => {
    const limit = LIMIT[key], value = $(valueId), meter = $(meterId);
    if (value) value.textContent = owner || limit === Infinity ? "Unlimited" : used[key] + " / " + limit;
    if (meter) meter.style.width = owner || limit === Infinity ? "100%" : Math.min(100, used[key] / limit * 100) + "%";
  });
  const labels = { image:"imageLimit", video:"videoLimit", code:"codeLimit", music:"musicLimit", browser:"browserLimit" };
  Object.entries(labels).forEach(([key,id]) => {
    const el = $(id);
    if (el) el.textContent = owner || LIMIT[key] === Infinity ? "∞" : LIMIT[key];
  });
  const chatPlan = $("chatPlanBadge");
  if (chatPlan) chatPlan.textContent = owner ? "OWNER ACCESS" : currentPlan.toUpperCase() + " PLAN";
  const chatUsage = [
    ["image", "chatImageUsage"], ["video", "chatVideoUsage"],
    ["browser", "chatBrowserUsage"], ["code", "chatCodeUsage"], ["music", "chatMusicUsage"]
  ];
  chatUsage.forEach(([key, id]) => {
    const el = $(id); if (!el) return;
    el.textContent = owner || LIMIT[key] === Infinity ? "Unlimited" : `${used[key]} / ${LIMIT[key]}`;
  });
  const profile = $("profilePlan");
  if (profile) profile.textContent = owner ? "Owner access · Unlimited" : currentPlan + " plan";
  if (typeof refreshSubscriptionUI === "function") refreshSubscriptionUI();
  $("cancelAdminAccess")?.classList.toggle("hidden", !owner);
  resetExpiredUsageWindow();
  refreshFreeLimitNotice();
}
function isOwnerMode() { return sessionStorage.getItem("cc_owner_mode") === "enabled"; }
function formatResetTime(timestamp) {
  const date = new Date(timestamp);
  const timezone = localStorage.getItem("cc_timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  const locale = navigator.language || "en";
  const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: timezone });
  const day = date.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: timezone });
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: timezone });
  return day === tomorrow ? `${time} tomorrow` : `${time} on ${day}`;
}
function refreshFreeLimitNotice() {
  const notice = $("freeLimitNotice");
  if (!notice) return;
  const show = !isOwnerMode() && currentPlan === "Free" && usageResetAt > Date.now();
  notice.classList.toggle("hidden", !show);
  if (show) notice.textContent = `Free Plan Limit Reached. Your limits refresh at ${formatResetTime(usageResetAt)} (${timezone.replaceAll("_"," ")} time).`;
}
function resetExpiredUsageWindow() {
  if (usageResetAt && Date.now() >= usageResetAt) {
    used = { image:0, video:0, browser:0, code:0, music:0 };
    usageResetAt = 0;
    localStorage.setItem("cc_usage", JSON.stringify(used));
    localStorage.removeItem("cc_usage_reset_at");
  }
  refreshFreeLimitNotice();
}
function credit(key) {
  resetExpiredUsageWindow();
  if (isOwnerMode()) return true;
  if (used[key] >= LIMIT[key]) {
    if (currentPlan === "Free" && !usageResetAt) {
      usageResetAt = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem("cc_usage_reset_at", String(usageResetAt));
    }
    refreshFreeLimitNotice();
    toast((currentPlan === "Free" ? "Free plan limit reached." : currentPlan + " plan limit reached.") + " Check the notice below the chat.");
    return false;
  }
  used[key]++;
  if (currentPlan === "Free" && used[key] >= LIMIT[key] && !usageResetAt) {
    usageResetAt = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem("cc_usage_reset_at", String(usageResetAt));
  }
  saveUsage();
  return true;
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
  try { const data = await api("browser", { prompt }, activeChatController?.signal); $("browserOut").textContent = (data.steps || []).join("\n") || data.message || "No action plan returned."; }
  catch { $("browserOut").textContent = "This starter can preview plans, but browser automation is not connected."; }
};

const planData = [
  ["Free", "RM0", ["Unlimited chat", "30 images", "10 videos", "10 browser prompts", "50 code generations", "20 songs"]],
  ["Go", "RM3", ["50 images", "20 videos", "50 browser prompts", "100 code generations", "30 songs"]],
  ["Plus", "RM10", ["70 images", "50 videos", "70 browser prompts", "150 code generations", "40 songs"]],
  ["Pro", "RM30", ["100 images", "100 videos", "150 browser prompts", "200 code generations", "100 songs"]],
  ["Ultra", "RM50", ["UNLIMITED images", "UNLIMITED videos", "UNLIMITED browser prompts", "UNLIMITED code generations", "UNLIMITED songs"]]
];
$("plans").innerHTML = planData.map((p, i) => `<article class="plan-card ${i === 2 ? "featured" : ""} ${i === 3 ? "best-deal" : ""}"><h3>${p[0]}${i === 3 ? '<span class="best-deal-tag">BEST DEAL!!!</span>' : ""}</h3><div class="price">${p[1]}<small> / month</small></div><p>${p[2].join("<br>• ")}</p><button data-plan="${p[0]}">${p[0] === currentPlan ? "Current plan" : "Select " + p[0]}</button></article>`).join("");
// Called only after a trusted payment provider confirms a purchase.
function applyPurchasedPlan(plan) {
  if (!PLAN_LIMITS[plan]) return false;
  currentPlan = plan;
  LIMIT = PLAN_LIMITS[plan];
  localStorage.setItem("cc_plan", plan);
  updateUsage();
  return true;
}
$("plans").onclick = e => {
  const button = e.target.closest("[data-plan]");
  if (!button) return;
  const plan = button.dataset.plan;
  if (plan === currentPlan) return toast("This is your current plan.");
  toast("Checkout is not connected yet. No plan or payment has changed.");
};

// Subscription-management preview. Real billing cancellation must be wired to
// a payment provider on the backend before this is used for paid subscriptions.
let cancelAtPeriodEnd = localStorage.getItem("cc_cancel_at_period_end") === "true";
let subscriptionEndsAt = Number(localStorage.getItem("cc_subscription_ends_at") || 0);

function refreshSubscriptionUI() {
  const owner = isOwnerMode();
  const paid = currentPlan !== "Free" && !owner;
  const name = $("subscriptionName");
  const status = $("subscriptionStatus");
  const end = $("subscriptionEnd");
  if (name) name.textContent = owner ? "Owner access" : currentPlan + (paid ? " plan" : " plan");
  if (status) status.textContent = owner ? "Unlimited owner access" :
    !paid ? "No paid subscription is active." :
    cancelAtPeriodEnd ? "Cancellation scheduled" : "Active · Billing preview";
  if (end) end.textContent = paid && cancelAtPeriodEnd && subscriptionEndsAt
    ? "Preview access ends: " + new Date(subscriptionEndsAt).toLocaleDateString()
    : paid ? "Real recurring billing is not connected yet." : "";
  $("cancelSubscription")?.classList.toggle("hidden", !paid || cancelAtPeriodEnd);
  $("reactivateSubscription")?.classList.toggle("hidden", !paid || !cancelAtPeriodEnd);
  $("manageSubscription")?.classList.toggle("hidden", owner);
}

function checkPreviewSubscriptionExpiry() {
  if (cancelAtPeriodEnd && subscriptionEndsAt && Date.now() >= subscriptionEndsAt) {
    currentPlan = "Free";
    LIMIT = PLAN_LIMITS.Free;
    cancelAtPeriodEnd = false;
    subscriptionEndsAt = 0;
    localStorage.setItem("cc_plan", "Free");
    localStorage.removeItem("cc_cancel_at_period_end");
    localStorage.removeItem("cc_subscription_ends_at");
    updateUsage();
    toast("Your preview plan has ended. You're now on Free.");
  }
}
$("manageSubscription")?.addEventListener("click", () => {
  refreshSubscriptionUI();
  toast("Subscription settings are shown below the plan cards.");
});
$("cancelSubscription")?.addEventListener("click", () => {
  $("cancelPlanDescription").textContent =
    `Your ${currentPlan} preview plan will remain active for 30 more days, then switch to Free. This is not a real billing cancellation.`;
  $("cancelPlanModal").classList.remove("hidden");
});
$("confirmCancelPlan")?.addEventListener("click", () => {
  if (currentPlan === "Free" || isOwnerMode()) return;
  cancelAtPeriodEnd = true;
  subscriptionEndsAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  localStorage.setItem("cc_cancel_at_period_end", "true");
  localStorage.setItem("cc_subscription_ends_at", String(subscriptionEndsAt));
  $("cancelPlanModal").classList.add("hidden");
  refreshSubscriptionUI();
  toast("Preview cancellation scheduled. No real payment was changed.");
});
$("reactivateSubscription")?.addEventListener("click", () => {
  cancelAtPeriodEnd = false;
  subscriptionEndsAt = 0;
  localStorage.removeItem("cc_cancel_at_period_end");
  localStorage.removeItem("cc_subscription_ends_at");
  refreshSubscriptionUI();
  toast("Your preview plan is kept.");
});
document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => $(button.dataset.close)?.classList.add("hidden"));
});
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
$("cancelAdminAccess")?.addEventListener("click", () => {
  sessionStorage.removeItem("cc_owner_mode");
  sessionStorage.removeItem("cc_owner_token");
  $("ownerMessage").textContent = "Owner access has been turned off for this browser.";
  $("ownerModal")?.classList.add("hidden");
  updateUsage();
  toast("Admin mode cancelled. Your normal plan limits are active.");
});

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

checkPreviewSubscriptionExpiry();
refreshSubscriptionUI();
