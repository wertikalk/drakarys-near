// Matchmaking + move relay for the NEAR Drakarys contract (sc-near/).
//
// Agents register interest via join-match; pairs are assigned a matchIdx and
// an agent slot (slot = team index on-chain). Each round both agents POST a
// signed commitment to /commit; once both are in, the operator account sends
// the on-chain commit call. Then both agents POST their move to /reveal and
// the operator sends reveal. Agents must not move on until the current round
// is revealed - /state exposes the phase + stateIdx so they can wait.
//
// Agents are ECDSA identities (the contract ecrecovers them from the signed
// commitments); only the operator needs a NEAR account.

import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { ethers } from "ethers";
import { moveCommitment } from "./gameEncoding.js";
import * as db from "./db.js";

const N_ROUNDS = 20;
const N_PLAYERS = 11;
const GAS = "300000000000000"; // 300 Tgas - reveals run many keccaks
const TX_TIMEOUT_MS = 60_000;
const RETRY_MS = 3000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);
}

// The contract takes u64 JSON numbers, which are only exact below 2^53.
const safeUint = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("not a safe uint");
  return n;
};
const safeInt = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error("not a safe int");
  return n;
};

// Agent move ({stateIdx, deltaPlayerPositions, commands, seedPart}) -> the
// contract's JSON Move. Throws on anything the contract can't represent.
function toContractMove(move) {
  const deltas = move.deltaPlayerPositions ?? [];
  const commands = move.commands ?? [];
  if (deltas.length !== N_PLAYERS || commands.length !== 2) {
    throw new Error("bad move shape");
  }
  return {
    state_idx: safeUint(move.stateIdx),
    delta_player_positions: deltas.map((d) => [safeInt(d[0]), safeInt(d[1])]),
    commands: commands.map(safeUint),
    seed_part: safeUint(move.seedPart),
  };
}

