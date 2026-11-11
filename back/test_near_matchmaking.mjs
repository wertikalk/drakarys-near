// End-to-end test of the NEAR matchmaking relay on real testnet: two agents
// join, get paired, and play a full 20-round match through
// joinMatch/submitCommit/submitReveal - the same calls the API routes make.
//
//   node deploy_near.mjs   # once - writes .env.near
//   node --env-file=.env.near test_near_matchmaking.mjs

import { ethers } from "ethers";
import { moveCommitment } from "./gameEncoding.js";
import { createNearIndexer } from "./nearIndexer.js";
import { createNearMatchmaking } from "./nearMatchmaking.js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const CONTRACT = process.env.NEAR_CONTRACT_ACCOUNT;
const OPERATOR_KEY = process.env.NEAR_OPERATOR_ACCOUNT;
const N_ROUNDS = 20;

if (!CONTRACT || !OPERATOR_KEY) {
  console.error("run with --env-file=.env.near (see deploy_near.mjs)");
  process.exit(1);
}

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`PASS ${name}`);
  else {
    console.log(`FAIL ${name}`);
    failed++;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

const indexer = createNearIndexer({
  rpcUrl: RPC,
  contractAddress: CONTRACT,
  label: "near-test-relay",
  pollIntervalMs: 60_000,
});
await indexer._tickOnce();

const mm = createNearMatchmaking({
  rpcUrl: RPC,
  contractAddress: CONTRACT,
  operatorKey: OPERATOR_KEY,
  indexer,
  label: "near-test-relay",
});

const agents = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom()];

// ---- pairing -----------------------------------------------------------

const first = await mm.joinMatch(agents[0].address);
check("first agent waits", first.status === "waiting");
const second = await mm.joinMatch(agents[1].address);
check("second agent is matched", second.status === "matched");
const again = await mm.joinMatch(agents[0].address);
check(
  "first agent sees the same match",
  again.status === "matched" && again.matchIdx === second.matchIdx,
);
check("slots follow join order", again.slot === 0 && second.slot === 1);
const matchIdx = second.matchIdx;
check("fresh match idx", !indexer.matches.includes(matchIdx));
console.log(`match ${matchIdx} on ${CONTRACT}`);

// ---- request validation -------------------------------------------------

const makeMove = (stateIdx) => ({
  stateIdx,
  deltaPlayerPositions: Array.from({ length: 11 }, () => [
    randInt(-5, 5),
    randInt(-5, 5),
  ]),
  commands: [randInt(0, 10), stateIdx % 4 === 3 ? 1 : 0],
  // decimal string, like the python agents send
  seedPart: String(randInt(1, 2 ** 40)),
});

const signed = (wallet, move) => {
  const commitment = moveCommitment(matchIdx, move);
  const sig = wallet.signingKey.sign(commitment);
  return { agent: wallet.address, commitment, v: sig.v, r: sig.r, s: sig.s };
};

const stranger = ethers.Wallet.createRandom();
check(
  "commit from a non-participant is rejected",
  (await mm.submitCommit(matchIdx, signed(stranger, makeMove(0)))).status ===
    403,
);
check(
  "commit with someone else's signature is rejected",
  (
    await mm.submitCommit(matchIdx, {
      ...signed(agents[1], makeMove(0)),
      agent: agents[0].address,
    })
  ).status === 400,
);
check(
  "reveal before commit is rejected",
  (
    await mm.submitReveal(matchIdx, {
      agent: agents[0].address,
      move: makeMove(0),
    })
  ).status === 409,
);

// ---- full match ---------------------------------------------------------

const waitFor = async (what, cond) => {
  for (let i = 0; i < 120; i++) {
    if (cond(mm.getMatch(matchIdx))) return;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
};

console.log("playing 20 rounds through the relay ...");
for (let round = 0; round < N_ROUNDS; round++) {
  const moves = [makeMove(round), makeMove(round)];
  for (const i of [0, 1]) {
    const res = await mm.submitCommit(matchIdx, signed(agents[i], moves[i]));
    if (res.status !== 200) throw new Error(`commit ${round}: ${res.error}`);
  }
  await waitFor(`commit ${round}`, (m) => m.phase === "reveal");

  if (round === 0) {
    check(
      "reveal that doesn't match the commitment is rejected",
      (
        await mm.submitReveal(matchIdx, {
          agent: agents[0].address,
          move: { ...moves[0], seedPart: "1" },
        })
      ).status === 400,
    );
  }
  for (const i of [0, 1]) {
    const res = await mm.submitReveal(matchIdx, {
      agent: agents[i].address,
      move: moves[i],
    });
    if (res.status !== 200) throw new Error(`reveal ${round}: ${res.error}`);
  }
  await waitFor(`reveal ${round}`, (m) => m.stateIdx === round + 1);
  if (round % 5 === 0) console.log(`  round ${round} settled`);
}

check("relay reports the match done", mm.getMatch(matchIdx).ended === true);
check(
  "agents are free to join again",
  (await mm.joinMatch(agents[0].address)).status === "waiting",
);

// ---- the chain agrees ---------------------------------------------------

// "final" finality can lag the last reveal by a couple of blocks
let e = null;
for (let i = 0; i < 10; i++) {
  await indexer._tickOnce();
  e = indexer.get(matchIdx);
  if (e?.metadata?.stateIdx >= N_ROUNDS) break;
  await sleep(3000);
}
check("match indexed as ended", e?.ended === true && e.states.length === 20);
check(
  "agents bound on-chain in slot order",
  e?.metadata.agents[0].toLowerCase() === agents[0].address.toLowerCase() &&
    e?.metadata.agents[1].toLowerCase() === agents[1].address.toLowerCase(),
);
check(
  "relay exposes the indexed state to agents",
  mm.getMatch(matchIdx).indexed?.metadata.stateIdx === N_ROUNDS,
);

console.log(failed ? `\n${failed} checks FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
