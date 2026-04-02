import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONTACT_EMAIL = "support@emersus.ai";
let clientPromise;
let configPromise;

export function getContactEmail() {
  return CONTACT_EMAIL;
}

async function getPublicConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/config", {
      headers: {
        Accept: "application/json",
      },
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to load auth configuration.");
      }

      return response.json();
    });
  }

  return configPromise;
}

export async function getSupabase() {
  if (!clientPromise) {
    clientPromise = getPublicConfig().then(({ supabaseUrl, supabaseAnonKey }) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    );
  }

  return clientPromise;
}

export async function getSession() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export function getBaseUrl() {
  return window.location.origin;
}

export function getAuthCallbackUrl() {
  return `${getBaseUrl()}/auth/callback/`;
}

export function setStatus(element, tone, message) {
  if (!element) {
    return;
  }

  element.textContent = message || "";
  if (message) {
    element.dataset.tone = tone;
  } else {
    delete element.dataset.tone;
  }
}

export async function requireAuth({ redirectTo = "/auth/login/" } = {}) {
  const session = await getSession();

  if (!session) {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const target = `${redirectTo}?next=${encodeURIComponent(returnTo)}`;
    window.location.replace(target);
    return null;
  }

  return session;
}

export async function redirectIfAuthenticated(target = "/app/") {
  const session = await getSession();

  if (session) {
    window.location.replace(target);
    return true;
  }

  return false;
}

export async function getProfile(userId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertProfile(userId, values) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        ...values,
      },
      {
        onConflict: "id",
      }
    )
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export function resolveNextPath(fallback = "/app/") {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");

  if (!next || !next.startsWith("/")) {
    return fallback;
  }

  return next;
}

export function readAuthFlowFromUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  return {
    code: searchParams.get("code"),
    type: searchParams.get("type") || hashParams.get("type"),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
  };
}
