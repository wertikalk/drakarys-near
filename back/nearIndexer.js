// Indexing component for the NEAR port of Drakarys_GAME_0 (sc-near/).
// Mirrors indexer.js's interface so api.js and index.js can treat every
// chain the same.
//
// NEAR is the simplest chain to index: the contract keeps the full state
// history and event log on-chain (bounded by N_ROUNDS + 1 states and a
// handful of events per round), so a single `get_match` view call per match
// per poll yields complete, always-consistent data - no log scanning, no
// state reconstruction, no transaction replay.
//
// RPC: plain NEAR JSON-RPC `query`/`call_function` over fetch - no SDK
// needed, indexing never signs.

import * as db from "./db.js";

const N_ROUNDS = 20;
const INITIAL_SLEEP_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVITY_SLEEP_MS = 15 * 60 * 1000; // 15 minutes
const DISCOVERY_PAGE = 256; // match ids per get_match_ids call
const TX_BATCH = 20; // tx hashes per /v0/transactions call
const TX_MAX_PAGES = 10; // account tx history pages scanned per attempt
const TX_RETRY_MS = 10_000;
const TX_MAX_ATTEMPTS = 5;

// Shared across indexer instances - see indexer.js.
const dbReady = db
  .initDb()
  .then(() => true)
  .catch((err) => {
    console.error(
      `[indexer] postgres unavailable (${err.message}) - running in-memory only`,
    );
    return false;
  });

const num = (v) => (typeof v === "object" && v !== null ? Number(v) : v);

