// End-to-end test on real NEAR testnet: two agents play a full 20-round
// match through the deployed contract's commit/reveal protocol, then the
// NEAR indexer is pointed at testnet and must produce the same entry shape
// the front consumes.
//
//   node deploy_near.mjs   # once - writes .env.near
//   node test_near_chain.mjs
//
// Agents sign commitments exactly like EVM agents (keccak256 of
// abi.encodePacked move); the operator NEAR account relays both.
// NOTE: seed_part is a u64 in the contract; JSON args lose integer
// precision above 2^53, so seeds stay < 2^53 here (the relay must do the
// same for NEAR matches - EVM accepts the full u256).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { ethers } from "ethers";
import { moveCommitment } from "./gameEncoding.js";
import { createNearIndexer } from "./nearIndexer.js";
import { toListItem, toMatchPayload } from "./matchView.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const N_ROUNDS = 20;
const GAS = "300000000000000"; // 300 Tgas - reveals run many keccaks

// load .env.near written by deploy_near.mjs
const envPath = path.join(HERE, ".env.near");
if (!existsSync(envPath)) {
  console.error("run `node deploy_near.mjs` first to create .env.near");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=")),
);
const CONTRACT = env.NEAR_CONTRACT_ACCOUNT;
const OPERATOR_KEY = env.NEAR_OPERATOR_ACCOUNT;

const provider = new JsonRpcProvider({ url: RPC });
const operator = new Account(
  CONTRACT,
  provider,
  new KeyPairSigner(KeyPair.fromString(OPERATOR_KEY)),
);

// two agents - ECDSA identities, same as EVM matches
const agents = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom()];
const matchIdx = Math.floor(Math.random() * 1_000_000);
console.log(`match ${matchIdx} on ${CONTRACT}`);
console.log(`agent0: ${agents[0].address}`);
console.log(`agent1: ${agents[1].address}`);

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// small seeds (<2^53) - the JSON arg serializer is exact below that
const seed = () => Math.floor(Math.random() * 2 ** 40);

function makeMove(stateIdx, shoot) {
  // every outfield player moves randomly within the contract's delta cap
  // of +-5 on both axes; the contract pins the goalkeeper (idx 0)
  const d = Array.from({ length: 11 }, (_, j) =>
    j === 0 ? [0, 0] : [randInt(-5, 5), randInt(-5, 5)],
  );
  return {
    stateIdx,
    deltaPlayerPositions: d,
    commands: [0, shoot ? 1 : 0],
    seedPart: seed(),
  };
}

function sigOf(wallet, commitment) {
  const sig = wallet.signingKey.sign(commitment);
  return {
    v: sig.v,
    r: Array.from(ethers.getBytes(sig.r)),
    s: Array.from(ethers.getBytes(sig.s)),
  };
}

const call = (methodName, args) =>
  operator.callFunction({
    contractId: CONTRACT,
    methodName,
    args,
    gas: GAS,
  });

const toContractMove = (m) => ({
  state_idx: m.stateIdx,
  delta_player_positions: m.deltaPlayerPositions,
  commands: m.commands,
  seed_part: m.seedPart,
});

console.log("playing 20 rounds of commit/reveal on testnet ...");
for (let round = 0; round < N_ROUNDS; round++) {
  const moves = [makeMove(round, round % 4 === 3), makeMove(round, false)];
  const commitments = [
    moveCommitment(matchIdx, moves[0]),
    moveCommitment(matchIdx, moves[1]),
  ];
  const data = commitments.map((c) => Array.from(ethers.getBytes(c)));
  const signatures = [
    sigOf(agents[0], commitments[0]),
    sigOf(agents[1], commitments[1]),
  ];

  await call("commit", {
    match_idx: matchIdx,
    data,
    signatures,
  });
  await call("reveal", {
    match_idx: matchIdx,
    moves: moves.map(toContractMove),
  });
  if (round % 5 === 0) console.log(`  round ${round} settled`);
}
console.log("match finished on-chain");

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`PASS ${name}`);
  else {
    console.log(`FAIL ${name}`);
    failed++;
  }
};

// ---- index the real deployment -------------------------------------

const indexer = createNearIndexer({
  rpcUrl: RPC,
  contractAddress: CONTRACT,
  label: "near-testnet",
  pollIntervalMs: 60_000,
});
// "final" finality can lag the last reveal by a couple of blocks - poll
// until the match is fully indexed (or give up after ~30s).
let e = null;
for (let i = 0; i < 10; i++) {
  await indexer._tickOnce();
  e = indexer.get(matchIdx);
  if (e?.metadata?.stateIdx >= N_ROUNDS && e?.states?.length >= N_ROUNDS) break;
  await new Promise((r) => setTimeout(r, 3000));
}

check("match discovered", indexer.matches.includes(matchIdx));
check(
  "agents bound via ecrecover",
  e.metadata.agents[0].toLowerCase() === agents[0].address.toLowerCase() &&
    e.metadata.agents[1].toLowerCase() === agents[1].address.toLowerCase(),
);
check("20 states indexed", e.states.length === 20);
check("stateIdx=20 ended", e.metadata.stateIdx === 20 && e.ended);
check("player stats populated", e.metadata.playerStats[0][0][0] >= 0);
check(
  "shot events indexed",
  Object.values(e.events).some((evs) => evs.some((ev) => ev.kind === "shot")),
);

const item = toListItem(matchIdx, e);
check("list item finished", item.status === "finished");
const payload = toMatchPayload(matchIdx, e);
check(
  "payload renders",
  payload.status === "finished" &&
    payload.states.length > 0 &&
    Object.keys(payload.roster).length === 22,
);
check(
  "score recorded",
  payload.states.at(-1).score.A + payload.states.at(-1).score.B >= 0,
);

console.log(failed ? `\n${failed} checks FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
