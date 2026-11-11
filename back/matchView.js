// Transforms raw indexed Drakarys_GAME_0 data into the payload shape the front
// consumes: the old matches.js fixtures shape.
//
// On-chain quirks handled here:
// - playerPositions are int256 in [0,1024]x[0,512]; the front wants 0..1
// - Team.pass / Team.shoot are never written by the contract, and there is no
//   stored ball position, so the ball is read off the holder's position and
//   `action` is derived from holder changes between states.

const FIELD_WIDTH = 1024;
const FIELD_HEIGHT = 512;
const N_PLAYERS = 11;

const SURNAMES = [
  "Vaughn",
  "Halloran",
  "Petrov",
  "Iversen",
  "Okafor",
  "Mendes",
  "Draycott",
  "Lindqvist",
  "Basara",
  "Kovac",
  "Whitlock",
  "Sorensen",
  "Duarte",
  "Ellington",
  "Nakamura",
  "Bianchi",
  "Rusanov",
  "Faraday",
  "Adeyemi",
  "Castellan",
  "Voss",
  "Mbeki",
];

const playerId = (teamIdx, playerIdx) =>
  `${teamIdx === 0 ? "A" : "B"}${playerIdx + 1}`;

const norm = (v, size) => Math.min(1, Math.max(0, v / size));
const stat = (v) => Math.min(99, Math.max(0, v));

const shortAddr = (a) =>
  a && a !== "0x0000000000000000000000000000000000000000"
    ? `${a.slice(0, 6)}…${a.slice(-4)}`
    : a;

function rosterFrom(metadata) {
  const roster = {};
  for (let t = 0; t < 2; t++) {
    for (let j = 0; j < N_PLAYERS; j++) {
      // Indexed as gameplay reads it: playerStats[team][player][stat]
      roster[playerId(t, j)] = {
        number: j + 1,
        name: SURNAMES[t * N_PLAYERS + j],
        skill: stat(metadata.playerStats[t][j][0]),
        speed: stat(metadata.playerStats[t][j][1]),
      };
    }
  }
  return roster;
}

// Infer what happened between two states from how possession changed, since
// the contract does not store the move that produced a state.
function deriveAction(prev, curr) {
  if (!prev) return null;
  const prevId = playerId(prev.hasBallTeamIdx, prev.hasBallPlayerIdx);
  const currId = playerId(curr.hasBallTeamIdx, curr.hasBallPlayerIdx);
  if (prevId === currId) return null;
  if (prev.hasBallTeamIdx === curr.hasBallTeamIdx) {
    return { type: "pass", from: prevId, to: currId };
  }
  // Possession changed sides: a shot always ends with the opposing keeper,
  // anything else was an interception.
  if (curr.hasBallPlayerIdx !== 0) return null;
  // The contract resolves the shot from whoever holds the ball after the
  // move, and a same-round pass can hand it to a teammate first - so the old
  // holder is only a plausible scorer when they are already in the opposing
  // half. Otherwise credit the team's most advanced player.
  const team = prev.hasBallTeamIdx;
  const positions = curr.teams[team].playerPositions;
  const inOpposingHalf = (x) =>
    team === 0 ? x > FIELD_WIDTH / 2 : x < FIELD_WIDTH / 2;
  const holderPos = positions[prev.hasBallPlayerIdx];
  if (holderPos && inOpposingHalf(holderPos[0])) {
    return { type: "shoot", from: prevId };
  }
  let shooter = 0;
  positions.forEach(([x], j) => {
    if (team === 0 ? x > positions[shooter][0] : x < positions[shooter][0]) {
      shooter = j;
    }
  });
  return { type: "shoot", from: playerId(team, shooter) };
}

