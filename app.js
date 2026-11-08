// ClearChat AI integrated frontend. Keep private provider/payment/owner secrets on the server.
const $=id=>document.getElementById(id);
const CONFIG=window.CLEARCHAT_CONFIG||{};
const API_BASE=(CONFIG.API_BASE_URL||"").replace(/\/$/,"");
const LIMIT={image:30,video:10,browser:10,code:50,music:20};
let used=JSON.parse(localStorage.getItem("cc_usage")||'{"image":0,"video":0,"browser":0,"code":0,"music":0}');
let supabaseClient=null,recognition=null,toastTimer=null;

if(window.supabase&&CONFIG.SUPABASE_URL&&CONFIG.SUPABASE_PUBLISHABLE_KEY&&!CONFIG.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")){
  supabaseClient=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_PUBLISHABLE_KEY);
}
function toast(t){$("toast").textContent=t;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2600)}
function authScreen(id){["authWelcome","authLocal","authEmail","authVerified"].forEach(x=>$(x).classList.toggle("hidden",x!==id))}
function enterWorkspace(mode,email=""){
  $("authGate").classList.add("hidden");
  $("accountLabel").textContent=email||"Local workspace";
  $("profilePlan").textContent="Free plan · "+(mode==="local"?"Local device":"Email verified");
  localStorage.setItem("clearchat_mode",mode);
  if(email)localStorage.setItem("clearchat_email",email);
  else localStorage.removeItem("clearchat_email");
}
function leaveWorkspace(){
  localStorage.removeItem("clearchat_mode");localStorage.removeItem("clearchat_email");
  if(supabaseClient)supabaseClient.auth.signOut().catch(()=>{});
  $("authGate").classList.remove("hidden");authScreen("authWelcome");
  $("messages").innerHTML="";$("welcome").classList.remove("hidden");
}
$("localChoice").onclick=()=>authScreen("authLocal");
$("emailChoice").onclick=()=>authScreen("authEmail");
document.querySelectorAll("[data-auth-back]").forEach(b=>b.onclick=()=>authScreen("authWelcome"));
$("startLocal").onclick=()=>enterWorkspace("local");
$("emailForm").onsubmit=async e=>{
  e.preventDefault();let email=$("email").value.trim(),m=$("formMessage"),b=$("sendButton");
  if(!supabaseClient){m.textContent="Supabase is not configured. Add your complete publishable key in public/config.js.";return}
  b.disabled=true;b.textContent="Sending…";
  try{let {error}=await supabaseClient.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname}});if(error)throw error;m.textContent="Verification link sent. Check your inbox and click it to continue."}
  catch(err){m.textContent=err.message||"Could not send the verification email."}
  finally{b.disabled=false;b.textContent="Send verification email →"}
};
$("continueVerified").onclick=async()=>{let user=null;if(supabaseClient){let r=await supabaseClient.auth.getUser();user=r.data.user}enterWorkspace("email",user?.email||localStorage.getItem("clearchat_email")||"Verified account")};
$("signOutButton").onclick=leaveWorkspace;
(async()=>{
  if(supabaseClient){
    let {data}=await supabaseClient.auth.getSession();
    if(data.session?.user){enterWorkspace("email",data.session.user.email||"");if(location.search||location.hash)history.replaceState({},document.title,location.pathname);return}
    if(new URLSearchParams(location.search).has("code")||location.hash.includes("access_token")){authScreen("authVerified");return}
  }
  if(localStorage.getItem("clearchat_mode")==="local"){enterWorkspace("local");return}
  $("authGate").classList.remove("hidden");
  if(new URLSearchParams(location.search).get("verified")==="1")authScreen("authVerified");
})();

