import express from "express";
import cors from "cors";
import { loadChains } from "./chains.js";
import { createNearIndexer } from "./nearIndexer.js";
import { createNearMatchmaking } from "./nearMatchmaking.js";
import { createDrakarysApi, createIndexerApi } from "./api.js";
import { createAuthApi } from "./auth.js";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // set HOST=127.0.0.1 behind a proxy
const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(BASE_DIR, "icons");
// Front-end build output; override with FRONT_DIST if it lives elsewhere.
const FRONT_DIST =
  process.env.FRONT_DIST || path.join(BASE_DIR, "..", "front", "dist");
const FRONT_INDEX = path.join(FRONT_DIST, "index.html");

// One runtime per configured chain: own indexer poll loop, and (if an
// operator key is set) its own matchmaking relay.
const { chains, defaultName } = loadChains();
const runtimes = new Map(); // name -> { chain, indexer, matchmaking }

for (const chain of chains) {
  const indexer = createNearIndexer({
    label: chain.name,
    rpcUrl: chain.rpcUrl,
    contractAddress: chain.contractAddress,
    txApiUrl: chain.txApiUrl,
    ignoredMatches: chain.ignoredMatches,
    pollIntervalMs: chain.pollIntervalMs,
    onMatchStarted: (matchIdx) =>
      console.log(`[indexer:${chain.name}] match ${matchIdx} started`),
  });
  let matchmaking = null;
  if (chain.operatorKey) {
    matchmaking = createNearMatchmaking({
      label: chain.name,
      rpcUrl: chain.rpcUrl,
      contractAddress: chain.contractAddress,
      operatorKey: chain.operatorKey,
      operatorAccountId: chain.operatorAccountId ?? undefined,
      indexer,
    });
  } else {
    console.warn(
      `[matchmaking:${chain.name}] no operator key - agent endpoints disabled`,
    );
  }
  runtimes.set(chain.name, { chain, indexer, matchmaking });
}

const defaultRt = runtimes.get(defaultName);

for (const { indexer } of runtimes.values()) indexer.start();

app.use(cors({ origin: true, credentials: true }));
app.use("/api/auth", createAuthApi());
app.use(express.json());
app.set("trust proxy", 1); // behind a TLS-terminating reverse proxy

// Chain icons live in ./icons; warn early if a configured icon is missing.
// '/...' paths are served from the front's public dir, http(s) is remote.
for (const c of chains) {
  if (
    c.icon &&
    !c.icon.startsWith("/") &&
    !/^https?:\/\//.test(c.icon) &&
    !existsSync(path.join(ICONS_DIR, c.icon))
  ) {
    console.warn(
      `[chain:${c.name}] icon '${c.icon}' not found in ${ICONS_DIR}`,
    );
  }
}
app.use("/api/chains/icons", express.static(ICONS_DIR));

app.get("/api/chains", (req, res) => {
  res.json(
    chains.map((c) => ({
      name: c.name,
      contractAddress: c.contractAddress,
      icon: c.icon
        ? /^https?:\/\//.test(c.icon) || c.icon.startsWith("/")
          ? c.icon // remote url or frontend public asset
          : `/api/chains/icons/${c.icon}`
        : null,
      default: c.default,
      explorer: c.explorer ?? null,
      local:
        /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])/i.test(
          c.rpcUrl,
        ),
      matchmaking: Boolean(runtimes.get(c.name).matchmaking),
    })),
  );
});

// Per-chain routes: /api/chains/<name>/drakarys/* and .../indexer/*
const mountChain = (prefix, make) => {
  const cache = new Map();
  app.use(prefix, (req, res, next) => {
    const rt = runtimes.get(req.params.chain);
    if (!rt) {
      return res
        .status(404)
        .json({ error: `unknown chain '${req.params.chain}'` });
    }
    if (!cache.has(rt.chain.name)) cache.set(rt.chain.name, make(rt));
    cache.get(rt.chain.name)(req, res, next);
  });
};
mountChain("/api/chains/:chain/drakarys", createDrakarysApi);
mountChain("/api/chains/:chain/indexer", (rt) => createIndexerApi(rt.indexer));

// Legacy single-chain paths -> default chain
app.use("/api/drakarys", createDrakarysApi(defaultRt));
app.use("/api/indexer", createIndexerApi(defaultRt.indexer));

// Front-end: serve the vite build and fall back to index.html for client-side
// routes (react-router). API routes registered above take precedence.
if (existsSync(FRONT_INDEX)) {
  app.use(express.static(FRONT_DIST));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(FRONT_INDEX);
  });
} else {
  console.warn(
    `[front] ${FRONT_INDEX} not found - API only (run 'npm run build' in front/)`,
  );
}

// Unmatched /api/* gets a JSON 404, not index.html
app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
