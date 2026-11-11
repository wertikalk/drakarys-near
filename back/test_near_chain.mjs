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

const FIELD_W = 1024;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Current on-chain match (null before the first commit). Optimistic
// finality so the previous round's reveal is visible right away.
const viewMatch = () =>
  provider.callFunction({
    contractId: CONTRACT,
    method: "get_match",
    args: { match_idx: matchIdx },
    blockQuery: { finality: "optimistic" },
  });

// `view` is the match as of the previous round (unused in round 0, which
// only reveals the seed).
function makeMove(stateIdx, team, view) {
  // every outfield player moves randomly within the contract's delta cap
  // of +-5 on both axes; the contract pins the goalkeeper (idx 0)
  const d = Array.from({ length: 11 }, (_, j) =>
    j === 0 ? [0, 0] : [randInt(-5, 5), randInt(-5, 5)],
  );
  const commands = [0, 0];
  if (view && view.state.has_ball_team_idx === team) {
    // Where each of our players ends up this round (delta * speed, clamped
    // to the field) - passes and shots resolve after the move.
    const xs = view.state.teams[team].player_positions.map((pos, j) =>
      j === 0
        ? pos[0]
        : clamp(pos[0] + d[j][0] * view.player_stats[team][j][1], 0, FIELD_W),
    );
    // how deep a player is in the opposing half (team 0 attacks +x)
    const depth = (j) =>
      team === 0 ? xs[j] - FIELD_W / 2 : FIELD_W / 2 - xs[j];
    // pass to our most advanced player (passing to the holder = no pass)
    // and shoot whenever he is in the opposing half - goals only count
    // from there
    const target = xs
      .map((_, j) => j)
      .reduce((a, j) => (depth(j) > depth(a) ? j : a));
    commands[0] = target;
    commands[1] = depth(target) > 0 ? 1 : 0;
  }
  return {
    stateIdx,
    deltaPlayerPositions: d,
    commands,
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
  // wait until the previous round's state is visible to the view call
  let view = null;
  for (let i = 0; round > 0 && i < 20; i++) {
    view = await viewMatch();
    if (view?.state_idx === round) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const moves = [makeMove(round, 0, view), makeMove(round, 1, view)];
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