export function createNearMatchmaking({
  rpcUrl,
  contractAddress,
  // secret key ("ed25519:...") of the operator account
  operatorKey,
  // the contract's operator is the account that called new() - the contract
  // account itself for deploy_near.mjs deployments
  operatorAccountId = contractAddress,
  indexer,
  // Chain tag for log lines, e.g. "near-testnet"
  label = null,
}) {
  const tag = label ? `[matchmaking:${label}]` : "[matchmaking]";
  const operator = new Account(
    operatorAccountId,
    new JsonRpcProvider({ url: rpcUrl }),
    new KeyPairSigner(KeyPair.fromString(operatorKey)),
  );

  // All matches share the operator's access key, so calls go out one at a
  // time to keep its nonce ordered. The timeout keeps a stalled RPC call
  // from wedging the queue - callers retry on failure.
  let txQueue = Promise.resolve();
  function sendGameTx(methodName, args) {
    const run = () =>
      withTimeout(
        operator.callFunctionRaw({
          contractId: contractAddress,
          methodName,
          args,
          gas: GAS,
        }),
        TX_TIMEOUT_MS,
        methodName,
      );
    const result = txQueue.then(run, run);
    txQueue = result.catch(() => {});
    return result;
  }

  // Fire-and-forget persistence; a db blip must not stall a live match.
  const markTx = (table, matchIdx, stateIdx, res) =>
    db
      .markPlayedTx(label, table, matchIdx, stateIdx, res)
      .catch((err) =>
        console.error(
          `${tag} db mark ${table} ${matchIdx}/${stateIdx}:`,
          err.message,
        ),
      );

  const lobby = []; // agent addresses waiting for an opponent
  const matches = new Map(); // matchIdx -> match record
  const byAgent = new Map(); // agent address -> matchIdx (active match)
  const pairing = new Map(); // agent address -> promise of its new match

  let nextMatchIdx = null;
  async function reserveMatchIdx() {
    if (nextMatchIdx === null) {
      const seen = indexer.matches.length
        ? Math.max(...indexer.matches.map((m) => Number(m)))
        : -1;
      nextMatchIdx = seen + 1;
    }
    // Ids the indexer ignores (or hasn't discovered yet) may still exist
    // on-chain - probe the contract and skip occupied ids instead of
    // colliding (every commit would then fail "Invalid signature").
    for (;;) {
      const idx = nextMatchIdx++;
      try {
        if ((await indexer._callView("get_match", { match_idx: idx })) === null)
          return idx;
        console.log(`${tag} match idx ${idx} occupied on-chain - skipping`);
      } catch {
        return idx; // probe failed - don't burn idx candidates on RPC hiccups
      }
    }
  }

  async function joinMatch(agent) {
    const addr = ethers.getAddress(agent); // validates + checksums
    const active = byAgent.get(addr);
    if (active !== undefined) {
      return matchInfo(matches.get(active), addr);
    }
    // createMatch is async - a poll in the gap must not drop the agent
    // back into the lobby and trigger a second pairing
    if (pairing.has(addr)) return matchInfo(await pairing.get(addr), addr);
    if (!lobby.includes(addr)) lobby.push(addr);
    if (lobby.length < 2) return { status: "waiting" };
    const agents = [lobby.shift(), lobby.shift()];
    const created = createMatch(agents).finally(() =>
      agents.forEach((a) => pairing.delete(a)),
    );
    agents.forEach((a) => pairing.set(a, created));
    return matchInfo(await created, addr);
  }

  async function createMatch(agents) {
    const matchIdx = await reserveMatchIdx();
    const match = {
      matchIdx,
      agents,
      phase: "commit", // commit | commit_pending | reveal | reveal_pending | done
      stateIdx: 0,
      commits: new Map(),
      reveals: new Map(),
      sending: false,
    };
    matches.set(matchIdx, match);
    agents.forEach((a) => byAgent.set(a, matchIdx));
    console.log(`${tag} match ${matchIdx}: ${agents[0]} vs ${agents[1]}`);
    indexer.wake();
    return match;
  }

  function matchInfo(match, agent) {
    return {
      status: "matched",
      matchIdx: match.matchIdx,
      agents: match.agents,
      slot: agent ? match.agents.indexOf(ethers.getAddress(agent)) : null,
    };
  }

  function getMatch(matchIdx) {
    const match = matches.get(Number(matchIdx));
    if (!match) return null;
    const indexed = indexer.get(matchIdx);
    return {
      matchIdx: match.matchIdx,
      agents: match.agents,
      phase: match.phase,
      stateIdx: match.stateIdx,
      ended: match.phase === "done",
      committed: match.agents.map((a) => match.commits.has(a)),
      revealed: match.agents.map((a) => match.reveals.has(a)),
      indexed: indexed
        ? {
            ended: indexed.ended,
            metadata: indexed.metadata,
            updatedAt: indexed.updatedAt,
            // raw on-chain state - what an agent should base its next move on
            latest: indexed.states[indexed.states.length - 1] ?? null,
          }
        : null,
    };
  }

  function agentSlot(match, agent) {
    const addr = ethers.getAddress(agent);
    return match.agents.findIndex((a) => a === addr);
  }

  // Recover the signer over the raw 32-byte commitment hash - the contract
  // ecrecovers the same way, so we can reject bad signatures early.
  function recoverSigner(commitment, sig) {
    const signature = ethers.Signature.from({
      r: sig.r,
      s: sig.s,
      v: Number(sig.v),
    });
    return ethers.computeAddress(
      ethers.SigningKey.recoverPublicKey(commitment, signature),
    );
  }

  async function submitCommit(matchIdx, { agent, commitment, v, r, s }) {
    const match = matches.get(Number(matchIdx));
    if (!match) return { status: 404, error: "unknown match" };
    if (match.phase !== "commit") {
      return { status: 409, error: `match is in phase '${match.phase}'` };
    }
    const slot = agentSlot(match, agent);
    if (slot < 0) return { status: 403, error: "agent not in this match" };
    if (recoverSigner(commitment, { v, r, s }) !== match.agents[slot]) {
      return { status: 400, error: "bad signature" };
    }
    match.commits.set(match.agents[slot], { commitment, v: Number(v), r, s });
    db.upsertCommitPiece(
      label,
      match.matchIdx,
      match.stateIdx,
      slot,
      commitment,
      { v: Number(v), r, s },
    ).catch((err) =>
      console.error(`${tag} db commit piece ${match.matchIdx}:`, err.message),
    );
    void sendCommitIfReady(match);
    return { status: 200, ok: true };
  }

  async function submitReveal(matchIdx, { agent, move }) {
    const match = matches.get(Number(matchIdx));
    if (!match) return { status: 404, error: "unknown match" };
    if (match.phase !== "reveal") {
      return { status: 409, error: `match is in phase '${match.phase}'` };
    }
    const slot = agentSlot(match, agent);
    if (slot < 0) return { status: 403, error: "agent not in this match" };
    const expected = match.commits.get(match.agents[slot])?.commitment;
    try {
      if (expected && moveCommitment(match.matchIdx, move) !== expected) {
        return { status: 400, error: "move does not match commitment" };
      }
    } catch {
      return { status: 400, error: "malformed move" };
    }
    try {
      toContractMove(move);
    } catch {
      return {
        status: 400,
        error: "move not representable on NEAR (seedPart must be below 2^53)",
      };
    }
    match.reveals.set(match.agents[slot], move);
    db.upsertRevealMove(
      label,
      match.matchIdx,
      match.stateIdx,
      slot,
      move,
    ).catch((err) =>
      console.error(`${tag} db reveal piece ${match.matchIdx}:`, err.message),
    );
    void sendRevealIfReady(match);
    return { status: 200, ok: true };
  }

  async function sendCommitIfReady(match) {
    if (match.sending || match.commits.size < match.agents.length) return;
    match.sending = true;
    match.phase = "commit_pending";
    const sIdx = match.stateIdx;
    try {
      const commits = match.agents.map((a) => match.commits.get(a));
      const res = await sendGameTx("commit", {
        match_idx: match.matchIdx,
        data: commits.map((c) => Array.from(ethers.getBytes(c.commitment))),
        signatures: commits.map((c) => ({
          v: c.v,
          r: Array.from(ethers.getBytes(c.r)),
          s: Array.from(ethers.getBytes(c.s)),
        })),
      });
      const txHash = res.transaction?.hash;
      markTx("commits", match.matchIdx, sIdx, { sent: true, ok: true, txHash });
      match.phase = "reveal";
      indexer.wake();
      console.log(`${tag} match ${match.matchIdx} commit landed (${txHash})`);
    } catch (err) {
      markTx("commits", match.matchIdx, sIdx, { sent: false, ok: false });
      console.error(
        `${tag} match ${match.matchIdx} commit tx failed:`,
        err.message,
      );
      // re-sending a commit that landed anyway just re-stores the same data
      match.phase = "commit";
      match.sending = false;
      setTimeout(() => sendCommitIfReady(match), RETRY_MS);
      return;
    }
    match.sending = false;
  }

  function advance(match, stateIdx) {
    match.stateIdx = stateIdx;
    match.commits.clear();
    match.reveals.clear();
    match.phase = match.stateIdx >= N_ROUNDS ? "done" : "commit";
    if (match.phase === "done") {
      match.agents.forEach((a) => byAgent.delete(a));
    }
    indexer.wake();
  }

  async function sendRevealIfReady(match) {
    if (match.sending || match.reveals.size < match.agents.length) return;
    match.sending = true;
    match.phase = "reveal_pending";
    const sIdx = match.stateIdx;
    try {
      const res = await sendGameTx("reveal", {
        match_idx: match.matchIdx,
        moves: match.agents.map((a) => toContractMove(match.reveals.get(a))),
      });
      const txHash = res.transaction?.hash;
      markTx("reveals", match.matchIdx, sIdx, { sent: true, ok: true, txHash });
      advance(match, match.stateIdx + 1);
      console.log(
        `${tag} match ${match.matchIdx} reveal landed, stateIdx -> ${match.stateIdx} (${txHash})`,
      );
    } catch (err) {
      console.error(
        `${tag} match ${match.matchIdx} reveal tx failed:`,
        err.message,
      );
      // The tx may have landed anyway despite the timeout - resending a
      // reveal that already went through would fail its commit check, so
      // reconcile with the chain first.
      try {
        const view = await indexer._callView("get_match", {
          match_idx: match.matchIdx,
        });
        if (Number(view?.state_idx) > match.stateIdx) {
          markTx("reveals", match.matchIdx, sIdx, { sent: true, ok: true });
          advance(match, Number(view.state_idx));
          match.sending = false;
          console.log(
            `${tag} match ${match.matchIdx} reveal landed after all, stateIdx -> ${match.stateIdx}`,
          );
          return;
        }
      } catch {
        // can't read the chain either - just retry below
      }
      markTx("reveals", match.matchIdx, sIdx, { sent: false, ok: false });
      match.phase = "reveal"; // reveals stay collected; retry shortly
      match.sending = false;
      setTimeout(() => sendRevealIfReady(match), RETRY_MS);
      return;
    }
    match.sending = false;
  }

  return { joinMatch, submitCommit, submitReveal, getMatch };
}