// Synthesizes in-between states so the front can play the ball's flight
// instead of teleporting it between rounds. Uses the contract events when
// available (exact shooter, interception point) and falls back to what the
// states imply on their own for matches played on pre-event deployments.
// Each transitional state carries the arrival state's players (they moved
// before the ball), the previous score, and the action on its last frame.
function buildTransition(prev, curr, events) {
  const prevId = playerId(prev.hasBallTeamIdx, prev.hasBallPlayerIdx);
  const currId = playerId(curr.hasBallTeamIdx, curr.hasBallPlayerIdx);
  const shots = (events ?? []).filter((e) => e.kind === "shot");
  const interceptions = (events ?? []).filter((e) => e.kind === "interception");
  const posOf = (t, p) => curr.teams[t]?.playerPositions[p];

  // The flight can have two legs: a pass feeds the shooter, then the shot
  // goes on. The ball has to visibly reach the receiver before turning
  // towards goal - contract resolves pass first, shot second.
  const legs = [];
  // The ball ends at whoever holds it in the new state - the receiver, the
  // keeper after a shot, or the interceptor (a press steal reads as the ball
  // hopping to the defender who won it).
  const end = posOf(curr.hasBallTeamIdx, curr.hasBallPlayerIdx);

  if (shots.length) {
    // Exact shooter + take-off point from the ShotTry event.
    const shooter = playerId(shots[0].teamIdx, shots[0].playerIdx);
    const shooterPos = [shots[0].x, shots[0].y];
    if (shooter !== prevId) {
      legs.push({
        from: posOf(prev.hasBallTeamIdx, prev.hasBallPlayerIdx),
        to: shooterPos,
        action: { type: "pass", from: prevId, to: shooter },
      });
    }
    legs.push({
      from: shooterPos,
      to: end,
      action: { type: "shoot", from: shooter },
    });
  } else if (
    prev.hasBallTeamIdx !== curr.hasBallTeamIdx &&
    curr.hasBallPlayerIdx === 0
  ) {
    // Shot to the keeper with no event data (pre-event deployment): the
    // holder if already in range, else the most advanced teammate.
    const team = prev.hasBallTeamIdx;
    const positions = curr.teams[team].playerPositions;
    const holderPos = positions[prev.hasBallPlayerIdx];
    const inOpposingHalf = (x) =>
      team === 0 ? x > FIELD_WIDTH / 2 : x < FIELD_WIDTH / 2;
    let shooter = prev.hasBallPlayerIdx;
    if (!holderPos || !inOpposingHalf(holderPos[0])) {
      shooter = 0;
      positions.forEach(([x], j) => {
        if (team === 0 ? x > positions[shooter][0] : x < positions[shooter][0])
          shooter = j;
      });
    }
    const shooterId = playerId(team, shooter);
    if (shooterId !== prevId) {
      legs.push({
        from: holderPos,
        to: positions[shooter],
        action: { type: "pass", from: prevId, to: shooterId },
      });
    }
    legs.push({
      from: positions[shooter],
      to: end,
      action: { type: "shoot", from: shooterId },
    });
  } else if (
    interceptions.length ||
    prev.hasBallTeamIdx !== curr.hasBallTeamIdx
  ) {
    legs.push({
      from: posOf(prev.hasBallTeamIdx, prev.hasBallPlayerIdx),
      to: end,
      action: { type: "intercept", from: prevId, to: currId },
    });
  } else if (prevId !== currId) {
    legs.push({
      from: posOf(prev.hasBallTeamIdx, prev.hasBallPlayerIdx),
      to: end,
      action: { type: "pass", from: prevId, to: currId },
    });
  }

  const valid = legs.every((l) => l.from && l.to);
  if (!legs.length || !valid) return [];

  const score = { A: Number(prev.score[0]), B: Number(prev.score[1]) };
  const out = [];
  // players move first - the ball stays with its holder while everyone runs
  // to their new positions, then the flight legs play out. pace: 1 keeps the
  // move at normal speed, flight frames run faster.
  out.push({
    players: null, // filled with the arrival state's players by the caller
    ball: {
      x: legs[0].from[0] / FIELD_WIDTH,
      y: legs[0].from[1] / FIELD_HEIGHT,
      hasBall: prevId,
    },
    score,
    action: null,
    highlight: null,
    transitional: true,
    pace: 1,
  });
  legs.forEach((leg, li) => {
    // quarter-waypoints - the front advances transitional frames quickly, so
    // the ball chases successive targets and never settles between them. A
    // first (pass) leg lands exactly on the receiver (t = 1).
    const fracs =
      legs.length === 1
        ? [1 / 4, 2 / 4, 3 / 4]
        : li === 0
          ? [1 / 2, 1]
          : [1 / 4, 2 / 4, 3 / 4];
    fracs.forEach((t, k, arr) => {
      out.push({
        players: null, // filled with the arrival state's players by the caller
        ball: {
          x: (leg.from[0] + (leg.to[0] - leg.from[0]) * t) / FIELD_WIDTH,
          y: (leg.from[1] + (leg.to[1] - leg.from[1]) * t) / FIELD_HEIGHT,
          hasBall: null,
        },
        score,
        action: k === arr.length - 1 ? leg.action : null,
        // ring the receiver once the pass lands and keep them ringed while
        // their shot travels - the front draws this like the ball-holder ring
        highlight:
          li > 0
            ? (leg.action?.from ?? null)
            : k === arr.length - 1
              ? (leg.action?.to ?? null)
              : null,
        transitional: true,
        pace: 12,
      });
    });
  });
  return out;
}

