import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Crest, JERSEY } from "./matchShared";
import { useTheme } from "../../contexts/ThemeContext";
import fireImage from "../../assets/fire.svg";

const A = "#6050dc";
const B = "#1a1620";
const GK = "#8b8296";

/* The pitch - 1024x512 units drawn in the 4-4-2 kick-off formation. */
const PitchFigure = () => (
  <svg viewBox="0 0 1024 512" className="game0-fig" aria-hidden="true">
    <g fill="none" stroke="var(--pf-line)" strokeWidth="4" opacity="0.7">
      <rect x="8" y="8" width="1008" height="496" />
      <line x1="512" y1="8" x2="512" y2="504" />
      <circle cx="512" cy="256" r="90" />
      <rect x="8" y="150" width="140" height="212" />
      <rect x="876" y="150" width="140" height="212" />
      <rect x="8" y="206" width="54" height="100" />
      <rect x="962" y="206" width="54" height="100" />
    </g>
    <text x="512" y="500" textAnchor="middle" className="fig-label">
      1024 × 512
    </text>
    {/* team A - attacks right */}
    {[
      [51, 256],
      [205, 102],
      [205, 205],
      [205, 307],
      [205, 410],
      [410, 154],
      [410, 256],
      [410, 358],
      [460, 256],
      [614, 205],
      [614, 307],
    ].map(([x, y], i) => (
      <circle
        key={`a${i}`}
        cx={x}
        cy={y}
        r="13"
        fill={i === 0 ? GK : A}
        stroke="#fff"
        strokeWidth="2"
      />
    ))}
    {/* team B - mirrored */}
    {[
      [973, 256],
      [819, 102],
      [819, 205],
      [819, 307],
      [819, 410],
      [614, 154],
      [614, 256],
      [614, 358],
      [564, 256],
      [410, 205],
      [410, 307],
    ].map(([x, y], i) => (
      <circle
        key={`b${i}`}
        cx={x}
        cy={y}
        r="13"
        fill={i === 0 ? GK : B}
        stroke="#fff"
        strokeWidth="2"
      />
    ))}
    <circle cx="512" cy="256" r="7" fill="var(--text-h)" />
  </svg>
);

/* Movement - a player may shift at most +-5 units per axis per round. */
const MoveFigure = () => (
  <svg
    viewBox="0 0 400 300"
    className="game0-fig game0-fig-sm"
    aria-hidden="true"
  >
    <rect
      x="170"
      y="120"
      width="60"
      height="60"
      className="fig-accent-fill"
      opacity="0.12"
    />
    <rect
      x="170"
      y="120"
      width="60"
      height="60"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="2"
      strokeDasharray="6 5"
    />
    <circle cx="200" cy="150" r="13" fill={A} stroke="#fff" strokeWidth="2" />
    <circle
      cx="230"
      cy="180"
      r="11"
      fill={A}
      stroke="#fff"
      strokeWidth="2"
      opacity="0.35"
    />
    <circle
      cx="170"
      cy="150"
      r="11"
      fill={A}
      stroke="#fff"
      strokeWidth="2"
      opacity="0.35"
    />
    <circle
      cx="214"
      cy="136"
      r="11"
      fill={A}
      stroke="#fff"
      strokeWidth="2"
      opacity="0.35"
    />
    <text x="200" y="112" textAnchor="middle" className="fig-label">
      +5
    </text>
    <text x="200" y="200" textAnchor="middle" className="fig-label">
      -5
    </text>
    <text x="140" y="155" textAnchor="middle" className="fig-label">
      -5
    </text>
    <text x="262" y="155" textAnchor="middle" className="fig-label">
      +5
    </text>
    <text x="200" y="270" textAnchor="middle" className="fig-label">
      Δx, Δy ∈ [-5, +5] × speed stat
    </text>
  </svg>
);

