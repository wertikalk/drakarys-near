// Express route factories. One Drakarys API router is mounted per chain; the
// chain name is stamped on payloads so clients can tell deployments apart.

import { Router } from "express";
import { getUserByApiKey, loadReveals } from "./db.js";
import { toListItem, toMatchPayload } from "./matchView.js";

// Match-playing routes require a per-user API key: `x-api-key: <key>` or
// `Authorization: Bearer <key>`. Spectator reads stay open.
async function requireApiKey(req, res, next) {
  const key =
    req.get("x-api-key") ||
    (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!key) {
    return res.status(401).json({ error: "api key required" });
  }
  const user = await getUserByApiKey(key).catch(() => null);
  if (!user) {
    return res.status(401).json({ error: "invalid api key" });
  }
  req.user = user;
  next();
}

export function createDrakarysApi({ chain, indexer, matchmaking }) {
  const r = Router();
  const disabled = (res) =>
    res.status(503).json({ error: "matchmaking disabled" });

  // Front-facing routes - indexed matches in the shape the UI expects
  r.get("/list", (req, res) => {
    const items = indexer.matches.map((matchIdx) => ({
      chain: chain.name,
      ...toListItem(matchIdx, indexer.get(matchIdx)),
    }));
    // Newest first by start timestamp; matches without one (unresolved
    // block time) fall back to id order, which is monotonic with creation.
    items.sort(
      (a, b) =>
        (Date.parse(b.startedAt ?? "") || 0) -
          (Date.parse(a.startedAt ?? "") || 0) || Number(b.id) - Number(a.id),
    );
    res.json(items);
  });

  r.get("/state/:matchIdx", requireApiKey, (req, res) => {
    if (!matchmaking) return disabled(res);
    const match = matchmaking.getMatch(req.params.matchIdx);
    if (!match) {
      return res
        .status(404)
        .json({ error: `Unknown match '${req.params.matchIdx}'` });
    }
    res.json(match);
  });

  r.post("/join-match", requireApiKey, async (req, res) => {
    if (!matchmaking) return disabled(res);
    try {
      res.json(await matchmaking.joinMatch(req.body?.agent));
    } catch {
      res.status(400).json({ error: "invalid agent address" });
    }
  });

  r.post("/commit", requireApiKey, async (req, res) => {
    if (!matchmaking) return disabled(res);
    try {
      const { status, ...body } = await matchmaking.submitCommit(
        req.body?.matchIdx,
        req.body ?? {},
      );
      res.status(status).json(body);
    } catch {
      res.status(400).json({ error: "bad request" });
    }
  });

  r.post("/reveal", requireApiKey, async (req, res) => {
    if (!matchmaking) return disabled(res);
    try {
      const { status, ...body } = await matchmaking.submitReveal(
        req.body?.matchIdx,
        req.body ?? {},
      );
      res.status(status).json(body);
    } catch {
      res.status(400).json({ error: "bad request" });
    }
  });

  r.get("/:matchId", async (req, res) => {
    const entry = indexer.get(req.params.matchId);
    if (!entry) {
      return res
        .status(404)
        .json({ error: `Unknown match '${req.params.matchId}'` });
    }
    const payload = {
      chain: chain.name,
      ...toMatchPayload(entry.matchIdx, entry),
    };
    // Tag each state with the tx that revealed it so the front can link to
    // the chain explorer. states[i] is produced by the i-th reveal.
    try {
      const reveals = await loadReveals(chain.name, entry.matchIdx);
      // Transitional frames are synthesized between real states - tag only
      // the real ones, in order, with the reveal tx that produced them.
      let k = 0;
      for (const s of payload.states) {
        s.revealTx = s.transitional ? null : (reveals[k++]?.tx_hash ?? null);
      }
    } catch {
      // db down - states just render without links
    }
    res.json(payload);
  });

  return r;
}

// Raw indexed data
export function createIndexerApi(indexer) {
  const r = Router();

  r.get("/matches", (req, res) => {
    res.json(indexer.list());
  });

  r.get("/matches/:matchIdx", (req, res) => {
    const match = indexer.get(req.params.matchIdx);
    if (!match) {
      return res
        .status(404)
        .json({ error: `Unknown match '${req.params.matchIdx}'` });
    }
    res.json(match);
  });

  return r;
}
