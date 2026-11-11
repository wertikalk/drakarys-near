// X (Twitter) OAuth 2.0 + PKCE login, and email+password login.
// Env: X_CLIENT_ID, X_CLIENT_SECRET - from https://developer.x.com
//   (App -> User authentication settings -> OAuth 2.0, callback = X_CALLBACK_URL)
//   X_CALLBACK_URL - full callback URL, must be registered in the X app
//   FRONT_URL      - where to send the browser after login (default: same origin)
//   EMAIL_LOGIN    - set to "0" to disable email+password login (default: on)
//   AUTH_BASE_URL  - public backend URL used inside magic links (default:
//                    absolute FRONT_URL, else http://localhost:PORT)
//   MAGIC_DEV_LINK - set to "1" to echo magic links in the response (dev only)
import express from "express";
import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { sendMail, smtpEnabled } from "./mail.js";
import {
  upsertXUser,
  createEmailUser,
  getUserByEmail,
  touchLastLogin,
  createSession,
  getSessionUser,
  deleteSession,
  listUsers,
} from "./db.js";

const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const CALLBACK_URL =
  process.env.X_CALLBACK_URL || `http://localhost:${PORT}/api/auth/x/callback`;
const FRONT_URL = process.env.FRONT_URL || "/";
const COOKIE = "xfokus_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const xLoginEnabled = Boolean(CLIENT_ID && CLIENT_SECRET);
export const emailLoginEnabled = process.env.EMAIL_LOGIN !== "0";
export const magicLoginEnabled = emailLoginEnabled && smtpEnabled;

