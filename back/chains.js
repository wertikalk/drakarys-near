// Chain registry: one entry per NEAR deployment of Drakarys (sc-near/).
//
// Chains are defined in ./chains.json (override the path with CHAINS_CONFIG).
// Each entry:
//   name            route key, e.g. /api/chains/<name>/drakarys/list
//   rpcUrl          NEAR JSON-RPC endpoint
//   contractAddress account id the contract is deployed to
//   pollIntervalMs  indexer poll cadence (default INDEXER_POLL_MS || 2000)
//   ignoredMatches  optional - match ids to hide from indexing
//   explorer        optional - tx link template, e.g. https://.../txns/{tx}
//   icon            optional - filename in ./icons, served at
//                   /api/chains/icons/<icon>
//   operatorKeyEnv  name of the env var holding the operator key - keep keys
//                   out of the config file
//   default         serves the legacy /api/drakarys/* routes (first wins)
//
// Any scalar can be overridden per chain via env:
//   CHAIN_<NAME>_RPC_URL | _GAME_ADDRESS | _OPERATOR_PRIVATE_KEY
// (<NAME> = uppercased name, non-alphanumeric -> _)
// Legacy single-chain vars (RPC_URL, GAME_ADDRESS, OPERATOR_PRIVATE_KEY,
// INDEXER_POLL_MS) still apply to the default chain.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const envKey = (name) => name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
const chainEnv = (name, key) =>
  process.env[`CHAIN_${envKey(name)}_${key}`] ?? undefined;
const num = (v, d) =>
  v === undefined || v === null || v === "" ? d : Number(v);

// Built-in fallback so the backend still boots with zero config.
const DEFAULT_CHAINS = [
  {
    name: "near-testnet",
    type: "near",
    rpcUrl: "https://test.rpc.fastnear.com",
    contractAddress: "dev-1794239937284-45iftw.testnet",
    operatorKeyEnv: "NEAR_OPERATOR_ACCOUNT",
    default: true,
  },
];

function readConfigFile() {
  const file = process.env.CHAINS_CONFIG || path.join(HERE, "chains.json");
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const list = Array.isArray(raw) ? raw : raw.chains;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${file}: expected a non-empty "chains" array`);
  }
  return {
    list,
    defaultName: Array.isArray(raw) ? null : (raw.default ?? null),
  };
}

export function loadChains() {
  const file = readConfigFile();
  const list = file?.list ?? DEFAULT_CHAINS;
  const defaultName =
    process.env.DEFAULT_CHAIN ??
    file?.defaultName ??
    list.find((c) => c.default)?.name ??
    list[0].name;

  const chains = list.map((c) => {
    if (!c.name) throw new Error("every chain requires a name");
    const isDefault = c.name === defaultName;
    const legacy = isDefault ? process.env : {}; // legacy vars apply to default only
    const chain = {
      name: c.name,
      type: c.type ?? "near",
      rpcUrl: chainEnv(c.name, "RPC_URL") ?? legacy.RPC_URL ?? c.rpcUrl,
      contractAddress:
        chainEnv(c.name, "GAME_ADDRESS") ??
        legacy.GAME_ADDRESS ??
        c.contractAddress,
      icon: c.icon ?? null,
      explorer: c.explorer ?? null,
      // match ids to hide from indexing (test artifacts)
      ignoredMatches: c.ignoredMatches ?? [],
      pollIntervalMs: num(
        c.pollIntervalMs,
        Number(process.env.INDEXER_POLL_MS || 2000),
      ),
      operatorKey:
        chainEnv(c.name, "OPERATOR_PRIVATE_KEY") ??
        (c.operatorKeyEnv ? process.env[c.operatorKeyEnv] : undefined) ??
        legacy.OPERATOR_PRIVATE_KEY ??
        null,
      default: isDefault,
    };
    if (chain.type !== "near") {
      throw new Error(`chain '${c.name}': unsupported type '${chain.type}'`);
    }
    if (!chain.rpcUrl || !chain.contractAddress) {
      throw new Error(`chain '${c.name}' requires rpcUrl and contractAddress`);
    }
    return chain;
  });
  return { chains, defaultName };
}