export function createNearIndexer({
  rpcUrl,
  contractAddress, // the account the contract is deployed to
  // FastNear-style tx API (e.g. https://tx.test.fastnear.com) used to map
  // reveals to their transaction hashes for explorer links; null = no links
  txApiUrl = null,
  label = null,
  // match ids to never index (test artifacts)
  ignoredMatches = [],
  pollIntervalMs = 4000, // NEAR view calls are cheap; blocks are ~1.2s
  onMatchStarted = null,
}) {
  const tag = label ? `[indexer:${label}]` : "[indexer]";
  const chain = label ?? "default"; // DB chain key - matches are (chain, matchIdx)
  const ignored = new Set(ignoredMatches.map(Number));

  const matches = []; // ordered list of discovered matchIdx values
  const matchData = new Map(); // matchIdx -> { metadata, states, events, ... }
  let timer = null;
  let sleepTimer = null;
  let ticking = false;
  let dbOk = false;
  let isSleeping = false;
  let lastActivityTime = Date.now();
  let discoverOffset = 0; // paging cursor over get_match_ids
  const pendingTx = new Set(); // "matchIdx:stateIdx" reveals lacking a tx hash
  let txAttempts = 0;
  let nextTxResolveAt = 0;

  // Write-through persistence - same fire-and-forget style as indexer.js.
  const persist = (fn, what) =>
    void (dbOk
      ? fn().catch((err) =>
          console.error(`${tag} db ${what}:`, err.shortMessage || err.message),
        )
      : null);

  function persistMatch(matchIdx, entry) {
    persist(
      () =>
        db.upsertMatch(chain, matchIdx, {
          agents: entry.metadata?.agents
            ? JSON.stringify(entry.metadata.agents)
            : null,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
          started_block: entry.startedBlock,
          started_at: entry.startedAt,
          ended: entry.ended,
          states: JSON.stringify(entry.states),
          events: JSON.stringify(entry.events),
        }),
      `match ${matchIdx}`,
    );
  }

  // ---- NEAR JSON-RPC ----

  async function callView(methodName, args) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query",
        params: {
          request_type: "call_function",
          account_id: contractAddress,
          method_name: methodName,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          finality: "final",
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`RPC ${res.status}`);
    }
    const json = await res.json();
    if (json.error) {
      throw new Error(
        json.error?.data?.message ??
          json.error?.data ??
          json.error?.message ??
          "RPC error",
      );
    }
    // call_function results arrive as a byte array of JSON
    const bytes = json.result?.result;
    if (!Array.isArray(bytes)) {
      if (json.result?.logs?.length || json.result?.error) {
        throw new Error(json.result.error ?? "view call failed");
      }
      return null;
    }
    const text = Buffer.from(bytes).toString("utf8");
    return text ? JSON.parse(text) : null;
  }

  // ---- state mapping: snake_case contract JSON -> entry shapes ----

  const toEntryState = (s) => ({
    teams: s.teams.map((t) => ({
      playerPositions: t.player_positions.map((p) => p.map(Number)),
      pass: t.pass,
      passingTo: num(t.passing_to),
      shoot: t.shoot,
    })),
    score: s.score.map(Number),
    hasBallTeamIdx: num(s.has_ball_team_idx),
    hasBallPlayerIdx: num(s.has_ball_player_idx),
  });

  // contract event kind -> the {kind, ...} payloads matchView.js renders
  const toEntryEvent = (e) => {
    switch (e.kind) {
      case "shot":
        return {
          kind: "shot",
          teamIdx: num(e.team_idx),
          playerIdx: num(e.player_idx),
          x: num(e.x),
          y: num(e.y),
          goal: e.goal,
        };
      case "interception":
        return {
          kind: "interception",
          teamIdx: num(e.team_idx),
          playerIdx: num(e.player_idx),
          x: num(e.x),
          y: num(e.y),
        };
      default:
        return null; // lifecycle events - tracked separately, not rendered
    }
  };

  function addMatch(matchIdx) {
    if (ignored.has(Number(matchIdx))) return;
    if (!matchData.has(matchIdx)) {
      matches.push(matchIdx);
      matchData.set(matchIdx, {
        metadata: null,
        states: [],
        events: {},
        startedBlock: null,
        startedAt: null,
        ended: false,
        updatedAt: null,
        fresh: true,
        eventsSeen: 0, // contract events applied so far
      });
    }
  }

  // Persist commit/reveal rows for parity with the other indexers - the
  // contract's event log carries the raw payloads, so no tx scanning is
  // needed. `eventsSeen` makes this idempotent across polls.
  function persistNewEvents(matchIdx, events) {
    const entry = matchData.get(matchIdx);
    for (const e of events) {
      const kind = e.kind;
      if (kind === "move_committed" && Array.isArray(e.data)) {
        persist(
          () =>
            db.insertCommit(chain, {
              matchIdx,
              stateIdx: num(e.state_idx),
              data: e.data.map((c) => Buffer.from(c).toString("hex")),
              signatures: entry?.metadata?.agents ?? [],
              txHash: `near:${chain}:${matchIdx}:${num(e.state_idx)}:commit`,
              blockNumber: null,
            }),
          `commit ${matchIdx}/${num(e.state_idx)}`,
        );
      } else if (kind === "move_revealed" && Array.isArray(e.moves)) {
        persist(
          () =>
            db.insertReveal(chain, {
              matchIdx,
              stateIdx: num(e.state_idx),
              moves: e.moves.map((mv) => ({
                stateIdx: num(mv.state_idx),
                deltaPlayerPositions: mv.delta_player_positions.map((p) =>
                  p.map(Number),
                ),
                commands: mv.commands.map((c) => c.toString()),
                seedPart: mv.seed_part.toString(),
              })),
              txHash: null, // filled in by resolveRevealTxs
              blockNumber: null,
            }),
          `reveal ${matchIdx}/${num(e.state_idx)}`,
        );
        pendingTx.add(`${matchIdx}:${num(e.state_idx)}`);
        txAttempts = 0;
        nextTxResolveAt = 0;
      }
    }
  }

  // Fold a get_match view into the match's entry. The contract returns the
  // full history, so this is a wholesale (idempotent) refresh.
  function applyView(matchIdx, view) {
    const entry = matchData.get(matchIdx);
    if (!entry) return;

    const firstData = entry.metadata === null && view.agents?.length === 2;
    entry.metadata = {
      stateIdx: num(view.state_idx),
      agents: view.agents,
      playerStats: view.player_stats,
    };
    if (firstData && entry.startedAt === null) {
      entry.startedAt = new Date().toISOString();
      if (onMatchStarted && entry.fresh) onMatchStarted(matchIdx);
    }

    // Contract stores the produced states (kick-off at index 0, one per
    // reveal after that) - exactly what the front consumes.
    const prevStateCount = entry.states.length;
    entry.states = view.states.map(toEntryState);

    // Re-bucket renderable events by the round that produced them; the
    // contract log is the single source of truth.
    entry.events = {};
    for (const e of view.events) {
      const mapped = toEntryEvent(e);
      if (!mapped) continue;
      ((entry.events ??= {})[num(e.state_idx)] ??= []).push(mapped);
    }

    // Lifecycle
    const wasEnded = entry.ended;
    entry.ended = view.ended === true || num(view.state_idx) >= N_ROUNDS;
    entry.updatedAt = new Date().toISOString();

    // New contract events since last poll -> commit/reveal rows.
    const newEvents = view.events.slice(entry.eventsSeen ?? 0);
    if (newEvents.length) {
      persistNewEvents(matchIdx, newEvents);
      entry.eventsSeen = view.events.length;
    }

    if (
      entry.states.length !== prevStateCount ||
      entry.ended !== wasEnded ||
      firstData
    ) {
      recordActivity();
      persistMatch(matchIdx, entry);
    }
  }

  async function txApi(path, body) {
    const res = await fetch(`${txApiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`tx api ${res.status}`);
    return res.json();
  }

  // View calls carry no transaction info, so reveal tx hashes come from the
  // contract account's tx history: walk it newest-first and match each
  // `reveal` call's args to the reveals still missing a hash.
  async function resolveRevealTxs() {
    if (!txApiUrl || !dbOk || pendingTx.size === 0) return;
    if (Date.now() < nextTxResolveAt) return;
    let token = null;
    for (let page = 0; page < TX_MAX_PAGES && pendingTx.size; page++) {
      const { account_txs: txs = [], resume_token } = await txApi(
        "/v0/account",
        {
          account_id: contractAddress,
          ...(token ? { resume_token: token } : {}),
        },
      );
      const hashes = txs
        .filter((t) => t.is_receiver && t.is_function_call && t.is_success)
        .map((t) => t.transaction_hash);
      for (let i = 0; i < hashes.length && pendingTx.size; i += TX_BATCH) {
        const { transactions = [] } = await txApi("/v0/transactions", {
          tx_hashes: hashes.slice(i, i + TX_BATCH),
        });
        for (const t of transactions) {
          const call = t.transaction?.actions?.[0]?.FunctionCall;
          if (call?.method_name !== "reveal") continue;
          const args = JSON.parse(Buffer.from(call.args, "base64").toString());
          const stateIdx = args.moves?.[0]?.state_idx;
          const key = `${args.match_idx}:${stateIdx}`;
          if (!pendingTx.has(key)) continue;
          const saved = await db.setRevealTx(
            chain,
            args.match_idx,
            stateIdx,
            t.transaction.hash,
            t.execution_outcome?.block_height ?? null,
          );
          if (saved) pendingTx.delete(key);
        }
      }
      if (!resume_token || txs.length === 0) break;
      token = resume_token;
    }
    if (pendingTx.size === 0) {
      txAttempts = 0;
    } else if (++txAttempts >= TX_MAX_ATTEMPTS) {
      console.warn(
        `${tag} no tx hash found for ${pendingTx.size} reveals - giving up`,
      );
      pendingTx.clear();
      txAttempts = 0;
    } else {
      nextTxResolveAt = Date.now() + TX_RETRY_MS;
    }
  }

  async function discover() {
    // Page through get_match_ids; the contract lists ids in creation order.
    // The cursor persists across polls, so each poll only fetches ids
    // created since the last one.
    for (;;) {
      const ids = await callView("get_match_ids", {
        offset: discoverOffset,
        limit: DISCOVERY_PAGE,
      });
      if (!Array.isArray(ids) || ids.length === 0) break;
      for (const id of ids) addMatch(num(id));
      discoverOffset += ids.length;
      if (ids.length < DISCOVERY_PAGE) break;
    }
  }

  function recordActivity() {
    lastActivityTime = Date.now();
    if (isSleeping) {
      console.log(`${tag} waking up due to activity`);
      wakeUp();
    }
  }

  function goToSleep(duration) {
    if (isSleeping) return;
    isSleeping = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    console.log(`${tag} going to sleep for ${duration / 60000} minutes`);

    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      console.log(`${tag} sleep timer expired, auto-waking`);
      wakeUp();
    }, duration);
  }

  function wakeUp() {
    if (!isSleeping) return;
    isSleeping = false;
    if (sleepTimer) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
    console.log(`${tag} waking up`);
    tick();
    timer = setInterval(tick, pollIntervalMs);
  }

  async function tick() {
    if (ticking) return; // skip overlapping ticks
    ticking = true;
    try {
      await discover();
      for (const matchIdx of matches) {
        const entry = matchData.get(matchIdx);
        // Ended matches keep their last fetched data; still fetch once if
        // the match was already over when discovered.
        if (entry.ended && entry.metadata !== null) continue;
        try {
          const view = await callView("get_match", { match_idx: matchIdx });
          if (view) applyView(matchIdx, view);
        } catch (err) {
          console.error(
            `${tag} get_match(${matchIdx}) failed:`,
            err.shortMessage || err.message,
          );
        }
      }

      await resolveRevealTxs().catch((err) => {
        nextTxResolveAt = Date.now() + TX_RETRY_MS;
        console.error(`${tag} tx hash lookup failed:`, err.message);
      });

      // Check if we should go to sleep (15 minutes after last activity)
      const timeSinceActivity = Date.now() - lastActivityTime;
      if (timeSinceActivity > ACTIVITY_SLEEP_MS && !isSleeping) {
        goToSleep(ACTIVITY_SLEEP_MS);
      }
    } catch (err) {
      console.error(
        `${tag} poll failed:`,
        err.shortMessage || err.message,
      );
    } finally {
      ticking = false;
    }
  }

  return {
    matches,
    contractAddress,
    start() {
      (async () => {
        dbOk = await dbReady;
        if (dbOk) {
          try {
            const rows = await db.loadMatches(chain);
            for (const row of rows) {
              const events = row.events ?? {};
              matchData.set(row.match_idx, {
                metadata: row.metadata,
                states: row.states,
                events,
                startedBlock: null,
                startedAt: row.started_at
                  ? new Date(row.started_at).toISOString()
                  : null,
                ended: row.ended,
                updatedAt: row.updated_at
                  ? new Date(row.updated_at).toISOString()
                  : null,
                // eventsSeen unknown for restored entries - a rough bound
                // (reveals + commits + lifecycle) avoids re-inserting rows.
                eventsSeen: Number.MAX_SAFE_INTEGER,
                fresh: false,
              });
              matches.push(row.match_idx);
            }
            if (rows.length) {
              console.log(
                `${tag} restored ${rows.length} matches from postgres`,
              );
            }
            for (const r of await db.loadRevealsMissingTx(chain)) {
              pendingTx.add(`${r.match_idx}:${r.state_idx}`);
            }
          } catch (err) {
            console.error(`${tag} db restore failed:`, err.message);
          }
        }
        tick();
        timer = setInterval(tick, pollIntervalMs);
        console.log(
          `${tag} watching ${contractAddress} on ${rpcUrl} (poll ${pollIntervalMs}ms)`,
        );

        // Go to sleep after 10 minutes of initial indexing
        setTimeout(() => {
          if (!isSleeping) {
            goToSleep(INITIAL_SLEEP_MS);
          }
        }, INITIAL_SLEEP_MS);
      })();
    },
    stop() {
      if (timer) clearInterval(timer);
      if (sleepTimer) clearTimeout(sleepTimer);
      timer = null;
      sleepTimer = null;
    },
    // Wake up the indexer (called when a match is joined on this network)
    wake() {
      recordActivity();
    },
    list() {
      return matches.map((matchIdx) => {
        const d = matchData.get(matchIdx);
        const last = d.states[d.states.length - 1];
        return {
          matchIdx,
          ended: d.ended,
          stateIdx: d.metadata ? d.metadata.stateIdx : null,
          score: last ? last.score : null,
          startedAt: d.startedAt,
          updatedAt: d.updatedAt,
        };
      });
    },
    get(matchIdx) {
      const d =
        matchData.get(Number(matchIdx)) ?? matchData.get(String(matchIdx));
      return d ? { matchIdx, ...d } : null;
    },
    // Exposed for tests - run one poll cycle without starting the timer.
    _tickOnce: tick,
    _callView: callView,
  };
}
