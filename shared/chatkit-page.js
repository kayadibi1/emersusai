import { getSession, setStatus } from "/shared/supabase.js";

const ANON_STORAGE_KEY = "emersus_chatkit_device_id";

function getStableAnonymousId() {
  const existing = window.localStorage.getItem(ANON_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const generated =
    "anonymous:" +
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  window.localStorage.setItem(ANON_STORAGE_KEY, generated);
  return generated;
}

async function resolveStableUser() {
  try {
    const session = await getSession();

    if (session?.user?.id) {
      return {
        userId: `supabase:${session.user.id}`,
        mode: "Authenticated",
      };
    }
  } catch (_error) {
    // Fall back to an anonymous device id if auth config or session lookup fails.
  }

  return {
    userId: getStableAnonymousId(),
    mode: "Guest",
  };
}

async function ensureChatKitLoaded() {
  if (window.customElements.get("openai-chatkit")) {
    return;
  }

  const script = document.getElementById("openai-chatkit-script");

  if (!(script instanceof HTMLScriptElement)) {
    throw new Error("ChatKit script tag is missing.");
  }

  if (script.dataset.loaded === "true" || script.readyState === "complete") {
    await window.customElements.whenDefined("openai-chatkit");
    return;
  }

  await new Promise((resolve, reject) => {
    const handleLoad = () => {
      script.dataset.loaded = "true";
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Unable to load the ChatKit script."));
    };

    const cleanup = () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
  });

  await window.customElements.whenDefined("openai-chatkit");
}

async function createSession(userId) {
  const response = await fetch("/api/chatkit/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.client_secret) {
    throw new Error(payload.message || "Unable to create a ChatKit session.");
  }

  return payload.client_secret;
}

async function initChat() {
  const chatkit = document.getElementById("emersus-chatkit");
  const status = document.querySelector("[data-chat-status]");
  const userIdNode = document.querySelector("[data-chat-user-id]");
  const userModeNode = document.querySelector("[data-chat-user-mode]");

  if (!(chatkit instanceof HTMLElement)) {
    return;
  }

  setStatus(status, "", "");
  await ensureChatKitLoaded();

  const stableUser = await resolveStableUser();
  userIdNode.textContent = stableUser.userId;
  userModeNode.textContent = stableUser.mode;

  chatkit.addEventListener("chatkit.error", (event) => {
    const detail = event.detail || {};
    const errorMessage =
      detail.error?.message || detail.message || "ChatKit reported an error.";
    setStatus(status, "error", errorMessage);
  });

  chatkit.setOptions({
    api: {
      async getClientSecret(_currentClientSecret) {
        setStatus(status, "", "");
        return createSession(stableUser.userId);
      },
    },
  });
}

initChat().catch((error) => {
  const status = document.querySelector("[data-chat-status]");
  setStatus(status, "error", error.message || "Unable to start chat.");
});