function switchTool(t){
  document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));
  $(t+"View").classList.remove("hidden");
  document.querySelectorAll("[data-tool]").forEach(x=>x.classList.toggle("active",x.dataset.tool===t));
  $("crumb").textContent=({chat:"AI Chat",image:"Image Studio",video:"Video Studio",code:"Code Studio",music:"Music Studio",browser:"Browser Assistant",plans:"Plans"})[t]||"Workspace";
  $("sidebar").classList.remove("open");
}
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>switchTool(b.dataset.tool));
$("mobile").onclick=()=>$("sidebar").classList.toggle("open");
$("newChat").onclick=()=>{$("messages").innerHTML="";$("welcome").classList.remove("hidden");switchTool("chat");$("chatInput").focus()};
document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>{$("chatInput").value=b.dataset.prompt;$("chatInput").focus()});
async function api(path,body){
  let r=await fetch(`${API_BASE}/api/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  let d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.message||`Request failed (${r.status})`);return d;
}
function addMessage(text,who){
  $("welcome").classList.add("hidden");let d=document.createElement("div");d.className="message "+who;d.textContent=text;$("messages").appendChild(d);d.scrollIntoView({behavior:"smooth"});
}
$("send").onclick=async()=>{
  let prompt=$("chatInput").value.trim();if(!prompt)return;$("chatInput").value="";addMessage(prompt,"user");$("status").textContent="Thinking…";
  try{let d=await api("chat",{message:prompt,language:$("voiceLang").value});addMessage(d.reply||"No reply returned.","assistant")}
  catch{addMessage("Your message was received. Live AI chat is not connected yet. Deploy the backend and configure an AI provider to enable real answers.","assistant")}
  $("status").textContent="AI provider pending backend setup";
};
$("chatInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("send").click()}};
$("mic").onclick=()=>{
  let SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return toast("Speech recognition is unavailable in this browser. Try Chrome.");
  if(recognition){recognition.stop();recognition=null;return}
  recognition=new SR();recognition.lang=$("voiceLang").value;recognition.interimResults=true;
  recognition.onresult=e=>{let s="";for(let i=e.resultIndex;i<e.results.length;i++)s+=e.results[i][0].transcript;$("chatInput").value=s};
  recognition.onerror=()=>toast("Check microphone permission.");recognition.onend=()=>{recognition=null;$("mic").textContent="🎙 Voice"};
  $("mic").textContent="■ Stop";recognition.start();
};
function saveUsage(){localStorage.setItem("cc_usage",JSON.stringify(used));updateUsage()}
function updateUsage(){$("iu").textContent=used.image+" / 30";$("vu").textContent=used.video+" / 10";$("im").style.width=Math.min(100,used.image/30*100)+"%";$("vm").style.width=Math.min(100,used.video/10*100)+"%"}
function credit(k){if(used[k]>=LIMIT[k]){toast("Free "+k+" allowance used. View plans to upgrade.");switchTool("plans");return false}used[k]++;saveUsage();return true}
async function generate(k,promptId,outId,extra={}){
  let prompt=$(promptId).value.trim();if(!prompt)return toast("Describe what you want first.");if(!credit(k))return;
  $(outId).innerHTML="✦<b>Preparing request…</b><small>Connecting to the generation service.</small>";
  try{let d=await api(k,{prompt,...extra});
    if(d.image_url)$(outId).innerHTML=`<img src="${d.image_url}" alt="Generated image" style="max-width:100%;border-radius:10px">`;
    else if(d.video_url)$(outId).innerHTML=`<video controls src="${d.video_url}" style="max-width:100%"></video>`;
    else if(d.audio_url)$(outId).innerHTML=`<audio controls src="${d.audio_url}"></audio>`;
    else $(outId).textContent=d.message||"Provider returned a result.";
  }catch(err){$(outId).innerHTML=`<b>Provider not connected</b><small>${err.message}</small>`}
}
$("makeImage").onclick=()=>generate("image","imagePrompt","imageOut",{style:$("imageStyle").value});
$("makeVideo").onclick=()=>generate("video","videoPrompt","videoOut",{duration:$("videoLength").value});
$("makeMusic").onclick=()=>generate("music","musicPrompt","musicOut",{genre:$("genre").value});
$("makeCode").onclick=async()=>{
  let prompt=$("codePrompt").value.trim();if(!prompt)return toast("Describe the code first.");if(!credit("code"))return;
  $("codeOut").classList.remove("hidden");$("codeOut").querySelector("code").textContent="Generating…";
  try{let d=await api("code",{prompt,language:$("codeLang").value});$("codeOut").querySelector("code").textContent=d.code||"No code returned."}
  catch(err){$("codeOut").querySelector("code").textContent="// Backend not connected\n// "+err.message}
};
$("copyCode").onclick=async()=>{try{await navigator.clipboard.writeText($("codeOut").querySelector("code").textContent);toast("Copied.")}catch{toast("Clipboard permission unavailable.")}};
$("planBrowser").onclick=async()=>{
  let prompt=$("browserPrompt").value.trim();if(!prompt)return toast("Describe the browser task first.");if(!credit("browser"))return;
  $("browserOut").classList.remove("hidden");$("browserOut").innerHTML="<b>Proposed action plan</b><ol><li>Review the request and identify the relevant page or control.</li><li>Show the proposed action and wait for your approval.</li><li>Use a separately installed, permission-based browser agent for execution.</li></ol><p>This starter does not move your mouse.</p>";
  try{let d=await api("browser",{prompt});if(d.steps?.length)$("browserOut").innerHTML="<b>Proposed action plan</b><ol>"+d.steps.map(s=>"<li>"+String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))+"</li>").join("")+"</ol>"}catch{}
};
const planData=[["Free","RM0",["Unlimited chat","30 images","10 videos","10 browser prompts","50 code generations","20 songs"]],["Go","RM3",["Paid tier preview","More room to create"]],["Plus","RM10",["Paid tier preview","Expanded workspace"]],["Pro","RM30",["Paid tier preview","Advanced workspace"]],["Ultra","RM50",["Paid tier preview","Top-tier workspace"]]];
$("plans").innerHTML=planData.map((p,i)=>`<article class="plan-card ${i===2?"featured":""}"><h3>${p[0]}</h3><div class="price">${p[1]}<small> / month</small></div><p>${p[2].join("<br>• ")}</p><button data-plan="${p[0]}">${i?"Select "+p[0]:"Current plan"}</button></article>`).join("");
$("plans").onclick=e=>{let b=e.target.closest("[data-plan]");if(b&&b.dataset.plan!=="Free")toast("Secure checkout is not configured. No payment has been taken.")};
function setTheme(t){document.body.dataset.theme=t;localStorage.setItem("cc_theme",t);$("themeSelect").value=t}
setTheme(localStorage.getItem("cc_theme")||"dark");
$("themeQuick").onclick=()=>{let a=["dark","black","light","white","midnight"];setTheme(a[(a.indexOf(document.body.dataset.theme)+1)%a.length]);toast("Theme: "+document.body.dataset.theme)};
$("settingsOpen").onclick=()=>$("settingsModal").classList.remove("hidden");
$("themeSelect").onchange=e=>setTheme(e.target.value);
$("saveSettings").onclick=()=>{$("settingsModal").classList.add("hidden");toast("Preferences saved on this device.")};
$("ownerOpen").onclick=()=>{$("ownerModal").classList.remove("hidden");$("ownerCode").value="";$("ownerMessage").textContent=""};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$ (b.dataset.close).classList.add("hidden"));
$("verifyOwner").onclick=async()=>{
  $("ownerMessage").textContent="Checking private server…";
  try{let d=await api("owner/verify",{code:$("ownerCode").value});$("ownerMessage").textContent=d.message||"Owner verification accepted."}
  catch(err){$("ownerMessage").textContent=err.message}
};
updateUsage();
