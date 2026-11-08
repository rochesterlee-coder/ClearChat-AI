
// ClearChat - Authentication System

const SUPABASE_URL = "https://kjrpibxiezomiflrpjeq.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_n3kb_AGzrnX7wjhuO0buyw_qu8Dfg-i";

let supabaseClient = null;

if (window.supabase) {
    supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );
}

// Website screens

const screens = [
    "welcome",
    "localScreen",
    "emailScreen",
    "localReady",
    "verifiedScreen"
];

function showScreen(id) {
    screens.forEach(screen => {
        document.getElementById(screen).classList.add("hidden");
    });

    document.getElementById(id).classList.remove("hidden");
}

// Welcome screen

document.getElementById("localChoice").addEventListener("click", function() {
    showScreen("localScreen");
});

document.getElementById("emailChoice").addEventListener("click", function() {
    showScreen("emailScreen");
});

// Back buttons

document.querySelectorAll("[data-back]").forEach(button => {
    button.addEventListener("click", function() {
        showScreen("welcome");
    });
});

document.querySelectorAll("[data-home]").forEach(button => {
    button.addEventListener("click", function() {
        showScreen("welcome");
    });
});

// Local device mode

document.getElementById("startLocal").addEventListener("click", function() {
    localStorage.setItem("clearchat_mode", "local");
    showScreen("localReady");
});

// Email verification

document.getElementById("emailForm").addEventListener("submit", async function(event) {

    event.preventDefault();

    const email = document.getElementById("email").value.trim();

    const message = document.getElementById("formMessage");

    const sendButton = document.getElementById("sendButton");

    message.textContent = "";

    if (!supabaseClient) {
        message.textContent = "Supabase could not load. Please refresh the page.";
        message.className = "form-message error";
        return;
    }

    sendButton.disabled = true;
    sendButton.textContent = "Sending verification email...";

    try {

        const { error } = await supabaseClient.auth.signInWithOtp({

            email: email,

            options: {
                shouldCreateUser: true,

                emailRedirectTo: "https://clearchat.site/"
            }

        });

        if (error) {
            throw error;
        }

        message.textContent =
            "Verification email sent! Please check your inbox and click the verification link.";

        message.className = "form-message success";

    } catch (error) {

        message.textContent = error.message;

        message.className = "form-message error";

    }

    sendButton.disabled = false;
    sendButton.innerHTML = 'Send verification email <span>→</span>';

});

// Detect successful email verification

async function checkVerification() {

    if (!supabaseClient) return;

    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
        console.error(error);
        return;
    }

    if (data.session) {
        showScreen("verifiedScreen");
    }
}

if (supabaseClient) {

    supabaseClient.auth.onAuthStateChange(function(event, session) {

        if (event === "SIGNED_IN" && session) {
            showScreen("verifiedScreen");
        }

    });

    checkVerification();

}