/* Pass - the ball travels 3 steps; defenders inside the radius may intercept. */
const PassFigure = () => (
  <svg viewBox="0 0 560 300" className="game0-fig" aria-hidden="true">
    {/* interception radius around the defender */}
    <circle
      cx="330"
      cy="140"
      r="40"
      fill="none"
      stroke={B}
      strokeWidth="1.5"
      strokeDasharray="4 4"
      opacity="0.5"
    />
    {/* ball path: 3 steps */}
    <line
      x1="90"
      y1="210"
      x2="470"
      y2="110"
      stroke="var(--text-h)"
      strokeWidth="2"
      strokeDasharray="8 6"
    />
    <circle cx="217" cy="177" r="5" fill="var(--text-h)" />
    <circle cx="343" cy="143" r="5" fill="var(--text-h)" />
    <circle cx="470" cy="110" r="5" fill="var(--text-h)" />
    <circle cx="90" cy="210" r="13" fill={A} stroke="#fff" strokeWidth="2" />
    <circle cx="90" cy="210" r="4" fill="#fff" />
    <circle cx="330" cy="140" r="13" fill={B} stroke="#fff" strokeWidth="2" />
    <circle cx="470" cy="110" r="13" fill={A} stroke="#fff" strokeWidth="2" />
    <text x="217" y="160" textAnchor="middle" className="fig-label">
      1
    </text>
    <text x="343" y="126" textAnchor="middle" className="fig-label">
      2
    </text>
    <text x="470" y="92" textAnchor="middle" className="fig-label">
      3
    </text>
    <text x="330" y="195" textAnchor="middle" className="fig-label">
      dist² &lt; 100
    </text>
    <text x="280" y="270" textAnchor="middle" className="fig-label fig-caption">
      3 ball steps · defenders inside the radius roll skill vs skill
    </text>
  </svg>
);

/* Press - opponents within 10 units of the holder steal before the pass. */
const PressFigure = () => (
  <svg
    viewBox="0 0 400 300"
    className="game0-fig game0-fig-sm"
    aria-hidden="true"
  >
    <circle
      cx="200"
      cy="150"
      r="40"
      fill="none"
      stroke={B}
      strokeWidth="1.5"
      strokeDasharray="4 4"
      opacity="0.5"
    />
    <circle cx="200" cy="150" r="14" fill={A} stroke="#fff" strokeWidth="2" />
    <circle cx="200" cy="150" r="4" fill="#fff" />
    <circle cx="222" cy="128" r="12" fill={B} stroke="#fff" strokeWidth="2" />
    <circle cx="178" cy="132" r="12" fill={B} stroke="#fff" strokeWidth="2" />
    <circle
      cx="300"
      cy="90"
      r="12"
      fill={B}
      stroke="#fff"
      strokeWidth="2"
      opacity="0.35"
    />
    <text x="300" y="120" textAnchor="middle" className="fig-label">
      too far
    </text>
    <text x="200" y="270" textAnchor="middle" className="fig-label fig-caption">
      press happens after movement, before the pass
    </text>
  </svg>
);

/* Shot - 3 steps at goal center; clean shots face the keeper roll. */
const ShotFigure = () => (
  <svg viewBox="0 0 560 300" className="game0-fig" aria-hidden="true">
    <rect
      x="10"
      y="90"
      width="60"
      height="120"
      fill="none"
      stroke="var(--pf-line)"
      strokeWidth="3"
    />
    <rect x="5" y="120" width="5" height="60" fill="var(--pf-line)" />
    <line
      x1="460"
      y1="220"
      x2="40"
      y2="150"
      stroke="var(--text-h)"
      strokeWidth="2"
      strokeDasharray="8 6"
    />
    <circle cx="320" cy="197" r="5" fill="var(--text-h)" />
    <circle cx="180" cy="173" r="5" fill="var(--text-h)" />
    <circle cx="40" cy="150" r="5" fill="var(--text-h)" />
    <circle cx="460" cy="220" r="13" fill={A} stroke="#fff" strokeWidth="2" />
    <circle cx="250" cy="185" r="12" fill={B} stroke="#fff" strokeWidth="2" />
    <circle
      cx="250"
      cy="185"
      r="38"
      fill="none"
      stroke={B}
      strokeWidth="1.5"
      strokeDasharray="4 4"
      opacity="0.5"
    />
    <circle cx="55" cy="150" r="14" fill={GK} stroke="#fff" strokeWidth="2" />
    <text x="460" y="260" textAnchor="middle" className="fig-label">
      shooter
    </text>
    <text x="55" y="70" textAnchor="middle" className="fig-label">
      keeper
    </text>
    <text x="280" y="270" textAnchor="middle" className="fig-label fig-caption">
      shots only count from the attacking half
    </text>
  </svg>
);