const AUTH_BASE_URL =
  process.env.AUTH_BASE_URL ||
  (/^https?:\/\//.test(FRONT_URL) ? FRONT_URL : `http://localhost:${PORT}`);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAGIC_TTL_MS = 15 * 60 * 1000;

// token -> { email, at } - single-use, 15-minute expiry
const magicTokens = new Map();
const pruneMagic = () => {
  const now = Date.now();
  for (const [t, v] of magicTokens) {
    if (now - v.at > MAGIC_TTL_MS) magicTokens.delete(t);
  }
};

// magic-link sends per ip+email: max 5 per hour
const magicSends = new Map();
const magicSendOk = (key) => {
  const a = magicSends.get(key);
  return !a || Date.now() > a.resetAt || a.count < 5;
};
const recordMagicSend = (key) => {
  const a = magicSends.get(key);
  if (!a || Date.now() > a.resetAt) {
    magicSends.set(key, { count: 1, resetAt: Date.now() + 60 * 60 * 1000 });
  } else {
    a.count += 1;
  }
};

// Failed email-login attempts: key -> { count, resetAt } (10 per 10 min)
const attempts = new Map();
const attemptsLeft = (key) => {
  const a = attempts.get(key);
  if (!a || Date.now() > a.resetAt) return 10;
  return Math.max(0, 10 - a.count);
};
const recordFail = (key) => {
  const a = attempts.get(key);
  if (!a || Date.now() > a.resetAt) {
    attempts.set(key, { count: 1, resetAt: Date.now() + 10 * 60 * 1000 });
  } else {
    a.count += 1;
  }
};

const hashPassword = (pw, salt = randomBytes(16).toString("hex")) =>
  `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;

const verifyPassword = (pw, stored) => {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const calc = scryptSync(pw, salt, 64);
  const want = Buffer.from(hash, "hex");
  return calc.length === want.length && timingSafeEqual(calc, want);
};

const b64url = (b) =>
  b
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

// state -> { verifier, at }; entries expire after 10 minutes
const pending = new Map();
const prunePending = () => {
  const now = Date.now();
  for (const [s, v] of pending) {
    if (now - v.at > 10 * 60 * 1000) pending.delete(s);
  }
};

const readCookies = (req) => {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0)
      out[part.slice(0, i).trim()] = decodeURIComponent(
        part.slice(i + 1).trim(),
      );
  }
  return out;
};

const setSessionCookie = (req, res, token) => {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
};

export function createAuthApi() {
  const r = express.Router();

  // mounted before the app-level express.json() - parse bodies here
  r.use(express.json({ limit: "8kb" }));

  r.post("/email/register", async (req, res) => {
    if (!emailLoginEnabled) {
      return res.status(503).json({ error: "Email login is not configured" });
    }
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "invalid email" });
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return res
        .status(400)
        .json({ error: `password must be at least ${MIN_PASSWORD_LEN} chars` });
    }
    const handle =
      email
        .split("@")[0]
        .replace(/[^\w.-]/g, "")
        .slice(0, 30) || "user";
    try {
      await createEmailUser({
        email,
        handle,
        name: name || handle,
        passwordHash: hashPassword(password),
      });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "email already registered" });
      }
      throw err;
    }
    const token = randomBytes(32).toString("hex");
    await createSession(token, `email:${email}`, SESSION_TTL_MS);
    setSessionCookie(req, res, token);
    res.status(201).json({ user: await getSessionUser(token) });
  });

  r.post("/email/login", async (req, res) => {
    if (!emailLoginEnabled) {
      return res.status(503).json({ error: "Email login is not configured" });
    }
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const key = `${req.ip}|${email}`;
    if (attemptsLeft(key) <= 0) {
      return res.status(429).json({ error: "too many attempts - try later" });
    }
    const row = EMAIL_RE.test(email) ? await getUserByEmail(email) : null;
    if (!row || !verifyPassword(password, row.passwordHash)) {
      recordFail(key);
      return res.status(401).json({ error: "invalid email or password" });
    }
    attempts.delete(key);
    const token = randomBytes(32).toString("hex");
    await createSession(token, row.xId, SESSION_TTL_MS);
    await touchLastLogin(row.xId).catch(() => {});
    setSessionCookie(req, res, token);
    res.json({ user: await getSessionUser(token) });
  });

  r.post("/email/magic", async (req, res) => {
    if (!magicLoginEnabled) {
      return res
        .status(503)
        .json({ error: "Magic-link login is not configured" });
    }
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "invalid email" });
    }
    const key = `${req.ip}|${email}`;
    if (!magicSendOk(key)) {
      return res.status(429).json({ error: "too many requests - try later" });
    }
    recordMagicSend(key);

    pruneMagic();
    const token = b64url(randomBytes(32));
    magicTokens.set(token, { email, at: Date.now() });
    const link = `${AUTH_BASE_URL}/api/auth/email/verify?token=${token}`;
    try {
      await sendMail({
        to: email,
        subject: "Your XFokus.AI login link",
        text: `Click to sign in (link valid for 15 minutes):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
        html:
          `<p>Click to sign in to <b>XFokus.AI</b> ` +
          `(link valid for 15 minutes):</p>` +
          `<p><a href="${link}">${link}</a></p>` +
          `<p>If you didn't request this, ignore this email.</p>`,
      });
    } catch (err) {
      console.error("[auth:magic] send failed:", err.message);
      if (process.env.MAGIC_DEV_LINK === "1") {
        // dev mode: still hand back the link so the click flow can be tested
        return res.json({ sent: false, devLink: link, error: err.message });
      }
      magicTokens.delete(token);
      return res.status(502).json({ error: "could not send email" });
    }
    const out = { sent: true };
    if (process.env.MAGIC_DEV_LINK === "1") out.devLink = link;
    res.json(out);
  });

  r.get("/email/verify", async (req, res) => {
    const fail = () => res.redirect(`${FRONT_URL}?login=failed`);
    const token = typeof req.query.token === "string" ? req.query.token : null;
    pruneMagic();
    const entry = token && magicTokens.get(token);
    if (entry) magicTokens.delete(token); // single-use
    if (!entry) return fail();

    const email = entry.email;
    try {
      let row = await getUserByEmail(email);
      if (!row) {
        const handle =
          email
            .split("@")[0]
            .replace(/[^\w.-]/g, "")
            .slice(0, 30) || "user";
        try {
          await createEmailUser({
            email,
            handle,
            name: handle,
            passwordHash: null,
          });
        } catch (err) {
          if (err.code !== "23505") throw err; // raced registration - fine
        }
        row = await getUserByEmail(email);
      }
      const session = randomBytes(32).toString("hex");
      await createSession(session, row.xId, SESSION_TTL_MS);
      await touchLastLogin(row.xId).catch(() => {});
      setSessionCookie(req, res, session);
      res.redirect(FRONT_URL);
    } catch (err) {
      console.error("[auth:magic]", err.message);
      fail();
    }
  });

  r.get("/x", (req, res) => {
    if (!xLoginEnabled) {
      return res.status(503).json({ error: "X login is not configured" });
    }
    prunePending();
    const state = b64url(randomBytes(16));
    const verifier = b64url(randomBytes(32));
    pending.set(state, { verifier, at: Date.now() });
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const url = new URL("https://x.com/i/oauth2/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      scope: "users.read tweet.read",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const authUrl = url.toString();

    // Android: intent:// launches the X app directly and falls back to the
    // browser authorize URL when the app isn't installed. intent:// can't be
    // used as a 302 Location, so serve a tiny launcher page.
    if (/android/i.test(req.headers["user-agent"] || "")) {
      const intent =
        `intent://x.com${url.pathname}${url.search}` +
        `#Intent;scheme=https;package=com.twitter.android;` +
        `S.browser_fallback_url=${encodeURIComponent(authUrl)};end`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(
        `<!doctype html><meta name="viewport" content="width=device-width">` +
          `<script>location.href=${JSON.stringify(intent)};</script>` +
          `<noscript><a href="${authUrl}">Continue</a></noscript>`,
      );
    }

    // iOS: x.com is a universal link - opens in the X app when installed.
    res.redirect(authUrl);
  });

  r.get("/x/callback", async (req, res) => {
    const { state, code, error } = req.query;
    const p = typeof state === "string" ? pending.get(state) : null;
    if (p) pending.delete(state);
    if (error || typeof code !== "string" || !p) {
      return res.redirect(`${FRONT_URL}?login=failed`);
    }
    try {
      const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: CALLBACK_URL,
          code_verifier: p.verifier,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(
          `token ${tokenRes.status}: ${JSON.stringify(tokenData)}`,
        );
      }

      const meRes = await fetch(
        "https://api.x.com/2/users/me?user.fields=profile_image_url",
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
      );
      const meData = await meRes.json();
      const x = meData.data;
      if (!meRes.ok || !x?.id) {
        throw new Error(`me ${meRes.status}: ${JSON.stringify(meData)}`);
      }

      await upsertXUser({
        xId: x.id,
        handle: x.username,
        name: x.name,
        avatar: x.profile_image_url,
      });
      const token = randomBytes(32).toString("hex");
      await createSession(token, x.id, SESSION_TTL_MS);
      setSessionCookie(req, res, token);
      res.redirect(FRONT_URL);
    } catch (err) {
      console.error("[auth:x]", err.message);
      res.redirect(`${FRONT_URL}?login=failed`);
    }
  });

  r.get("/me", async (req, res) => {
    const token = readCookies(req)[COOKIE];
    const user = token ? await getSessionUser(token).catch(() => null) : null;
    res.json({
      user,
      xLogin: xLoginEnabled,
      emailLogin: emailLoginEnabled,
      magicLogin: magicLoginEnabled,
    });
  });

  r.get("/users", async (req, res) => {
    const token = readCookies(req)[COOKIE];
    const me = token ? await getSessionUser(token).catch(() => null) : null;
    if (!me?.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }
    res.json({ users: await listUsers().catch(() => []) });
  });

  r.post("/logout", async (req, res) => {
    const token = readCookies(req)[COOKIE];
    if (token) await deleteSession(token).catch(() => {});
    res.clearCookie(COOKIE, { path: "/" });
    res.status(204).end();
  });

  return r;
}
