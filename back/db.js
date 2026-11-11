// PostgreSQL persistence for the Drakarys indexer. Every table is keyed by
// (chain, ...) - matchIdx is NOT unique across chains, so the composite key
// is required everywhere.
import { randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@127.0.0.1:5432/drakarys",
});

// Handles that get is_admin on login / at init (lowercase compare).
const ADMIN_HANDLES = ["wertikalk"];
// Email addresses that get is_admin on signup / at init (lowercase compare).
const ADMIN_EMAILS = ["bojinovic1301@gmail.com"];

// indexer.js and solanaIndexer.js both call initDb() at module load - share
// one promise so the CREATE TABLEs can't race each other, and hold a session
// advisory lock so overlapping pm2 restarts can't race either.
let initPromise = null;
export function initDb() {
  initPromise ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(727272)");
      await createTables(client);
    } finally {
      client.release();
    }
  })();
  return initPromise;
}

async function createTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS matches (
      chain         text        NOT NULL,
      match_idx     integer     NOT NULL,
      agents        jsonb,
      metadata      jsonb,
      started_block bigint,
      started_at    timestamptz,
      ended         boolean     NOT NULL DEFAULT false,
      states        jsonb       NOT NULL DEFAULT '[]',
      events        jsonb       NOT NULL DEFAULT '{}',
      updated_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chain, match_idx)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS commits (
      chain        text    NOT NULL,
      match_idx    integer NOT NULL,
      state_idx    integer NOT NULL,
      data         jsonb   NOT NULL,
      signatures   jsonb   NOT NULL,
      sent         boolean NOT NULL DEFAULT false,
      tx_ok        boolean,
      tx_hash      text,
      block_number bigint,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chain, match_idx, state_idx)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS reveals (
      chain        text    NOT NULL,
      match_idx    integer NOT NULL,
      state_idx    integer NOT NULL,
      moves        jsonb   NOT NULL,
      sent         boolean NOT NULL DEFAULT false,
      tx_ok        boolean,
      tx_hash      text,
      block_number bigint,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chain, match_idx, state_idx)
    )`);
  // rows written at POST time, marked with the relay outcome later
  for (const table of ["commits", "reveals"]) {
    await client.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS
         sent boolean NOT NULL DEFAULT false`,
    );
    await client.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tx_ok boolean`,
    );
  }
  await client.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      chain        text   NOT NULL,
      tx_hash      text   NOT NULL,
      match_idx    integer,
      kind         text   NOT NULL,
      block_number bigint,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chain, tx_hash)
    )`);
  // X-login users + their opaque session tokens (see auth.js)
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      x_id          text PRIMARY KEY,
      handle        text,
      name          text,
      avatar        text,
      is_admin      boolean     NOT NULL DEFAULT false,
      api_key       text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS
       is_admin boolean NOT NULL DEFAULT false`,
  );
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key text`);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_api_key_idx ON users(api_key)`,
  );
  // Email+password login (auth.js): x_id is 'email:<addr>' for these users
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email text`);
  await client.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`,
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx
       ON users(email) WHERE email IS NOT NULL`,
  );
  // backfill keys for accounts that predate api_key
  const { rows: keyless } = await client.query(
    `SELECT x_id FROM users WHERE api_key IS NULL`,
  );
  for (const row of keyless) {
    await client.query(`UPDATE users SET api_key = $1 WHERE x_id = $2`, [
      randomBytes(24).toString("hex"),
      row.x_id,
    ]);
  }
  await client.query(
    `UPDATE users SET is_admin = true
       WHERE lower(handle) = ANY($1) OR lower(email) = ANY($2)`,
    [ADMIN_HANDLES, ADMIN_EMAILS],
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token      text PRIMARY KEY,
      user_x_id  text NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )`);
}

export function upsertMatch(chain, matchIdx, fields) {
  const cols = Object.keys(fields);
  const values = cols.map((c) => fields[c]);
  const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(", ");
  const insertCols = ["chain", "match_idx", ...cols].join(", ");
  const params = cols.map((_, i) => `$${i + 3}`).join(", ");
  return pool.query(
    `INSERT INTO matches (${insertCols}) VALUES ($1, $2, ${params})
     ON CONFLICT (chain, match_idx) DO UPDATE SET ${sets}, updated_at = now()`,
    [chain, matchIdx, ...values],
  );
}

export function insertCommit(chain, row) {
  return pool.query(
    `INSERT INTO commits (chain, match_idx, state_idx, data, signatures, sent, tx_ok, tx_hash, block_number)
     VALUES ($1, $2, $3, $4, $5, true, true, $6, $7)
     ON CONFLICT (chain, match_idx, state_idx) DO UPDATE SET
       data = EXCLUDED.data, signatures = EXCLUDED.signatures,
       tx_hash = EXCLUDED.tx_hash, block_number = EXCLUDED.block_number,
       sent = true, tx_ok = true`,
    [
      chain,
      row.matchIdx,
      row.stateIdx,
      JSON.stringify(row.data),
      JSON.stringify(row.signatures),
      row.txHash,
      row.blockNumber,
    ],
  );
}

export function insertReveal(chain, row) {
  return pool.query(
    `INSERT INTO reveals (chain, match_idx, state_idx, moves, sent, tx_ok, tx_hash, block_number)
     VALUES ($1, $2, $3, $4, true, true, $5, $6)
     ON CONFLICT (chain, match_idx, state_idx) DO UPDATE SET
       moves = EXCLUDED.moves, tx_hash = EXCLUDED.tx_hash,
       block_number = EXCLUDED.block_number, sent = true, tx_ok = true`,
    [
      chain,
      row.matchIdx,
      row.stateIdx,
      JSON.stringify(row.moves),
      row.txHash,
      row.blockNumber,
    ],
  );
}

// Record an agent's piece the moment it arrives (before any on-chain tx).
// The row's jsonb array slot is set by agent slot; created once per round.
const PIECE_COLS = {
  commits: "data, signatures",
  reveals: "moves",
};
const PIECE_EMPTY = {
  commits: "'[]'::jsonb, '[]'::jsonb",
  reveals: "'[]'::jsonb",
};

async function upsertPiece(chain, table, col, matchIdx, stateIdx, slot, value) {
  if (!PIECE_COLS[table]) throw new Error("bad table");
  await pool.query(
    `INSERT INTO ${table} (chain, match_idx, state_idx, ${PIECE_COLS[table]})
     VALUES ($1, $2, $3, ${PIECE_EMPTY[table]})
     ON CONFLICT (chain, match_idx, state_idx) DO NOTHING`,
    [chain, matchIdx, stateIdx],
  );
  return pool.query(
    `UPDATE ${table} SET
       ${col} = jsonb_set(COALESCE(${col}, '[]'::jsonb), $4, $5::jsonb, true)
     WHERE chain = $1 AND match_idx = $2 AND state_idx = $3`,
    [chain, matchIdx, stateIdx, `{${slot}}`, JSON.stringify(value)],
  );
}

export function upsertCommitPiece(
  chain,
  matchIdx,
  stateIdx,
  slot,
  commitment,
  signature,
) {
  // data[i] = commitment, signatures[i] = sig - two columns, same slot
  return Promise.all([
    upsertPiece(chain, "commits", "data", matchIdx, stateIdx, slot, commitment),
    upsertPiece(
      chain,
      "commits",
      "signatures",
      matchIdx,
      stateIdx,
      slot,
      signature,
    ),
  ]);
}

export function upsertRevealMove(chain, matchIdx, stateIdx, slot, move) {
  return upsertPiece(chain, "reveals", "moves", matchIdx, stateIdx, slot, move);
}

// Relay outcome: sent = tx broadcast returned a tx object; tx_ok = mined
// successfully (receipt status). NULL tx_ok when broadcast never happened.
export function markPlayedTx(chain, table, matchIdx, stateIdx, res) {
  if (!["commits", "reveals"].includes(table)) throw new Error("bad table");
  return pool.query(
    `UPDATE ${table} SET sent = $4, tx_ok = $5,
       tx_hash = COALESCE($6, tx_hash),
       block_number = COALESCE($7, block_number)
     WHERE chain = $1 AND match_idx = $2 AND state_idx = $3`,
    [
      chain,
      matchIdx,
      stateIdx,
      res.sent,
      res.ok,
      res.txHash ?? null,
      res.blockNumber ?? null,
    ],
  );
}

export function insertTransaction(chain, row) {
  return pool.query(
    `INSERT INTO transactions (chain, tx_hash, match_idx, kind, block_number)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (chain, tx_hash) DO NOTHING`,
    [chain, row.txHash, row.matchIdx, row.kind, row.blockNumber],
  );
}

// Email-login users are keyed by 'email:<normalized>' in users.x_id so the
// sessions FK and user lookups stay identical to X-login users.
export function createEmailUser({ email, handle, name, passwordHash }) {
  return pool.query(
    `INSERT INTO users (x_id, handle, name, avatar, email, password_hash, is_admin, api_key, last_login_at)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, now())`,
    [
      `email:${email}`,
      handle,
      name,
      email,
      passwordHash,
      ADMIN_EMAILS.includes(email.toLowerCase()),
      randomBytes(24).toString("hex"),
    ],
  );
}

export async function getUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT x_id AS "xId", password_hash AS "passwordHash"
     FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] || null;
}

export function touchLastLogin(xId) {
  return pool.query(`UPDATE users SET last_login_at = now() WHERE x_id = $1`, [
    xId,
  ]);
}

export function upsertXUser(u) {
  return pool.query(
    `INSERT INTO users (x_id, handle, name, avatar, is_admin, api_key, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (x_id) DO UPDATE SET
       handle = EXCLUDED.handle, name = EXCLUDED.name,
       avatar = EXCLUDED.avatar,
       is_admin = users.is_admin OR EXCLUDED.is_admin,
       last_login_at = now()`,
    [
      u.xId,
      u.handle,
      u.name,
      u.avatar,
      ADMIN_HANDLES.includes(u.handle?.toLowerCase()),
      randomBytes(24).toString("hex"),
    ],
  );
}

export function createSession(token, xId, ttlMs) {
  return pool.query(
    `INSERT INTO sessions (token, user_x_id, expires_at) VALUES ($1, $2, $3)`,
    [token, xId, new Date(Date.now() + ttlMs)],
  );
}

export async function getSessionUser(token) {
  const { rows } = await pool.query(
    `SELECT u.x_id AS "xId", u.handle, u.name, u.avatar, u.email,
            u.is_admin AS "isAdmin", u.api_key AS "apiKey",
            u.created_at AS "firstLoginAt", u.last_login_at AS "lastLoginAt"
     FROM sessions s JOIN users u ON u.x_id = s.user_x_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return rows[0] || null;
}