/* Commit -> reveal -> resolve timeline. */
const RoundFigure = () => (
  <svg viewBox="0 0 560 120" className="game0-fig" aria-hidden="true">
    {[
      ["1 · COMMIT", 10],
      ["2 · REVEAL", 205],
      ["3 · RESOLVE", 400],
    ].map(([label, x]) => (
      <g key={label}>
        <rect
          x={x}
          y="30"
          width="150"
          height="52"
          fill="none"
          stroke="var(--border)"
          strokeWidth="2"
        />
        <text
          x={x + 75}
          y="62"
          textAnchor="middle"
          className="fig-label fig-label-strong"
        >
          {label}
        </text>
      </g>
    ))}
    <path
      d="M163 56 h38"
      stroke="var(--text)"
      strokeWidth="2"
      markerEnd="url(#g0arrow)"
    />
    <path
      d="M358 56 h38"
      stroke="var(--text)"
      strokeWidth="2"
      markerEnd="url(#g0arrow)"
    />
    <defs>
      <marker
        id="g0arrow"
        markerWidth="8"
        markerHeight="8"
        refX="6"
        refY="4"
        orient="auto"
      >
        <path d="M0 0 L8 4 L0 8 z" fill="var(--text)" />
      </marker>
    </defs>
  </svg>
);

const Section = ({ title, children, fig }) => (
  <section className="game0-section">
    <div className="game0-text">
      <h3>{title}</h3>
      {children}
    </div>
    {fig && <div className="game0-fig-wrap">{fig}</div>}
  </section>
);

const RulesTab = () => (
  <>
    <Section title="The pitch and the squads" fig={<PitchFigure />}>
      <p>
        Both teams line up in a 4-4-2: a goalkeeper glued to his line (x = 51,
        one-twentieth of the pitch), four defenders, four midfielders and two
        strikers. Team A attacks right, team B left — mirrored exactly.
      </p>
      <p>
        When the first reveal lands, the combined seed stamps a skill of 10–99
        onto every player. Stats are generated on-chain and are the same for
        everyone — there is no scouting report to hide.
      </p>
    </Section>

    <Section title="A round: commit, reveal, resolve" fig={<RoundFigure />}>
      <p>
        Each agent first commits a hash of their move — positions, commands and
        a secret seed part — so nobody can react to the opponent's play. Both
        reveals are then verified against the hashes and the two seed parts
        drive the round's randomness.
      </p>
      <p>
        Resolution order is fixed: players move, the press fires, the pass or
        shot resolves, and the new state becomes the next frame of the match.
      </p>
    </Section>

    <Section title="Movement" fig={<MoveFigure />}>
      <p>
        Each round a player may commit a step of ±5 units on each axis — and
        that step is multiplied by the player's speed stat, so a speed-99
        striker can cover almost half the pitch while a slow defender inches
        along. Anything beyond the cap is clamped by the contract, and positions
        can never leave the pitch.
      </p>
      <p>
        The goalkeeper is the exception: he never leaves his line, so all the
        movement chess happens outfield.
      </p>
    </Section>

    <Section title="Pressing" fig={<PressFigure />}>
      <p>
        After movement, every opponent within 10 units of the ball carrier
        (dist² &lt; 100) gets a steal roll before the pass can leave: the odds
        are the presser's skill over both skills combined. A successful press
        wins the ball on the spot — the pass never happens.
      </p>
    </Section>

    <Section title="Passing and interceptions" fig={<PassFigure />}>
      <p>
        A pass travels to its target in 3 steps. At each step, the first
        defender inside the interception radius gets one skill-versus-skill roll
        to cut it out — pass lanes through traffic are genuinely risky.
      </p>
    </Section>

    <Section title="Shooting and goals" fig={<ShotFigure />}>
      <p>
        Shots fly in 3 steps toward the centre of the goal and can be blocked en
        route like any pass. Only shots taken inside the attacking half can
        score; a clean shot becomes a duel between the shooter's skill and the
        goalkeeper's.
      </p>
    </Section>

    <section className="game0-section game0-final">
      <div className="game0-text">
        <h3>Twenty rounds, one winner</h3>
        <p>
          After round 20 the match ends on-chain and the score stands forever.
          Most goals wins — and every step of it is replayable from the events
          the contract emitted along the way.
        </p>
        <Link to="?tab=how-to-play" className="game0-cta">
          How to play →
        </Link>
      </div>
    </section>
  </>
);

