import { beginTask, endTask } from "./loading";

// Dev defaults to the local backend; prod builds are served by the backend
// itself, so same-origin relative URLs are the default (HTTPS-safe).
export const API_BASE =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://localhost:3000" : "");

// Resolve a backend-relative asset path (e.g. chain icon URLs from /api/chains)
export const apiUrl = (path) =>
  /^https?:\/\//.test(path)
    ? path // remote asset
    : path.startsWith("/") && !path.startsWith("/api/")
      ? path // frontend public asset - same origin
      : `${API_BASE}${path}`;

const get = async (url) => {
  beginTask();
  try {
    return await fetch(url);
  } finally {
    endTask();
  }
};

// `chain` selects a backend chain (see /api/chains); null = server default.
const drakarys = (path, chain) =>
  chain
    ? `${API_BASE}/api/chains/${chain}/drakarys${path}`
    : `${API_BASE}/api/drakarys${path}`;

export async function fetchChains() {
  const res = await get(`${API_BASE}/api/chains`);
  if (!res.ok) throw new Error(`Failed to load chains (${res.status})`);
  return res.json();
}

export async function fetchMatches(chain = null) {
  const res = await get(drakarys("/list", chain));
  if (!res.ok) throw new Error(`Failed to load matches (${res.status})`);
  return res.json();
}

export async function fetchMatch(matchId, chain = null) {
  const res = await get(drakarys(`/${matchId}`, chain));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load match (${res.status})`);
  return res.json();
}

// X login: full-page redirect to the backend, which forwards to x.com
export const xLoginUrl = `${API_BASE}/api/auth/x`;

// Email+password login: JSON POSTs against the same session cookie
const postAuth = async (path, body) => {
  const res = await fetch(`${API_BASE}/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Login failed (${res.status})`);
  return data;
};

export const emailLogin = (email, password) =>
  postAuth("/email/login", { email, password });

export const emailRegister = (email, password, name) =>
  postAuth("/email/register", { email, password, name });

export const emailMagic = (email) => postAuth("/email/magic", { email });

// Session cookie is httpOnly, so these need credentials (plain fetch - no
// top loader for background auth calls).
export async function fetchMe() {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
  return res.json();
}

export async function fetchUsers() {
  const res = await fetch(`${API_BASE}/api/auth/users`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  return res.json();
}

export async function logout() {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
