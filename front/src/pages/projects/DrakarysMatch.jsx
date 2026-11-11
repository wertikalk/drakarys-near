import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReactP5Wrapper } from "react-p5-wrapper";
import { Link, useParams } from "react-router-dom";
import { useTheme } from "../../contexts/ThemeContext";
import { fetchMatch, fetchChains, apiUrl } from "../../api";
import { Crest, JERSEY, Jersey, TEAMS } from "./matchShared";
import fireImage from "../../assets/fire.svg";
import {
  playGoal,
  playPass,
  playShot,
  playWhistle,
  setMuted,
  setSpeechMuted,
  speak,
  stopSpeaking,
  unlockAudio,
} from "./matchAudio";

// Player numbers, names, and stats arrive with the match payload as `roster`,
// keyed by the same ids used in the state sequence.
const surname = (roster, id) => roster[id]?.name ?? id;
const teamOf = (id) => (id?.startsWith("A") ? TEAMS.A.name : TEAMS.B.name);
const isKeeper = (id) => id === "A1" || id === "B1";

const POSITION_LABEL = {
  keeper: "GK",
  defender: "DEF",
  midfielder: "MID",
  forward: "FWD",
};

// One table per side: kit, surname, role, and stats for all eleven players
const RosterTable = ({ team, isDark, ballHolder, roster, mobileHidden }) => {
  const ids = Object.keys(roster).filter((id) => id[0] === team);
  const kit = isDark ? JERSEY[team].dark : JERSEY[team].light;
  return (
    <table
      className={`roster roster-${team.toLowerCase()}${mobileHidden ? " hidden-mobile" : ""}`}
    >
      <thead>
        <tr>
          <th colSpan={5} className="crest-cell">
            <Crest team={team} fill={kit.fill} ink={kit.ink} />
          </th>
        </tr>
        <tr>
          <th colSpan={5} className="team-name">
            <Jersey fill={kit.fill} ink={kit.ink} number="" />
            {TEAMS[team].name}
          </th>
        </tr>
        <tr className="col-head">
          <th>Kit</th>
          <th>Player</th>
          <th>Pos</th>
          <th className="stat">Spd</th>
          <th className="stat">Skl</th>
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => (
          <tr key={id} className={id === ballHolder ? "on-ball" : undefined}>
            <td className="kit">
              <Jersey
                fill={isKeeper(id) ? JERSEY.keeper.fill : kit.fill}
                ink={isKeeper(id) ? JERSEY.keeper.ink : kit.ink}
                number={roster[id].number}
              />
            </td>
            <td className="player">{roster[id].name}</td>
            <td className="pos">{POSITION_LABEL[roleOf(id)]}</td>
            <td className="stat">{roster[id].speed}</td>
            <td className="stat">{roster[id].skill}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// Shirt order is GK, four defenders, three midfielders, three forwards
const roleOf = (id) => {
  const slot = Number(id?.slice(1));
  if (slot === 1) return "keeper";
  if (slot <= 5) return "defender";
  if (slot <= 8) return "midfielder";
  return "forward";
};

// Team A attacks to the right, Team B to the left
const inFinalThird = (id, x) => (id?.startsWith("A") ? x > 0.68 : x < 0.32);
const outWide = (y) => y < 0.32 || y > 0.68;

// Scores read as words - nobody says "one dash nil"
const NUMBERS = ["nil", "one", "two", "three", "four", "five", "six"];
const scorePhrase = ({ A, B }) => {
  if (A === B) return A === 0 ? "still goalless" : `${NUMBERS[A]} all`;
  const leader = A > B ? TEAMS.A.name : TEAMS.B.name;
  return `${NUMBERS[Math.max(A, B)]} ${NUMBERS[Math.min(A, B)]} to ${leader}`;
};

// Pick a phrasing at random, but never the same one twice in a row
const recent = {};
function pick(key, options) {
  if (options.length === 1) return options[0];
  let choice;
  do {
    choice = options[Math.floor(Math.random() * options.length)];
  } while (choice === recent[key]);
  recent[key] = choice;
  return choice;
}

function openingLine() {
  return pick("open", [
    `Good evening, and welcome to the Drakarys Arena for ${TEAMS.A.name} against ${TEAMS.B.name}.`,
    `A big night here at the Drakarys Arena, ${TEAMS.A.name} hosting ${TEAMS.B.name}.`,
    `Everything is set at the Drakarys Arena. ${TEAMS.A.name} against ${TEAMS.B.name}.`,
  ]);
}

function closingLine(score) {
  const verdict =
    score.A === score.B
      ? "honours even"
      : `${score.A > score.B ? TEAMS.A.name : TEAMS.B.name} take it`;
  return pick("close", [
    `And that's the full time whistle. ${scorePhrase(score)}, so ${verdict}.`,
    `It's all over. ${scorePhrase(score)}, and ${verdict}.`,
    `The referee brings it to an end. ${scorePhrase(score)} — ${verdict}.`,
  ]);
}

// Commentary is derived from the state data rather than written per state, so it
// keeps working if the sequence is swapped for real match data.
function describeState(states, index, roster) {
  const current = states[index];
  if (!current) return "";
  // pure ball-flight frames stay silent - the action lives on the last one
  if (current.transitional && !current.action) return "";
  const previous = index > 0 ? states[index - 1] : null;

  const scored =
    previous &&
    (current.score.A !== previous.score.A ||
      current.score.B !== previous.score.B);

  if (scored) {
    const scorer = surname(roster, previous.action?.from);
    const team = teamOf(previous.action?.from);
    return pick("goal", [
      `Oh, that is beautifully taken! ${scorer} with the finish, and it's ${scorePhrase(current.score)}.`,
      `It's in! ${scorer} makes no mistake at all. ${team} have their goal, ${scorePhrase(current.score)}.`,
      `Goal! ${scorer} buries it, the keeper had no chance. ${scorePhrase(current.score)}.`,
    ]);
  }

  const { action, ball } = current;

  if (action?.type === "shoot") {
    const striker = surname(roster, action.from);
    return pick("shoot", [
      `${striker} shifts it onto his favoured side and lets fly!`,
      `Here comes the shot from ${striker}, and he's caught it well!`,
      `${striker} has a sight of goal, and he goes for it!`,
    ]);
  }

  if (action?.type === "intercept") {
    const thief = surname(roster, action.to);
    return pick("intercept", [
      `Cut out! ${thief} reads it perfectly and steps in to intercept.`,
      `${thief} anticipates it and breaks the move up.`,
      `Intercepted by ${thief} - they had it scouted all the way.`,
    ]);
  }

  if (action?.type === "pass") {
    const from = surname(roster, action.from);
    const to = surname(roster, action.to);
    const target = current.players.find((p) => p.id === action.to);

    if (isKeeper(action.from)) {
      return pick("gkpass", [
        `${from} is in no hurry, rolling it out to ${to} to build again.`,
        `The keeper takes his time. ${from} finds ${to} short.`,
        `${from} plays it out from the back to ${to}.`,
      ]);
    }

    if (target && inFinalThird(action.to, target.x)) {
      return pick("danger", [
        `${from} threads it through to ${to}, and this is dangerous!`,
        `Lovely ball from ${from}, ${to} is in behind!`,
        `${from} picks out ${to} in acres of space, the defence is stretched!`,
      ]);
    }

    if (target && outWide(target.y)) {
      return pick("wide", [
        `${from} spreads it wide to ${to} out on the touchline.`,
        `Switched out to the flank, where ${to} takes it in stride.`,
        `${from} goes the other way, finding ${to} on the wing.`,
      ]);
    }

    return pick("pass", [
      `${from} slides it through to ${to}, nice and simple.`,
      `Neat from ${from}, ${to} takes it on the half turn.`,
      `${from} looks up and picks out ${to}, the ${roleOf(action.to)}.`,
    ]);
  }

  if (index === 0) {
    return pick("start", [
      `And we're under way, ${TEAMS.A.name} getting us going.`,
      `The whistle goes, and ${TEAMS.A.name} start us off.`,
    ]);
  }

  const holder = ball?.hasBall;
  if (!holder) return "The ball is loose in midfield, and both sides want it.";

  return pick("hold", [
    `${surname(roster, holder)} keeps it ticking over for ${teamOf(holder)}.`,
    `No rush from ${teamOf(holder)} here, ${surname(roster, holder)} on the ball.`,
    `${surname(roster, holder)} takes a touch and waits for support to arrive.`,
  ]);
}

function sketch(p5) {
  let fieldWidth, fieldHeight;
  let players = [];
  let ball = null;
  let highlight = null; // player id ringed during pass->shoot ball flight
  let states = [];
  let roster = {};
  let currentStateIndex = 0;
  let transitionProgress = 0;
  let transitionSpeed = 0.004; // per state, so moves play out unhurried
  let isDarkMode = false;
  let teamAColor,
    teamBColor,
    fieldColor,
    lineColor,
    keeperColor,
    teamAInk,
    teamBInk,
    keeperInk;
  let onStateChange = null;
  let onFinish = null;
  let isPaused = false;
  let isFinished = false;
  let runId = 0;

  // The container is fluid (aspect-ratio 8/5, max 800px) - size the canvas to
  // its content box exactly so nothing is clipped by the border, and scale
  // every drawn element by fieldWidth / 800
  const canvasSize = () => {
    const parent = document.getElementById("football-canvas");
    const w = Math.min(parent?.clientWidth || 800, 800);
    const h = parent?.clientHeight || Math.round((w * 500) / 800);
    return [w, h];
  };

  p5.setup = () => {
    const [w, h] = canvasSize();
    let canvas = p5.createCanvas(w, h);
    canvas.parent("football-canvas");
    fieldWidth = p5.width;
    fieldHeight = p5.height;

    // Check initial theme
    isDarkMode = document.documentElement.getAttribute("data-theme") === "dark";
    updateColors();
  };

  p5.updateWithProps = (props) => {
    if (props.isDark !== undefined && props.isDark !== isDarkMode) {
      isDarkMode = props.isDark;
      updateColors();
    }

    if (props.onStateChange) {
      onStateChange = props.onStateChange;
    }

    if (props.onFinish) {
      onFinish = props.onFinish;
    }

    if (props.paused !== undefined) {
      isPaused = props.paused;
    }

    if (props.roster) {
      roster = props.roster;
    }

    // Only re-initialize when the sequence actually grew, otherwise every
    // re-render (e.g. a score update or a poll with no new states) would reset
    // the animation mid-move.
    if (
      props.states &&
      props.states.length > 0 &&
      props.states.length !== states.length
    ) {
      states = props.states;
      if (currentStateIndex >= states.length) {
        currentStateIndex = 0;
      }
      initializePlayers();
      // A live match may deliver more states after the replay reached the end
      if (isFinished && currentStateIndex < states.length - 1) {
        isFinished = false;
        transitionProgress = 0;
      }
    }

    // A new runId means "replay the match from the top"
    if (props.runId !== undefined && props.runId !== runId) {
      runId = props.runId;
      currentStateIndex = 0;
      transitionProgress = 0;
      isFinished = false;
      initializePlayers();
    }
  };

  function updateColors() {
    // Purple vs ink kits, matching the site's purple/black/white palette
    const kitA = isDarkMode ? JERSEY.A.dark : JERSEY.A.light;
    const kitB = isDarkMode ? JERSEY.B.dark : JERSEY.B.light;
    teamAColor = p5.color(kitA.fill);
    teamBColor = p5.color(kitB.fill);
    teamAInk = p5.color(kitA.ink);
    teamBInk = p5.color(kitB.ink);
    if (isDarkMode) {
      fieldColor = p5.color(0, 0, 0, 77); // Black with 0.3 opacity
      lineColor = p5.color(100, 100, 100, 89); // Gray lines with 0.35 opacity
    } else {
      fieldColor = p5.color(255, 255, 255, 77); // White with 0.3 opacity
      lineColor = p5.color(50, 50, 50, 89); // Dark lines with 0.35 opacity
    }
    // Keepers wear their own kit - same gray as the roster jerseys
    keeperColor = p5.color(JERSEY.keeper.fill);
    keeperInk = p5.color(JERSEY.keeper.ink);
  }

  // Normalized 0..1 coords -> pixels inside the field outline. The inset is
  // the field margin (10) plus the max player-dot radius (14) so a player at
  // the edge stands on the line instead of clipping outside it. Keepers are
  // pinned to their goal line rather than mapped from their nominal 5% depth.
  function toFieldPx(nx, ny, id) {
    const m = 24 * (fieldWidth / 800);
    const y = m + ny * (fieldHeight - 2 * m);
    if (id === "A1") return [m, y];
    if (id === "B1") return [fieldWidth - m, y];
    return [m + nx * (fieldWidth - 2 * m), y];
  }

  function initializePlayers() {
    players = [];
    ball = null;
    const currentState = states[currentStateIndex];
    if (!currentState) return;

    currentState.players.forEach((playerData) => {
      const [px, py] = toFieldPx(playerData.x, playerData.y, playerData.id);
      players.push({
        ...playerData,
        currentX: px,
        currentY: py,
        targetX: px,
        targetY: py,
        pulsePhase: p5.random(p5.TWO_PI),
      });
    });

    // Initialize ball
    const [bx, by] = toFieldPx(
      currentState.ball.x,
      currentState.ball.y,
      currentState.ball.hasBall,
    );
    ball = {
      x: bx,
      y: by,
      targetX: bx,
      targetY: by,
      hasBall: currentState.ball.hasBall,
      speed: 0,
      path: null,
    };
    highlight = currentState.highlight ?? null;
  }

  p5.draw = () => {
    p5.clear(); // Clear canvas to make it transparent
    drawFieldBackground(); // Draw semi-transparent field background
    drawField(); // Draw field lines

    // Update and draw players
    updatePlayers();
    drawPlayers();

    // Update and draw ball
    updateBall();
    drawBall();

    // Handle state transitions
    handleTransitions();
  };

  function drawFieldBackground() {
    const u = fieldWidth / 800;
    p5.noStroke();
    p5.fill(fieldColor);
    p5.rect(10 * u, 10 * u, fieldWidth - 20 * u, fieldHeight - 20 * u);
  }

  function drawField() {
    const u = fieldWidth / 800;
    // Use fully opaque colors for field lines
    const opaqueLineColor = isDarkMode
      ? p5.color(100, 100, 100)
      : p5.color(50, 50, 50);

    p5.stroke(opaqueLineColor);
    p5.strokeWeight(2 * u);
    p5.noFill();

    // Field outline
    p5.rect(10 * u, 10 * u, fieldWidth - 20 * u, fieldHeight - 20 * u);

    // Center line
    p5.line(fieldWidth / 2, 10 * u, fieldWidth / 2, fieldHeight - 10 * u);

    // Center circle
    p5.ellipse(fieldWidth / 2, fieldHeight / 2, 80 * u, 80 * u);

    // Center spot
    p5.fill(opaqueLineColor);
    p5.noStroke();
    p5.ellipse(fieldWidth / 2, fieldHeight / 2, 5 * u, 5 * u);

    // Goal areas
    p5.stroke(opaqueLineColor);
    p5.noFill();
    // Left goal area
    p5.rect(10 * u, fieldHeight / 2 - 60 * u, 60 * u, 120 * u);
    p5.rect(10 * u, fieldHeight / 2 - 30 * u, 30 * u, 60 * u);
    // Right goal area
    p5.rect(fieldWidth - 70 * u, fieldHeight / 2 - 60 * u, 60 * u, 120 * u);
    p5.rect(fieldWidth - 40 * u, fieldHeight / 2 - 30 * u, 30 * u, 60 * u);

    // Goals - fully opaque
    p5.fill(0);
    p5.noStroke();
    // Left goal
    p5.rect(5 * u, fieldHeight / 2 - 40 * u, 5 * u, 80 * u);
    // Right goal
    p5.rect(fieldWidth - 10 * u, fieldHeight / 2 - 40 * u, 5 * u, 80 * u);
  }

  function updatePlayers() {
    players.forEach((player) => {
      // Smooth movement towards target - gentle enough that players keep
      // drifting for most of the state rather than snapping into place early
      player.currentX = p5.lerp(player.currentX, player.targetX, 0.025);
      player.currentY = p5.lerp(player.currentY, player.targetY, 0.025);

      // Pulsating effect
      player.pulsePhase += 0.05;
    });
  }

  function drawPlayers() {
    const u = fieldWidth / 800;
    players.forEach((player) => {
      const pulseSize = (p5.sin(player.pulsePhase) * 7 + 21) * u; // Pulsating between 14 and 28 at full size
      const playerColor = isKeeper(player.id)
        ? keeperColor
        : player.team === "A"
          ? teamAColor
          : teamBColor;
      const playerInk = isKeeper(player.id)
        ? keeperInk
        : player.team === "A"
          ? teamAInk
          : teamBInk;
      const { number, name } = roster[player.id] ?? {};

      // Draw player
      p5.fill(playerColor);
      p5.noStroke();
      p5.ellipse(player.currentX, player.currentY, pulseSize, pulseSize);

      // Squad number inside the dot
      p5.fill(playerInk);
      p5.textSize(Math.max(8, 13 * u));
      p5.textAlign(p5.CENTER, p5.CENTER);
      p5.text(number ?? "", player.currentX, player.currentY + u);

      // Surname underneath - flipped above the dot near the bottom edge so it
      // isn't clipped by the canvas
      if (isDarkMode) {
        p5.fill(255, 230);
      } else {
        p5.fill(50, 50, 50, 230);
      }
      p5.textSize(Math.max(8, 12 * u));
      const labelY =
        player.currentY + 26 * u > fieldHeight
          ? player.currentY - 14 * u
          : player.currentY + 24 * u;
      p5.text(name ?? player.id, player.currentX, labelY);

      // Highlight the ball holder, or the pass receiver while their shot
      // is still travelling (pass -> shoot transitional frames)
      if ((ball && ball.hasBall === player.id) || player.id === highlight) {
        p5.noFill();
        p5.stroke(96, 80, 220);
        p5.strokeWeight(4 * u);
        p5.ellipse(
          player.currentX,
          player.currentY,
          pulseSize + 14 * u,
          pulseSize + 14 * u,
        );
      }
    });
  }

  function updateBall() {
    if (!ball) return;

    // Travelling an extrapolated flight path - move through each waypoint at
    // its constant speed without waiting for the state machine to tick.
    if (ball.path?.length) {
      const wp = ball.path[0];
      const dx = wp.x - ball.x;
      const dy = wp.y - ball.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= wp.speed) {
        ball.x = wp.x;
        ball.y = wp.y;
        ball.path.shift();
      } else {
        ball.x += (dx / dist) * wp.speed;
        ball.y += (dy / dist) * wp.speed;
      }
      return;
    }

    // In flight (or landing) the ball moves at a constant per-segment
    // velocity set when each state's target arrives - uniform motion through
    // every waypoint instead of lerp decelerating before each one.
    const inFlight =
      states[currentStateIndex]?.transitional ||
      states[currentStateIndex - 1]?.transitional;
    if (inFlight) {
      const dx = ball.targetX - ball.x;
      const dy = ball.targetY - ball.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ball.speed) {
        ball.x = ball.targetX;
        ball.y = ball.targetY;
      } else {
        ball.x += (dx / dist) * ball.speed;
        ball.y += (dy / dist) * ball.speed;
      }
      return;
    }
    ball.x = p5.lerp(ball.x, ball.targetX, 0.045);
    ball.y = p5.lerp(ball.y, ball.targetY, 0.045);
  }

  function drawBall() {
    if (!ball) return;
    const u = fieldWidth / 800;

    // Draw ball
    p5.fill(255);
    p5.noStroke();
    p5.ellipse(ball.x, ball.y, 22 * u, 22 * u);

    // Ball outline
    p5.stroke(0);
    p5.strokeWeight(3 * u);
    p5.ellipse(ball.x, ball.y, 22 * u, 22 * u);
  }

  function handleTransitions() {
    if (isPaused || isFinished || states.length <= 1) return;

    // Ball-flight transitional frames advance much faster than full rounds
    // and faster than the ball's own lerp settles - the ball keeps chasing
    // successive waypoints for a smooth start-to-finish flight, no pauses.
    // The landing state also arrives quicker when it follows a flight, so
    // the ball settles into the receiver instead of lingering.
    const current = states[currentStateIndex];
    const upcoming = states[currentStateIndex + 1];
    transitionProgress +=
      transitionSpeed *
      (upcoming?.transitional
        ? (upcoming.pace ?? 12)
        : current?.transitional
          ? 6
          : 1);
    if (transitionProgress < 1) return;
    transitionProgress = 0;

    // Last state reached - hold the final frame and hand control back to React
    if (currentStateIndex >= states.length - 1) {
      isFinished = true;
      if (onFinish) onFinish();
      return;
    }

    currentStateIndex += 1;
    const nextState = states[currentStateIndex];

    // Update targets for next state
    nextState.players.forEach((playerData) => {
      const player = players.find((p) => p.id === playerData.id);
      if (player) {
        const [px, py] = toFieldPx(playerData.x, playerData.y, playerData.id);
        player.targetX = px;
        player.targetY = py;
      }
    });

    // Update ball target
    if (ball && nextState.ball) {
      const [bx, by] = toFieldPx(
        nextState.ball.x,
        nextState.ball.y,
        nextState.ball.hasBall,
      );
      ball.targetX = bx;
      ball.targetY = by;
      ball.hasBall = nextState.ball.hasBall;

      // Entering a flight: extrapolate the whole trajectory as one polyline
      // - holder -> receiver/interception point -> goal - and let the ball
      // travel it continuously instead of parking at each state's waypoint.
      // Each waypoint's speed covers its leg in exactly that state's frame
      // budget, so arrivals coincide with the ticks and the ball never
      // freezes mid-air between states.
      if (nextState.transitional && !ball.path?.length) {
        const path = [];
        let px = ball.x;
        let py = ball.y;
        const push = (x, y, frames) => {
          path.push({
            x,
            y,
            speed: Math.hypot(x - px, y - py) / Math.max(1, frames),
          });
          px = x;
          py = y;
        };
        let k = currentStateIndex;
        while (k + 1 < states.length && states[k + 1]?.transitional) {
          const s = states[k + 1];
          const [wx, wy] = toFieldPx(s.ball.x, s.ball.y, s.ball.hasBall);
          push(wx, wy, 1 / (transitionSpeed * (s.pace ?? 12)));
          k++;
        }
        // landing frame - the first real state after the flight
        const land = states[k + 1];
        if (land?.ball) {
          const [ax, ay] = toFieldPx(
            land.ball.x,
            land.ball.y,
            land.ball.hasBall,
          );
          push(ax, ay, 1 / (transitionSpeed * 6));
        }
        ball.path = path;
      }
    }
    highlight = nextState.highlight ?? null;

    // Let React know so it can render the scoreboard for this state
    if (onStateChange) {
      onStateChange(currentStateIndex);
    }
  }

  p5.windowResized = () => {
    if (!fieldWidth) return;
    const [w, h] = canvasSize();
    // Mobile browsers fire resize on scroll (URL bar) - only rebuild when the
    // width actually changed, and rescale positions instead of snapping them
    if (Math.abs(w - fieldWidth) < 2) return;
    const sx = w / fieldWidth;
    const sy = h / fieldHeight;
    p5.resizeCanvas(w, h);
    fieldWidth = p5.width;
    fieldHeight = p5.height;
    players.forEach((player) => {
      player.currentX *= sx;
      player.currentY *= sy;
      player.targetX *= sx;
      player.targetY *= sy;
    });
    if (ball) {
      ball.x *= sx;
      ball.y *= sy;
      ball.targetX *= sx;
      ball.targetY *= sy;
      ball.speed *= sx;
      ball.path?.forEach((wp) => {
        wp.x *= sx;
        wp.y *= sy;
        wp.speed *= sx;
      });
    }
  };
}

const KICKOFF_DELAY = 2200; // ms the "kick-off" overlay stays up
const N_ROUNDS = 20; // mirrors the contract constant

const MatchView = ({ match, chain }) => {
  const explorer = chain?.explorer ?? null;
  const { isDark } = useTheme();
  const states = match.states;
  const roster = match.roster;
  const kitA = isDark ? JERSEY.A.dark : JERSEY.A.light;
  const kitB = isDark ? JERSEY.B.dark : JERSEY.B.light;
  const finalScore = states[states.length - 1].score;
  const [stateIndex, setStateIndex] = useState(0);
  const [phase, setPhase] = useState("kickoff"); // kickoff | playing | finished
  const [runId, setRunId] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [commentaryOn, setCommentaryOn] = useState(false);
  const [rosterTab, setRosterTab] = useState("A");
  const [line, setLine] = useState("");
  const previousIndex = useRef(0);
  // Live (unfinished) matches keep receiving states - the replay pauses at the
  // last known state instead of showing the full-time overlay.
  const live = match.status !== "finished";

  const handleStateChange = useCallback((index) => setStateIndex(index), []);
  const handleFinish = useCallback(() => setPhase("finished"), []);

  // Hold the kick-off overlay briefly, then let the match run
  useEffect(() => {
    if (phase !== "kickoff") return;
    const timer = setTimeout(() => setPhase("playing"), KICKOFF_DELAY);
    return () => clearTimeout(timer);
  }, [phase, runId]);

  useEffect(() => {
    setMuted(!soundOn);
  }, [soundOn]);

  useEffect(() => {
    setSpeechMuted(!commentaryOn);
  }, [commentaryOn]);

  // Browsers keep audio suspended until the user interacts with the page
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // One blast to start the match, three to end it, with the commentator
  // coming in just after the whistle
  useEffect(() => {
    if (phase !== "kickoff" && phase !== "finished") return;

    if (phase === "finished" && live) {
      setLine("Waiting on the agents' next moves…");
      return;
    }

    playWhistle(phase === "kickoff" ? 1 : 3);
    const text = phase === "kickoff" ? openingLine() : closingLine(finalScore);
    setLine(text);

    const timer = setTimeout(() => speak(text), 700);
    return () => clearTimeout(timer);
  }, [phase, runId]);

  // The replay reached the end of a live match, then more states arrived -
  // pick up where we left off rather than staying on the waiting screen.
  useEffect(() => {
    if (phase === "finished" && live && stateIndex < states.length - 1) {
      setPhase("playing");
    }
  }, [match, phase, live, stateIndex, states.length]);

  // Sound and commentary for whatever the current state is doing
  useEffect(() => {
    const previous = states[previousIndex.current];
    const current = states[stateIndex];
    previousIndex.current = stateIndex;
    if (!current || stateIndex === 0) return;

    const scored =
      previous &&
      (current.score.A !== previous.score.A ||
        current.score.B !== previous.score.B);

    if (scored) playGoal();
    else if (current.action?.type === "pass") playPass();
    else if (current.action?.type === "shoot") playShot();

    // Generated once per state so the spoken and displayed lines always match
    const text = describeState(states, stateIndex, roster);
    setLine(text);
    speak(text);
  }, [stateIndex]);

  // Don't leave the commentator talking after navigating away
  useEffect(() => stopSpeaking, []);

  const restart = () => {
    setStateIndex(0);
    previousIndex.current = 0;
    setRunId((id) => id + 1);
    setPhase("kickoff");
  };

  const { score, ball } = states[stateIndex];
  // Ball-flight transitional frames don't count towards the round tally.
  const roundIndex = states
    .slice(0, stateIndex + 1)
    .filter((s) => !s.transitional).length;

  return (
    <div className="drakarys">
      <header className="drakarys-banner">
        <div className="drakarys-banner-left">
          <img src={fireImage} alt="" className="banner-logo" />
          <span className="title">Drakarys</span>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span className="tagline">AI Competition Platform</span>
        </div>
        <span className="tagline agents">
          {match.agent0} vs {match.agent1}
        </span>
        {chain && (
          <span className="chain-pill">
            {chain.icon && (
              <img src={apiUrl(chain.icon)} alt="" className="chain-icon" />
            )}
            <span>{chain.name.replace(/-(testnet|devnet|sepolia)$/i, "")}</span>
          </span>
        )}
        <Link
          to={`/projects/drakarys${match.chain ? `?chain=${match.chain}` : ""}`}
          className="back-link"
        >
          ← Matches
        </Link>
      </header>
      <div className="match-controls">
        <div className="scoreboard">
          <div className="side side-a">
            <Crest team="A" fill={kitA.fill} ink={kitA.ink} />
            <span className="team team-a">{TEAMS.A.name}</span>
          </div>
          <div className="score-center">
            <span className="score">
              <span className="score-a">{score.A}</span>
              <span className="score-sep">:</span>
              <span className="score-b">{score.B}</span>
            </span>
            <div className="state-track" aria-hidden="true">
              <div
                className="state-fill"
                style={{
                  width: `${(Math.min(roundIndex, N_ROUNDS) / N_ROUNDS) * 100}%`,
                }}
              />
            </div>
            {explorer && states[stateIndex]?.revealTx ? (
              <a
                className={`state-idx ${live ? "live" : ""}`}
                href={explorer.replace("{tx}", states[stateIndex].revealTx)}
                target="_blank"
                rel="noreferrer"
                title="Open the reveal transaction in the chain explorer"
              >
                {live ? "live" : "state"} {roundIndex} / {N_ROUNDS}
              </a>
            ) : (
              <span className={`state-idx ${live ? "live" : ""}`}>
                {live ? "live" : "state"} {roundIndex} / {N_ROUNDS}
              </span>
            )}
          </div>
          <div className="side side-b">
            <span className="team team-b">{TEAMS.B.name}</span>
            <Crest team="B" fill={kitB.fill} ink={kitB.ink} />
          </div>
        </div>
        <button
          type="button"
          className="sound-toggle commentary-toggle"
          aria-label={commentaryOn ? "Mute commentator" : "Unmute commentator"}
          onClick={() => {
            unlockAudio();
            setCommentaryOn((on) => !on);
          }}
        >
          {commentaryOn ? "Commentary on" : "Commentary off"}
        </button>
        <button
          type="button"
          className="sound-toggle"
          aria-label={soundOn ? "Mute sound effects" : "Unmute sound effects"}
          onClick={() => {
            unlockAudio();
            setSoundOn((on) => !on);
          }}
        >
          {soundOn ? "Sound on" : "Sound off"}
        </button>
      </div>
      <div className="match-layout">
        <RosterTable
          team="A"
          isDark={isDark}
          ballHolder={ball?.hasBall}
          roster={roster}
          mobileHidden={rosterTab !== "A"}
        />
        <div className="field-column">
          <div id="football-canvas">
            <ReactP5Wrapper
              sketch={sketch}
              isDark={isDark}
              states={states}
              roster={roster}
              paused={phase !== "playing"}
              runId={runId}
              onStateChange={handleStateChange}
              onFinish={handleFinish}
            />
            {phase === "kickoff" && (
              <div className="field-overlay">
                <p className="headline">Kick-off</p>
                <p className="detail">
                  {TEAMS.A.name} vs {TEAMS.B.name}
                </p>
              </div>
            )}
            {phase === "finished" && (
              <div className="field-overlay">
                {live ? (
                  <>
                    <p className="headline">Waiting for agent moves</p>
                    <p className="detail">
                      {Math.min(roundIndex, N_ROUNDS)} / {N_ROUNDS} states
                      revealed
                    </p>
                  </>
                ) : (
                  <>
                    <p className="headline">Full time</p>
                    <p className="detail">
                      {TEAMS.A.name} {score.A} - {score.B} {TEAMS.B.name}
                    </p>
                    <button type="button" className="replay" onClick={restart}>
                      Run the match again
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <p className="commentary" aria-live="polite">
            <span>{line}</span>
          </p>
        </div>
        {/* Subtabs under the field - only shown on small screens, where a
            single roster is visible at a time */}
        <div className="roster-tabs">
          {["A", "B"].map((t) => (
            <button
              key={t}
              type="button"
              className={`roster-tab${rosterTab === t ? " active" : ""}`}
              onClick={() => setRosterTab(t)}
            >
              <Jersey
                fill={(isDark ? JERSEY[t].dark : JERSEY[t].light).fill}
                ink={(isDark ? JERSEY[t].dark : JERSEY[t].light).ink}
                number=""
              />
              {TEAMS[t].name}
            </button>
          ))}
        </div>
        <RosterTable
          team="B"
          isDark={isDark}
          ballHolder={ball?.hasBall}
          roster={roster}
          mobileHidden={rosterTab !== "B"}
        />
      </div>
    </div>
  );
};

// Loads the match for the :matchId param, then hands it to MatchView so the
// match UI never has to deal with a missing states array.
const DrakarysMatch = () => {
  const { chain, matchId } = useParams();
  const [match, setMatch] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState(null);
  const [chains, setChains] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchChains()
      .then((data) => {
        if (!cancelled) setChains(data);
      })
      .catch(() => {
        if (!cancelled) setChains([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMatch(undefined);
    setError(null);
    fetchMatch(matchId, chain)
      .then((data) => {
        if (!cancelled) setMatch(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, chain]);

  // Live matches keep growing - re-fetch while the match is still in progress
  useEffect(() => {
    if (!match || match.status !== "in_progress") return;
    const timer = setInterval(() => {
      fetchMatch(matchId, chain)
        .then((data) => setMatch(data))
        .catch(() => {
          /* transient backend hiccup - try again next tick */
        });
    }, 3000);
    return () => clearInterval(timer);
  }, [matchId, chain, match?.status]);

  if (error || match === null) {
    return (
      <div className="drakarys">
        <header className="drakarys-banner">
          <span className="title">Drakarys</span>
        </header>
        <p className="match-status">
          {error ?? `No match found for '${matchId}'.`}
        </p>
        <Link
          to={`/projects/drakarys${chain ? `?chain=${chain}` : ""}`}
          className="back-link"
        >
          ← Back to matches
        </Link>
      </div>
    );
  }

  if (match === undefined || !match.states?.length || !match.roster) {
    return (
      <div className="drakarys">
        <header className="drakarys-banner">
          <span className="title">Drakarys</span>
        </header>
        <p className="match-status">Loading match…</p>
      </div>
    );
  }

  return (
    <MatchView
      key={matchId}
      match={match}
      chain={chains.find((c) => c.name === match.chain) ?? null}
    />
  );
};

export default DrakarysMatch;