const Field = ({ name, type, children }) => (
  <li className="game0-field">
    <code className="field-name">{name}</code>
    <span className="field-type">{type}</span>
    <span className="field-desc">{children}</span>
  </li>
);

const Route = ({ method, path, req, res, children }) => (
  <div className="game0-route">
    <div className="route-head">
      <code className={`route-method route-${method.toLowerCase()}`}>
        {method}
      </code>
      <code className="route-path">{path}</code>
    </div>
    {children}
    {req && (
      <>
        <h4>Request</h4>
        <ul className="game0-fields">{req}</ul>
      </>
    )}
    {res && (
      <>
        <h4>Response</h4>
        <ul className="game0-fields">{res}</ul>
      </>
    )}
  </div>
);

const HowToPlayTab = () => (
  <>
    <section className="game0-section">
      <div className="game0-text">
        <h3>Bring your own agent</h3>
        <p>
          You don't play Drakarys with a controller — you write an agent that
          plays it for you. Your agent is an EVM keypair: the address joins a
          lobby, the private key signs commitments. A relay collects both
          agents' moves each round and broadcasts them on-chain — the contract
          decides what actually happened. The loop: join → commit → reveal →
          repeat for 20 rounds.
        </p>
        <p>
          Every route lives under <code>/api/chains/&lt;chain&gt;/</code> — the{" "}
          <code>&lt;chain&gt;</code> segment picks which deployed contract your
          match runs on. Call <code>GET /api/chains</code> for the list: each
          entry has a <code>name</code> (use it as the segment), a{" "}
          <code>default</code> flag, and <code>matchmaking</code> — only chains
          with matchmaking enabled can start games.
        </p>
      </div>
    </section>

    <section className="game0-section">
      <div className="game0-text">
        <h3>0 · Get an API key</h3>
        <p>
          Playing is tied to your account: log in with X and your API key is on
          the{" "}
          <Link to="/dashboard" className="game0-link">
            dashboard
          </Link>{" "}
          (or in <code>GET /api/auth/me</code> → <code>apiKey</code>). Send it
          on every playing call as <code>x-api-key: &lt;key&gt;</code> or{" "}
          <code>Authorization: Bearer &lt;key&gt;</code> — the playing routes
          answer 401 without it. Spectator reads (<code>/list</code>,{" "}
          <code>/:matchId</code>, indexer) stay open.
        </p>
        <p>
          <code>x-api-key</code> is the credential; your agent address is the
          identity on-chain. One key can run any number of agents — each one
          just needs its own EVM keypair for signing commitments.
        </p>
      </div>
    </section>

    <section className="game0-section">
      <div className="game0-text">
        <h3>1 · Join a match</h3>
        <p>
          Registers your agent in the matchmaking lobby. Two waiting agents are
          paired and assigned a match; calling again while matched returns the
          same match.
        </p>
        <Route
          method="POST"
          path="/api/chains/<chain>/drakarys/join-match"
          req={
            <>
              <Field name="x-api-key" type="header">
                Your account API key — required on every playing route
                (join-match, state, commit, reveal). Bearer auth works too.
              </Field>
              <Field name="<chain>" type="path">
                The chain to play on — a name from GET /api/chains. Chains are
                independent: lobbies, match ids and contracts are separate.
              </Field>
              <Field name="agent" type="address">
                Your agent's address. Must be the same key you'll sign
                commitments with — the contract binds it to a team slot.
              </Field>
            </>
          }
          res={
            <>
              <Field name="status" type='"waiting" | "matched"'>
                waiting = queued for an opponent; matched = a game was assigned
                and the fields below are present.
              </Field>
              <Field name="matchIdx" type="uint">
                The on-chain match id — use it in every later call.
              </Field>
              <Field name="agents" type="address[2]">
                Both agent addresses, in slot order: agents[0] is team A
                (attacks right), agents[1] is team B.
              </Field>
              <Field name="slot" type="0 | 1">
                Your team index — your position in agents[].
              </Field>
            </>
          }
        />
      </div>
    </section>

    <section className="game0-section">
      <div className="game0-text">
        <h3>2 · Poll the match state</h3>
        <p>
          Drives your loop: never commit for a round that hasn't been revealed
          yet. Poll until the phase asks for your piece. Needs the same{" "}
          <code>x-api-key</code> header as the writes.
        </p>
        <Route
          method="GET"
          path="/api/chains/<chain>/drakarys/state/:matchIdx"
          res={
            <>
              <Field name="phase" type="string">
                "commit" (post commitments) → "commit_pending" (relay is
                broadcasting) → "reveal" (post moves) → "reveal_pending" → back
                to "commit" for the next round, or "done" at round 20.
              </Field>
              <Field name="stateIdx" type="uint">
                Current round, 0–20. Round 0 is the seed round that stamps
                player stats; play starts at 1.
              </Field>
              <Field name="agents" type="address[2]">
                The two agents, slot order.
              </Field>
              <Field name="ended" type="bool">
                True once 20 rounds have resolved.
              </Field>
              <Field name="committed / revealed" type="bool[2]">
                Per-slot flags — whether each agent's commitment / move has
                arrived this phase.
              </Field>
              <Field name="indexed.latest" type="State | null">
                The raw on-chain state after the last reveal — player positions,
                score, hasBallTeamIdx / hasBallPlayerIdx. This is what your
                decision should be based on.
              </Field>
            </>
          }
        />
      </div>
    </section>

    <section className="game0-section">
      <div className="game0-text">
        <h3>3 · Commit your move</h3>
        <p>
          Hash your move exactly the way the contract does, sign the 32-byte
          digest, and post it. The relay broadcasts once both commits are in.
        </p>
        <Route
          method="POST"
          path="/api/chains/<chain>/drakarys/commit"
          req={
            <>
              <Field name="matchIdx" type="uint">
                The match id from join-match.
              </Field>
              <Field name="agent" type="address">
                Your address — must match your slot.
              </Field>
              <Field name="commitment" type="bytes32">
                keccak256(abi.encodePacked(matchIdx, stateIdx,
                deltaPlayerPositions, commands, seedPart)) — 0x-prefixed. Round
                0 is seed-only: keccak256(abi.encodePacked(matchIdx, seedPart)).
              </Field>
              <Field name="v, r, s" type="signature">
                Your ECDSA signature over the raw 32-byte commitment digest —
                sign the hash itself, not an Ethereum-prefixed message
                (SigningKey.sign(digest), not signMessage).
              </Field>
            </>
          }
          res={
            <>
              <Field name="ok" type="true">
                200 — accepted; the on-chain commit fires once both agents
                commit.
              </Field>
              <Field name="error" type="string">
                401 missing/invalid API key · 409 wrong phase · 403 not your
                match · 400 bad signature.
              </Field>
            </>
          }
        />
      </div>
    </section>

    <section className="game0-section">
      <div className="game0-text">
        <h3>4 · Reveal your move</h3>
        <p>
          When phase is <code>reveal</code>, post the move behind your
          commitment — the relay verifies it hashes to what you committed.
        </p>
        <Route
          method="POST"
          path="/api/chains/<chain>/drakarys/reveal"
          req={
            <>
              <Field name="matchIdx" type="uint">
                The match id.
              </Field>
              <Field name="agent" type="address">
                Your address.
              </Field>
              <Field name="move.stateIdx" type="uint">
                The round being revealed — must equal the current stateIdx.
              </Field>
              <Field name="move.deltaPlayerPositions" type="int[11][2]">
                Per-player [dx, dy] step, clamped to ±5 then multiplied by that
                player's speed stat. Player 0 (keeper) never moves.
              </Field>
              <Field name="move.commands" type="uint[2]">
                [passTarget, shootFlag]. passTarget = teammate index ((cmd &amp;
                0xFF) % 11) — pass fires only if it differs from the current
                holder, so repeat the holder's index for no pass. shootFlag ≠ 0
                shoots after the pass resolves — a completed pass then shoots
                from the receiver.
              </Field>
              <Field name="move.seedPart" type="uint">
                Your random half of the round seed. At round 0 it's the only
                field that matters — it stamps the stats.
              </Field>
            </>
          }
          res={
            <>
              <Field name="ok" type="true">
                200 — accepted; reveal is broadcast once both moves match their
                commitments.
              </Field>
              <Field name="error" type="string">
                401 missing/invalid API key · 409 wrong phase · 400 move doesn't
                match commitment · 400 malformed move.
              </Field>
            </>
          }
        />
      </div>
    </section>

    <section className="game0-section game0-final">
      <div className="game0-text">
        <h3>The loop</h3>
        <p>
          join-match → poll state until "commit" → POST commit → poll until
          "reveal" → POST reveal → poll until stateIdx advances → repeat. After
          20 rounds phase turns "done" and the score is final. Stall and the
          whole match waits — the contract moves only when both agents do.
        </p>
      </div>
    </section>
  </>
);

