// NEAR indexer smoke test: mock NEAR JSON-RPC serving get_match_ids /
// get_match view responses in the contract's JSON shape, then verify the
// indexer maps them to the same entry shape the EVM/Solana indexers
// produce - and that toMatchPayload/toListItem render it.
//
//   node test_near_indexer.mjs

import http from "node:http";
import { createNearIndexer } from "./nearIndexer.js";
import { toMatchPayload, toListItem } from "./matchView.js";

const CONTRACT = "drakarys.testnet";

// ---- canned contract state: a 2-match world -------------------------

const POSITIONS = (t) =>
  Array.from({ length: 11 }, (_, i) => [
    i === 0 ? (t === 0 ? 51 : 973) : 200 + i * 50,
    (i * 47) % 512,
  ]);

const state = (round, holderT, holderP, score = [0, 0]) => ({
  teams: [0, 1].map((t) => ({
    player_positions: POSITIONS(t),
    pass: false,
    passing_to: 0,
    shoot: false,
  })),
  score,
  has_ball_team_idx: holderT,
  has_ball_player_idx: holderP,
});

const move = (round, seed) => ({
  state_idx: round,
  delta_player_positions: Array.from({ length: 11 }, () => [0, 0]),
  commands: [0, 0],
  seed_part: seed,
});

const STATS = Array.from({ length: 2 }, () =>
  Array.from({ length: 11 }, () => [50, 60]),
);

const AGENTS = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
];

const matches = {
  // finished match: full history + event log
  7: {
    match_idx: 7,
    state_idx: 20,
    agents: AGENTS,
    player_stats: STATS,
    state: state(19, 1, 0, [2, 1]),
    states: Array.from({ length: 20 }, (_, i) =>
      state(i, i < 10 ? 0 : 1, i % 11, i === 19 ? [2, 1] : [1, 1]),
    ),
    events: [
      { kind: "match_started", state_idx: 0, team_idx: 0, player_idx: 0, x: 0, y: 0, goal: false, data: null, moves: null },
      { kind: "move_committed", state_idx: 0, team_idx: 0, player_idx: 0, x: 0, y: 0, goal: false, data: [[1, 2, 3], [4, 5, 6]], moves: null },
      { kind: "move_revealed", state_idx: 0, team_idx: 0, player_idx: 0, x: 0, y: 0, goal: false, data: null, moves: [move(0, 11), move(0, 22)] },
      { kind: "shot", state_idx: 5, team_idx: 0, player_idx: 9, x: 800, y: 250, goal: true, data: null, moves: null },
      { kind: "interception", state_idx: 8, team_idx: 1, player_idx: 4, x: 300, y: 200, goal: false, data: null, moves: null },
      { kind: "shot", state_idx: 15, team_idx: 1, player_idx: 10, x: 100, y: 260, goal: true, data: null, moves: null },
      { kind: "match_ended", state_idx: 19, team_idx: 0, player_idx: 0, x: 0, y: 0, goal: false, data: null, moves: null },
    ],
    ended: true,
  },
  // in-progress match: partial history
  9: {
    match_idx: 9,
    state_idx: 3,
    agents: AGENTS,
    player_stats: STATS,
    state: state(3, 0, 5),
    states: Array.from({ length: 4 }, (_, i) => state(i, 0, i)),
    events: [
      { kind: "match_started", state_idx: 0, team_idx: 0, player_idx: 0, x: 0, y: 0, goal: false, data: null, moves: null },
      { kind: "move_revealed", state_idx: 2, team_idx: 0, player_idx: 0, x: 0, y: 0, goal: false, data: null, moves: [move(2, 33), move(2, 44)] },
    ],
    ended: false,
  },
};

// ---- mock NEAR JSON-RPC ----------------------------------------------

const rpc = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msg = JSON.parse(body);
    const p = msg.params;
    const args = JSON.parse(
      Buffer.from(p.args_base64, "base64").toString("utf8"),
    );
    let out = null;
    if (p.method_name === "get_match_ids") {
      out = Object.keys(matches)
        .map(Number)
        .slice(args.offset, args.offset + args.limit);
    } else if (p.method_name === "get_match") {
      out = matches[args.match_idx] ?? null;
    }
    const bytes = out === null ? [] : [...Buffer.from(JSON.stringify(out))];
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { result: bytes, logs: [] },
      }),
    );
  });
});

await new Promise((r) => rpc.listen(0, "127.0.0.1", r));
const port = rpc.address().port;

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`PASS ${name}`);
  else {
    console.log(`FAIL ${name}`);
    failed++;
  }
};

const indexer = createNearIndexer({
  rpcUrl: `http://127.0.0.1:${port}`,
  contractAddress: CONTRACT,
  label: "near-test",
  pollIntervalMs: 60_000,
});

// run one poll cycle manually (no timers)
await indexer._tickOnce();

check("discovers both matches", indexer.matches.length === 2);
check(
  "discovery order preserved",
  indexer.matches[0] === 7 && indexer.matches[1] === 9,
);

const e7 = indexer.get(7);
check("match 7 metadata agents", e7.metadata.agents[0] === AGENTS[0]);
check("match 7 playerStats shape", e7.metadata.playerStats.length === 2);
check(
  "match 7 has 20 states",
  e7.states.length === 20 && e7.metadata.stateIdx === 20,
);
check("match 7 ended", e7.ended === true);
check(
  "match 7 state shape mapped to camelCase",
  Array.isArray(e7.states[0].teams[0].playerPositions) &&
    typeof e7.states[0].hasBallTeamIdx === "number",
);
check("match 7 startedAt set", typeof e7.startedAt === "string");
check(
  "match 7 shot event bucketed at round 5",
  e7.events[5]?.[0]?.kind === "shot" &&
    e7.events[5][0].goal === true &&
    e7.events[5][0].playerIdx === 9,
);
check(
  "match 7 interception bucketed at round 8",
  e7.events[8]?.[0]?.kind === "interception",
);
check("match 7 lifecycle events not in render events",
  !(e7.events[0] ?? []).some((e) => e.kind === "match_started"));

const e9 = indexer.get(9);
check("match 9 in progress", e9.ended === false && e9.states.length === 4);

// ---- the same payload transforms the front consumes ------------------

const list = indexer.matches.map((i) => toListItem(i, indexer.get(i)));
check(
  "list item: finished match reports score",
  list[0].status === "finished" &&
    list[0].finalScore.A === 2 &&
    list[0].finalScore.B === 1,
);

const payload = toMatchPayload(7, e7);
check("payload: status finished", payload.status === "finished");
check(
  "payload: roster populated",
  Object.keys(payload.roster).length === 22 &&
    payload.roster.A10.skill === 50,
);
check(
  "payload: state views built",
  payload.states.length > 0 &&
    payload.states[0].players.length === 22 &&
    payload.states[0].ball.hasBall !== null,
);
check("payload: agent ids shortened",
  payload.agent0.startsWith("0x1111") && payload.agent0.includes("…"));

rpc.close();
console.log(failed ? `\n${failed} checks FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
