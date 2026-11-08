// ClearChat starter
// For real email verification, create a Supabase project and add its public
// Project URL + anon key below. Never put a service_role key in browser code.
const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

let supabaseClient = null;
if (window.supabase && SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR_") && !SUPABASE_ANON_KEY.includes("YOUR_")) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const screens = ["welcome", "localScreen", "emailScreen", "localReady", "verifiedScreen"];
function showScreen(id) {
  screens.forEach(screen => document.getElementById(screen).classList.toggle("hidden", screen !== id));
}
document.getElementById("localChoice").addEventListener("click", () => showScreen("localScreen"));
document.getElementById("emailChoice").addEventListener("click", () => showScreen("emailScreen"));
document.querySelectorAll("[data-back]").forEach(button => button.addEventListener("click", () => showScreen("welcome")));
document.querySelectorAll("[data-home]").forEach(button => button.addEventListener("click", () => showScreen("welcome")));

document.getElementById("startLocal").addEventListener("click", () => {
  // This marker stays in this browser only. No account or cloud sync is created.
  localStorage.setItem("clearchat_mode", "local");
  showScreen("localReady");
});

const params = new URLSearchParams(window.location.search);
if (params.get("verified") === "1" || window.location.hash.includes("access_token")) {
  showScreen("verifiedScreen");
}

document.getElementById("emailForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  const message = document.getElementById("formMessage");
  const sendButton = document.getElementById("sendButton");
  message.className = "form-message";
  if (!supabaseClient) {
    message.textContent = "Email verification isn't connected yet. Follow the Supabase setup in README.md, then try again.";
    message.classList.add("error");
    return;
  }
  sendButton.disabled = true;
  sendButton.textContent = "Sending...";
  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin + "/?verified=1"
      }
    });
    if (error) throw error;
    message.textContent = "Verification link sent. Check your inbox and click the link to verify your email.";
    message.classList.add("success");
  } catch (error) {
    message.textContent = error.message || "Something went wrong. Please try again.";
    message.classList.add("error");
  } finally {
    sendButton.disabled = false;
    sendButton.innerHTML = 'Send verification email <span>→</span>';
  }
});