function toStateView(curr, prev) {
  const players = [];
  for (let t = 0; t < 2; t++) {
    for (let j = 0; j < N_PLAYERS; j++) {
      const [x, y] = curr.teams[t].playerPositions[j];
      players.push({
        id: playerId(t, j),
        team: t === 0 ? "A" : "B",
        x: norm(x, FIELD_WIDTH),
        y: norm(y, FIELD_HEIGHT),
      });
    }
  }

  const holder =
    curr.hasBallPlayerIdx < N_PLAYERS
      ? playerId(curr.hasBallTeamIdx, curr.hasBallPlayerIdx)
      : null;
  const ballPos = holder
    ? curr.teams[curr.hasBallTeamIdx].playerPositions[curr.hasBallPlayerIdx]
    : [0, 0];

  return {
    players,
    ball: {
      x: norm(ballPos[0], FIELD_WIDTH),
      y: norm(ballPos[1], FIELD_HEIGHT),
      hasBall: holder,
    },
    score: { A: curr.score[0], B: curr.score[1] },
    action: deriveAction(prev, curr),
  };
}

export function toMatchPayload(matchIdx, entry) {
  const metadata = entry.metadata;
  if (!metadata) {
    return {
      id: String(matchIdx),
      agent0: null,
      agent1: null,
      roster: {},
      states: [],
      status: "in_progress",
    };
  }
  const views = [];
  for (let i = 0; i < entry.states.length; i++) {
    const curr = entry.states[i];
    const prev = i > 0 ? entry.states[i - 1] : null;
    const view = toStateView(curr, prev);
    if (prev) {
      const transitionals = buildTransition(prev, curr, entry.events?.[i]);
      for (const t of transitionals) {
        t.players = view.players;
        views.push(t);
      }
      // the flight frames already carry the action - skip a repeat on arrival
      if (transitionals.length) view.action = null;
    }
    views.push(view);
  }

  return {
    id: String(matchIdx),
    agent0: shortAddr(metadata.agents[0]),
    agent1: shortAddr(metadata.agents[1]),
    roster: rosterFrom(metadata),
    states: views,
    status: entry.ended ? "finished" : "in_progress",
  };
}

export function toListItem(matchIdx, entry) {
  const metadata = entry.metadata;
  const last = entry.states[entry.states.length - 1];
  return {
    id: String(matchIdx),
    agent0: metadata ? shortAddr(metadata.agents[0]) : null,
    agent1: metadata ? shortAddr(metadata.agents[1]) : null,
    finalScore: last ? { A: last.score[0], B: last.score[1] } : { A: 0, B: 0 },
    stateCount: entry.states.length,
    status: entry.ended ? "finished" : "in_progress",
    startedAt: entry.startedAt ?? null,
  };
}