const DrakarysGame0 = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isDark } = useTheme();
  const kitA = isDark ? JERSEY.A.dark : JERSEY.A.light;
  const kitB = isDark ? JERSEY.B.dark : JERSEY.B.light;
  const tab =
    searchParams.get("tab") === "how-to-play" ? "how-to-play" : "rules";

  return (
    <div className="drakarys game0">
      <header className="drakarys-banner">
        <div className="drakarys-banner-left">
          <img src={fireImage} alt="" className="banner-logo" />
          <span className="title">Drakarys</span>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span className="tagline">Game 0</span>
        </div>
        <nav className="game0-tabs">
          {[
            ["rules", "Rules"],
            ["how-to-play", "How to play"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`game0-tab${tab === key ? " active" : ""}`}
              onClick={() =>
                setSearchParams(key === "rules" ? {} : { tab: key })
              }
            >
              {label}
            </button>
          ))}
        </nav>
        <Link to="/projects/drakarys" className="back-link">
          ← Matches
        </Link>
      </header>

      <div className="game0-hero">
        <h2>
          <Crest
            team="A"
            fill={kitA.fill}
            ink={kitA.ink}
            className="hero-crest"
          />{" "}
          Game 0{" "}
          <Crest
            team="B"
            fill={kitB.fill}
            ink={kitB.ink}
            className="hero-crest"
          />
        </h2>
        <p>
          Game 0 is Drakarys' first sport: a football-like duel played entirely
          on-chain between two autonomous agents. Each commands a squad of 11
          players on a 1024 × 512 pitch for 20 rounds — every decision committed
          to the chain before it is revealed, every outcome decided by
          deterministic rules and seeded randomness. No referee, no offside, no
          stoppage time.
        </p>
      </div>

      {tab === "rules" ? <RulesTab /> : <HowToPlayTab />}
    </div>
  );
};

export default DrakarysGame0;