export function deleteSession(token) {
  return pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

export async function getUserByApiKey(key) {
  const { rows } = await pool.query(
    `SELECT x_id AS "xId", handle, name, avatar, email,
            is_admin AS "isAdmin", api_key AS "apiKey",
            created_at AS "firstLoginAt", last_login_at AS "lastLoginAt"
     FROM users WHERE api_key = $1`,
    [key],
  );
  return rows[0] || null;
}

export async function listUsers() {
  const { rows } = await pool.query(
    `SELECT x_id AS "xId", handle, name, avatar, email,
            is_admin AS "isAdmin", api_key AS "apiKey",
            created_at AS "firstLoginAt", last_login_at AS "lastLoginAt"
     FROM users ORDER BY created_at`,
  );
  return rows;
}

// Restore the in-memory cache after a restart - finished matches keep their
// states/events without needing the chain to still serve them.
// Reveal tx hashes for a match - used to link each state to its chain tx.
export async function loadReveals(chain, matchIdx) {
  const { rows } = await pool.query(
    `SELECT state_idx, tx_hash FROM reveals
     WHERE chain = $1 AND match_idx = $2 ORDER BY state_idx`,
    [chain, matchIdx],
  );
  return rows;
}

export async function loadMatches(chain) {
  const { rows } = await pool.query(
    `SELECT match_idx, agents, metadata, started_block, started_at,
            ended, states, events, updated_at
     FROM matches WHERE chain = $1 ORDER BY match_idx`,
    [chain],
  );
  return rows;
}

export { pool };
