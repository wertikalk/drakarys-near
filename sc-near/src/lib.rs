// Drakarys_GAME_0 - NEAR port of sc/src/Drakarys_GAME_0.sol.
//
// Same commit/reveal protocol and game transition logic as the EVM and
// Solana deployments. Agents are EVM-style ECDSA identities: the operator
// relays keccak commitments signed by each agent, and the contract verifies
// them with the ecrecover host function (same trust model as the EVM
// contract - stronger than Solana's signer binding, where on-chain agents
// are custodial slot keypairs).
//
// Indexing-friendly extras vs EVM/Solana:
// - Full state history is stored on-chain (bounded by N_ROUNDS + 1 states)
//   so indexers reconstruct history with a single view call.
// - Game events (starts, commits, reveals, interceptions, shots, match end)
//   are appended to a per-match event log, also exposed via view. Standard
//   EVENT_JSON log lines are emitted too.
//
// Move/commitment encoding is identical to EVM (abi.encodePacked keccak) so
// the same agents can play on any deployment.

use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

pub const N_ROUNDS: u8 = 20;
pub const N_TEAMS: usize = 2;
pub const N_PLAYERS: usize = 11;
pub const N_STATS: usize = 2;
pub const DELTA_X_RANGE: i64 = 5;
pub const DELTA_Y_RANGE: i64 = 5;
pub const FIELD_WIDTH: i64 = 1024;
pub const FIELD_HEIGHT: i64 = 512;
pub const GOALKEEPER_X: i64 = FIELD_WIDTH / 20;
pub const N_BALL_STEPS: i64 = 3;
pub const INTERCEPTION_DISTANCE_SQUARED: i64 = 100;

const MATCHES_KEY: &[u8] = b"m";
const MATCH_IDS_KEY: &[u8] = b"i";

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Default)]
pub struct TeamState {
    pub player_positions: [[i64; 2]; 11],
    pub pass: bool,
    pub passing_to: u64,
    pub shoot: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Default)]
pub struct GameState {
    pub teams: [TeamState; 2],
    pub score: [u64; 2],
    pub has_ball_team_idx: u8,
    pub has_ball_player_idx: u8,
}

// One agent's move for a round - mirror `Move` in the EVM contract.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy)]
pub struct Move {
    pub state_idx: u64,
    pub delta_player_positions: [[i64; 2]; 11],
    pub commands: [u64; 2],
    pub seed_part: u64,
}

// Agent's ECDSA signature over the round's commitment, as posted to the
// matchmaking relay (v is the ethereum-style 27/28 recovery id).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy)]
pub struct Signature {
    pub v: u8,
    pub r: [u8; 32],
    pub s: [u8; 32],
}

// A game event. `kind` is one of: match_started, move_committed,
// move_revealed, interception, shot, match_ended. Payload fields are only
// meaningful for the kinds that carry them.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct MatchEvent {
    pub kind: String,
    pub state_idx: u64,
    pub team_idx: u64,
    pub player_idx: u64,
    pub x: i64,
    pub y: i64,
    pub goal: bool,
    // move_committed: the two 32-byte commitments
    pub data: Option<Vec<[u8; 32]>>,
    // move_revealed: the two revealed moves
    pub moves: Option<Vec<Move>>,
}

impl MatchEvent {
    fn of(kind: &str, state_idx: u64) -> Self {
        Self {
            kind: kind.to_string(),
            state_idx,
            team_idx: 0,
            player_idx: 0,
            x: 0,
            y: 0,
            goal: false,
            data: None,
            moves: None,
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct MatchEntry {
    pub match_idx: u64,
    pub state_idx: u8,
    // ECDSA addresses (20 bytes) bound via ecrecover on first commit -
    // zero-filled until then.
    pub agents: [[u8; 20]; 2],
    pub player_stats: [[[i64; 2]; 11]; 2],
    // Latest round's commitment pair - a new commit overwrites it (same as
    // the EVM contract's commits[matchIdx][stateIdx] = data).
    pub commit: Option<[[u8; 32]; 2]>,
    pub state: GameState,
    pub states: Vec<GameState>, // full history for indexers
    pub events: Vec<MatchEvent>,
}

// JSON view of a match - what nearIndexer.js polls.
#[near(serializers = [json])]
pub struct MatchView {
    pub match_idx: u64,
    pub state_idx: u8,
    pub agents: Vec<String>, // "0x..." EVM-style agent identities
    pub player_stats: Vec<Vec<Vec<i64>>>,
    pub state: GameState,
    pub states: Vec<GameState>,
    pub events: Vec<MatchEvent>,
    pub ended: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct DrakarysContract {
    // The account allowed to relay commits/reveals (the matchmaking relay).
    // Set at init like the EVM constructor's `operator = msg.sender`.
    operator: AccountId,
    matches: LookupMap<u64, MatchEntry>,
    match_ids: Vector<u64>,
}

#[near]
impl DrakarysContract {
    #[init]
    pub fn new() -> Self {
        Self {
            operator: env::predecessor_account_id(),
            matches: LookupMap::new(MATCHES_KEY),
            match_ids: Vector::new(MATCH_IDS_KEY),
        }
    }

    // Relay both agents' commitments for the current round. The first commit
    // binds agent identities for the rest of the match (as on EVM).
    pub fn commit(
        &mut self,
        match_idx: u64,
        data: [[u8; 32]; 2],
        signatures: [Signature; 2],
    ) {
        self.require_operator();
        let known = self.matches.contains_key(&match_idx);
        let mut m = self.matches.get(&match_idx).cloned().unwrap_or_else(|| {
            MatchEntry {
                match_idx,
                state_idx: 0,
                agents: [[0; 20]; 2],
                player_stats: [[[0; 2]; N_PLAYERS]; N_TEAMS],
                commit: None,
                state: GameState::default(),
                states: Vec::new(),
                events: Vec::new(),
            }
        });
        if !known {
            self.match_ids.push(match_idx);
        }

        for i in 0..N_TEAMS {
            let signer = recover_signer(&data[i], &signatures[i]);
            if m.agents[i] == [0u8; 20] {
                m.agents[i] = signer;
            } else {
                require!(signer == m.agents[i], "Invalid signature");
            }
        }
        m.commit = Some(data);

        let mut ev = MatchEvent::of("move_committed", m.state_idx as u64);
        ev.data = Some(data.to_vec());
        push_event(&mut m, ev);

        self.matches.insert(match_idx, m);
    }

    pub fn reveal(&mut self, match_idx: u64, moves: [Move; 2]) {
        self.require_operator();
        let mut m = self
            .matches
            .get(&match_idx)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown match"));

        // Match is over
        if m.state_idx == N_ROUNDS {
            self.matches.insert(match_idx, m);
            return;
        }

        let mut seed: i64;

        // Round 0 reveals the seed parts and builds the kick-off state
        if m.state_idx == 0 {
            let round_commits = m.commit.expect("Invalid commit");
            for i in 0..moves.len() {
                let mut encoded = Vec::new();
                pack_u256(match_idx, &mut encoded);
                pack_u256(moves[i].seed_part, &mut encoded);
                require!(
                    env::keccak256(&encoded)[..] == round_commits[i],
                    "Invalid commit"
                );
            }

            seed = rng((moves[0].seed_part / 2).wrapping_add(moves[1].seed_part) as i64);

            let mut st = GameState::default();
            for t in 0..N_TEAMS {
                for i in 0..N_PLAYERS {
                    for s in 0..N_STATS {
                        seed = rng(seed);
                        let stat = 10 + seed % 90;
                        m.player_stats[t][i][s] = stat.abs();
                    }
                    // note: implicitly the goalkeeper of team 0 has the ball
                    if i == 0 {
                        // goalkeeper holds a fixed position on his goal line
                        st.teams[t].player_positions[i][0] =
                            if t == 0 { GOALKEEPER_X } else { FIELD_WIDTH - GOALKEEPER_X };
                        st.teams[t].player_positions[i][1] = FIELD_HEIGHT / 2;
                    } else {
                        // 4-3-3 formation spread evenly down the field, mirrored for team 1
                        let (x, y) = if i <= 4 {
                            (FIELD_WIDTH / 5, FIELD_HEIGHT * i as i64 / 5)
                        } else if i <= 7 {
                            (
                                FIELD_WIDTH * 2 / 5,
                                FIELD_HEIGHT * (2 * (i - 5) as i64 + 3) / 10,
                            )
                        } else {
                            (FIELD_WIDTH * 3 / 5, FIELD_HEIGHT * (i - 7) as i64 / 4)
                        };
                        st.teams[t].player_positions[i][0] =
                            if t == 0 { x } else { FIELD_WIDTH - x };
                        st.teams[t].player_positions[i][1] = y;
                    }
                }
            }

            m.state = st;
            m.states.push(st);
            m.state_idx += 1;

            push_event(&mut m, MatchEvent::of("match_started", 0));
            let mut ev = MatchEvent::of("move_revealed", 0);
            ev.moves = Some(moves.to_vec());
            push_event(&mut m, ev);

            self.matches.insert(match_idx, m);
            return;
        }

        let curr = m.state;
        let mut next = GameState::default();
        let mut moves = moves;

        let state_idx = m.state_idx;
        let round_commits = m.commit.expect("Invalid commit");
        for i in 0..moves.len() {
            let mut encoded = Vec::new();
            pack_u256(match_idx, &mut encoded);
            pack_u256(moves[i].state_idx, &mut encoded);
            for p in moves[i].delta_player_positions.iter() {
                pack_i256(p[0], &mut encoded);
                pack_i256(p[1], &mut encoded);
            }
            for c in moves[i].commands.iter() {
                pack_u256(*c, &mut encoded);
            }
            pack_u256(moves[i].seed_part, &mut encoded);
            require!(
                env::keccak256(&encoded)[..] == round_commits[i],
                "Invalid commit"
            );
        }

        // seed the rng for this round from both agents' seed parts
        seed = rng((moves[0].seed_part / 2).wrapping_add(moves[1].seed_part) as i64);

        let mut ev = MatchEvent::of("move_revealed", state_idx as u64);
        ev.moves = Some(moves.to_vec());
        push_event(&mut m, ev);

        // Phase 1: Move the players
        for i in 0..moves.len() {
            for j in 0..N_PLAYERS {
                // goalkeeper never leaves his position on his goal line
                if j == 0 {
                    next.teams[i].player_positions[j] = curr.teams[i].player_positions[j];
                    continue;
                }
                // cap the delta player positions
                moves[i].delta_player_positions[j][0] =
                    moves[i].delta_player_positions[j][0].clamp(-DELTA_X_RANGE, DELTA_X_RANGE);
                moves[i].delta_player_positions[j][1] =
                    moves[i].delta_player_positions[j][1].clamp(-DELTA_Y_RANGE, DELTA_Y_RANGE);

                // cap the new position based on field size
                next.teams[i].player_positions[j][0] = (curr.teams[i].player_positions[j][0]
                    + moves[i].delta_player_positions[j][0] * m.player_stats[i][j][1])
                .clamp(0, FIELD_WIDTH);
                next.teams[i].player_positions[j][1] = (curr.teams[i].player_positions[j][1]
                    + moves[i].delta_player_positions[j][1] * m.player_stats[i][j][1])
                .clamp(0, FIELD_HEIGHT);
            }
        }

        // Phase 2: Handle `pass` = command[0] - encoded as 100...00 | playerIdx
        next.has_ball_team_idx = curr.has_ball_team_idx;
        next.has_ball_player_idx = curr.has_ball_player_idx;
        next.score = curr.score;
        let has_ball_team_idx = curr.has_ball_team_idx as usize;
        let has_ball_player_idx = curr.has_ball_player_idx as usize;

        // Post-move press - an opponent who closed in during the move can
        // steal the ball before the holder can pass or shoot.
        let (mut intercepted, new_seed) =
            resolve_press(&mut m, state_idx, &mut next, seed);
        seed = new_seed;

        let pass_target_player_idx =
            ((moves[has_ball_team_idx].commands[0] & 0xFF) as usize) % N_PLAYERS;

        if !intercepted && has_ball_player_idx != pass_target_player_idx {
            intercepted = resolve_pass(
                &mut m,
                state_idx,
                &mut next,
                has_ball_team_idx,
                has_ball_player_idx,
                pass_target_player_idx,
                seed,
            );
        }
        // Phase 3: Handle `shoot` = command[1] - the ball travels in
        // N_BALL_STEPS towards the opposing goal and can be intercepted
        // at each step
        if !intercepted && moves[has_ball_team_idx].commands[1] != 0 {
            resolve_shot(&mut m, state_idx, &mut next, seed);
        }

        m.state = next;
        m.states.push(next);
        m.state_idx += 1;

        if m.state_idx == N_ROUNDS {
            push_event(&mut m, MatchEvent::of("match_ended", state_idx as u64));
        }
        self.matches.insert(match_idx, m);
    }

    // ---- views ----

    pub fn get_match_ids(&self, offset: u64, limit: u64) -> Vec<u64> {
        self.match_ids
            .iter()
            .skip(offset as usize)
            .take(limit as usize)
            .copied()
            .collect()
    }

    pub fn get_match_count(&self) -> u64 {
        self.match_ids.len() as u64
    }

    pub fn get_match(&self, match_idx: u64) -> Option<MatchView> {
        self.matches.get(&match_idx).map(|m| MatchView {
            match_idx: m.match_idx,
            state_idx: m.state_idx,
            agents: m
                .agents
                .iter()
                .map(|a| format!("0x{}", hex::encode(a)))
                .collect(),
            player_stats: m
                .player_stats
                .iter()
                .map(|t| t.iter().map(|p| p.to_vec()).collect())
                .collect(),
            state: m.state,
            states: m.states.clone(),
            events: m.events.clone(),
            ended: m.state_idx >= N_ROUNDS,
        })
    }

    fn require_operator(&self) {
        require!(
            env::predecessor_account_id() == self.operator,
            "Not operator"
        );
    }
}

fn push_event(m: &mut MatchEntry, ev: MatchEvent) {
    if let Ok(json) = near_sdk::serde_json::to_string(&ev) {
        env::log_str(&format!("EVENT_JSON:{json}"));
    }
    m.events.push(ev);
}

// After the players move, every opponent within press range of the holder
// gets a skill roll to steal the ball before the pass leaves their feet.
fn resolve_press(
    m: &mut MatchEntry,
    state_idx: u8,
    next: &mut GameState,
    mut seed: i64,
) -> (bool, i64) {
    let holder_team = next.has_ball_team_idx as usize;
    let holder_player = next.has_ball_player_idx as usize;
    let ball_position = next.teams[holder_team].player_positions[holder_player];

    for j in 0..N_PLAYERS {
        let opp = next.teams[1 - holder_team].player_positions[j];
        let dx = opp[0] - ball_position[0];
        let dy = opp[1] - ball_position[1];
        if dx * dx + dy * dy >= INTERCEPTION_DISTANCE_SQUARED {
            continue;
        }

        let holder_skill = m.player_stats[holder_team][holder_player][0];
        let press_skill = m.player_stats[1 - holder_team][j][0];
        seed = rng(seed);
        let denom = holder_skill + press_skill;
        if denom > 0 && seed % denom < press_skill {
            next.has_ball_team_idx = (1 - holder_team) as u8;
            next.has_ball_player_idx = j as u8;
            let mut ev = MatchEvent::of("interception", state_idx as u64);
            ev.team_idx = (1 - holder_team) as u64;
            ev.player_idx = j as u64;
            ev.x = ball_position[0];
            ev.y = ball_position[1];
            push_event(m, ev);
            return (true, seed);
        }
    }
    (false, seed)
}

// The ball travels in N_BALL_STEPS towards the target and can be
// intercepted at each step. Returns whether the pass was intercepted.
fn resolve_pass(
    m: &mut MatchEntry,
    state_idx: u8,
    next: &mut GameState,
    has_ball_team_idx: usize,
    has_ball_player_idx: usize,
    pass_target_player_idx: usize,
    mut seed: i64,
) -> bool {
    let mut ball_position =
        next.teams[has_ball_team_idx].player_positions[has_ball_player_idx];

    // determine the trajectory of the ball
    let pass_direction = [
        next.teams[has_ball_team_idx].player_positions[pass_target_player_idx][0]
            - ball_position[0],
        next.teams[has_ball_team_idx].player_positions[pass_target_player_idx][1]
            - ball_position[1],
    ];

    for _ in 0..N_BALL_STEPS {
        ball_position[0] += pass_direction[0] / N_BALL_STEPS;
        ball_position[1] += pass_direction[1] / N_BALL_STEPS;

        // for each player of the opposing team determine if they can
        // intercept the ball at this time step
        for j in 0..N_PLAYERS {
            let opp = next.teams[1 - has_ball_team_idx].player_positions[j];
            let dx = ball_position[0] - opp[0];
            let dy = ball_position[1] - opp[1];
            if dx * dx + dy * dy < INTERCEPTION_DISTANCE_SQUARED {
                // there's a potential to intercept based on skill ratio
                let skill0 = m.player_stats[has_ball_team_idx][has_ball_player_idx][0];
                let skill1 = m.player_stats[1 - has_ball_team_idx][j][0];
                seed = rng(seed);
                let denom = skill0 + skill1;
                let intercepted = denom > 0 && seed % denom < skill1;

                if intercepted {
                    // ball changes owner
                    next.has_ball_team_idx = (1 - has_ball_team_idx) as u8;
                    next.has_ball_player_idx = j as u8;
                    let mut ev = MatchEvent::of("interception", state_idx as u64);
                    ev.team_idx = (1 - has_ball_team_idx) as u64;
                    ev.player_idx = j as u64;
                    ev.x = ball_position[0];
                    ev.y = ball_position[1];
                    push_event(m, ev);
                    return true;
                }

                break;
            }
        }
    }

    // the pass was completed - the target player receives the ball
    next.has_ball_player_idx = pass_target_player_idx as u8;
    false
}

fn resolve_shot(
    m: &mut MatchEntry,
    state_idx: u8,
    next: &mut GameState,
    mut seed: i64,
) {
    // The shooter is whoever holds the ball at this point - capture it
    // before an interception can flip possession.
    let shooter_team = next.has_ball_team_idx as usize;
    let shooter_player = next.has_ball_player_idx as usize;

    // goals only count when the shot is taken from the opposing half -
    // team 0 shoots towards FIELD_WIDTH, team 1 towards 0
    let mut ball_position =
        next.teams[shooter_team].player_positions[shooter_player];
    let in_range = if shooter_team == 0 {
        ball_position[0] > FIELD_WIDTH / 2
    } else {
        ball_position[0] < FIELD_WIDTH / 2
    };

    // determine the trajectory of the ball towards the center of the
    // opposing goal
    let goal_x: i64 = if shooter_team == 0 { FIELD_WIDTH } else { 0 };
    let shot_direction = [
        goal_x - ball_position[0],
        FIELD_HEIGHT / 2 - ball_position[1],
    ];

    let mut intercepted = false;
    for _ in 0..N_BALL_STEPS {
        ball_position[0] += shot_direction[0] / N_BALL_STEPS;
        ball_position[1] += shot_direction[1] / N_BALL_STEPS;

        // for each player of the opposing team determine if they can
        // intercept the shot at this time step
        for j in 0..N_PLAYERS {
            let opp = next.teams[1 - shooter_team].player_positions[j];
            let dx = ball_position[0] - opp[0];
            let dy = ball_position[1] - opp[1];
            if dx * dx + dy * dy < INTERCEPTION_DISTANCE_SQUARED {
                // there's a potential to intercept based on skill ratio
                let skill0 = m.player_stats[shooter_team][shooter_player][0];
                let skill1 = m.player_stats[1 - shooter_team][j][0];
                seed = rng(seed);
                let denom = skill0 + skill1;
                intercepted = denom > 0 && seed % denom < skill1;

                if intercepted {
                    // shot is intercepted - the defender seizes the ball
                    next.has_ball_team_idx = (1 - shooter_team) as u8;
                    next.has_ball_player_idx = j as u8;
                    let mut ev = MatchEvent::of("interception", state_idx as u64);
                    ev.team_idx = (1 - shooter_team) as u64;
                    ev.player_idx = j as u64;
                    ev.x = ball_position[0];
                    ev.y = ball_position[1];
                    push_event(m, ev);
                }

                break;
            }
        }

        if intercepted {
            break;
        }
    }

    let mut is_goal = false;
    if !intercepted && in_range {
        // based on the skill ratio of the shooter and the goalkeeper,
        // determine if the shot is a goal
        let shooter_skill = m.player_stats[shooter_team][shooter_player][0];
        let goalkeeper_skill = m.player_stats[1 - shooter_team][0][0];
        seed = rng(seed);
        let denom = shooter_skill + goalkeeper_skill;
        is_goal = denom > 0 && seed % denom < shooter_skill;
    }

    let mut ev = MatchEvent::of("shot", state_idx as u64);
    ev.team_idx = shooter_team as u64;
    ev.player_idx = shooter_player as u64;
    ev.x = next.teams[shooter_team].player_positions[shooter_player][0];
    ev.y = next.teams[shooter_team].player_positions[shooter_player][1];
    ev.goal = is_goal;
    push_event(m, ev);

    if intercepted {
        return;
    }

    if is_goal {
        next.score[shooter_team] += 1;
    }

    // regardless if there's a goal or no - ball goes to the goalkeeper
    next.has_ball_team_idx = (1 - shooter_team) as u8;
    next.has_ball_player_idx = 0;
}

// --- crypto helpers ---

// abi.encodePacked-compatible 32-byte big-endian word packing so
// commitments produced by EVM-style tooling verify identically.
fn pack_u256(v: u64, out: &mut Vec<u8>) {
    let mut b = [0u8; 32];
    b[24..].copy_from_slice(&v.to_be_bytes());
    out.extend_from_slice(&b);
}

fn pack_i256(v: i64, out: &mut Vec<u8>) {
    let mut b = if v < 0 { [0xffu8; 32] } else { [0u8; 32] };
    b[24..].copy_from_slice(&v.to_be_bytes());
    out.extend_from_slice(&b);
}

fn rng(seed: i64) -> i64 {
    let mut b = if seed < 0 { [0xffu8; 32] } else { [0u8; 32] };
    b[24..].copy_from_slice(&seed.to_be_bytes());
    i64::from_be_bytes(env::keccak256(&b)[..8].try_into().unwrap())
}

// ecrecover the 20-byte EVM address that signed `commitment` - same scheme
// as the EVM contract and back/matchmaking.js's recoverSigner.
fn recover_signer(commitment: &[u8; 32], sig: &Signature) -> [u8; 20] {
    let mut sig_bytes = [0u8; 64];
    sig_bytes[..32].copy_from_slice(&sig.r);
    sig_bytes[32..].copy_from_slice(&sig.s);
    // ethereum-style v is 27/28; the host fn wants the raw recovery id
    let v = if sig.v >= 27 { sig.v - 27 } else { sig.v };
    let pubkey = env::ecrecover(commitment, &sig_bytes, v, false)
        .unwrap_or_else(|| env::panic_str("Invalid signature"));
    let h = env::keccak256(&pubkey);
    h[12..].try_into().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;
    use secp256k1::{Message, Secp256k1, SecretKey};
    use tiny_keccak::{Hasher, Keccak};

    fn keccak(data: &[u8]) -> [u8; 32] {
        let mut h = Keccak::v256();
        h.update(data);
        let mut out = [0u8; 32];
        h.finalize(&mut out);
        out
    }

    fn pack_u(v: u64, out: &mut Vec<u8>) {
        out.extend_from_slice(&[0u8; 24]);
        out.extend_from_slice(&v.to_be_bytes());
    }
    fn pack_i(v: i64, out: &mut Vec<u8>) {
        if v < 0 {
            out.extend_from_slice(&[0xffu8; 24]);
        } else {
            out.extend_from_slice(&[0u8; 24]);
        }
        out.extend_from_slice(&v.to_be_bytes());
    }

    fn commitment(match_idx: u64, mv: &Move) -> [u8; 32] {
        let mut enc = Vec::new();
        pack_u(match_idx, &mut enc);
        if mv.state_idx == 0 {
            pack_u(mv.seed_part, &mut enc);
        } else {
            pack_u(mv.state_idx, &mut enc);
            for p in mv.delta_player_positions.iter() {
                pack_i(p[0], &mut enc);
                pack_i(p[1], &mut enc);
            }
            for c in mv.commands.iter() {
                pack_u(*c, &mut enc);
            }
            pack_u(mv.seed_part, &mut enc);
        }
        keccak(&enc)
    }

    fn sign(sk: &SecretKey, hash: [u8; 32]) -> Signature {
        let secp = Secp256k1::new();
        let msg = Message::from_digest(hash);
        let (rec_id, sig) = secp
            .sign_ecdsa_recoverable(&msg, sk)
            .serialize_compact();
        let mut r = [0u8; 32];
        let mut s = [0u8; 32];
        r.copy_from_slice(&sig[..32]);
        s.copy_from_slice(&sig[32..]);
        Signature {
            v: 27 + i32::from(rec_id) as u8,
            r,
            s,
        }
    }

    fn eth_addr(sk: &SecretKey) -> [u8; 20] {
        let secp = Secp256k1::new();
        let pk = secp256k1::PublicKey::from_secret_key(&secp, sk);
        let uncompressed = pk.serialize_uncompressed();
        let h = keccak(&uncompressed[1..]);
        h[12..].try_into().unwrap()
    }

    fn zero_move(state_idx: u64, seed: u64) -> Move {
        Move {
            state_idx,
            delta_player_positions: [[0; 2]; 11],
            commands: [0, 0],
            seed_part: seed,
        }
    }

    fn setup() -> DrakarysContract {
        let ctx = VMContextBuilder::new()
            .predecessor_account_id(accounts(0))
            .build();
        testing_env!(ctx);
        DrakarysContract::new()
    }

    fn play_round(
        c: &mut DrakarysContract,
        match_idx: u64,
        sks: &[SecretKey; 2],
        moves: [Move; 2],
    ) {
        let data = [
            commitment(match_idx, &moves[0]),
            commitment(match_idx, &moves[1]),
        ];
        let sigs = [sign(&sks[0], data[0]), sign(&sks[1], data[1])];
        c.commit(match_idx, data, sigs);
        c.reveal(match_idx, moves);
    }

    #[test]
    fn full_match_completes() {
        let mut c = setup();
        let sks = [
            SecretKey::from_slice(&[1u8; 32]).unwrap(),
            SecretKey::from_slice(&[2u8; 32]).unwrap(),
        ];
        let match_idx = 7u64;

        for round in 0..N_ROUNDS as u64 {
            let moves = [
                zero_move(round, 100 + round),
                zero_move(round, 200 + round),
            ];
            play_round(&mut c, match_idx, &sks, moves);
        }

        let view = c.get_match(match_idx).expect("match view");
        assert_eq!(view.state_idx, N_ROUNDS);
        assert!(view.ended);
        // kick-off state + one transition per round 1..=19 (same shape as
        // the EVM contract's matchState storage).
        assert_eq!(view.states.len(), N_ROUNDS as usize);
        // agents bound to the ecrecovered signers, hex-encoded
        assert_eq!(
            view.agents[0],
            format!("0x{}", hex::encode(eth_addr(&sks[0])))
        );
        // player stats were initialized - abs(10 + seed%90) in 0..=99,
        // same as the EVM/Solana contracts; and rng actually ran
        assert!(view
            .player_stats
            .iter()
            .flatten()
            .flatten()
            .all(|s| (0..=99).contains(s)));
        assert!(view
            .player_stats
            .iter()
            .flatten()
            .flatten()
            .any(|s| *s > 0));
        // events: started + 20 reveals + ended (+ shots/interceptions)
        let kinds: Vec<&str> =
            view.events.iter().map(|e| e.kind.as_str()).collect();
        assert!(kinds.contains(&"match_started"));
        assert!(kinds.contains(&"match_ended"));
        assert_eq!(
            kinds.iter().filter(|k| **k == "move_revealed").count(),
            N_ROUNDS as usize
        );
    }

    #[test]
    fn second_committer_must_sign_as_bound_agent() {
        let mut c = setup();
        let sk_a = SecretKey::from_slice(&[1u8; 32]).unwrap();
        let sk_b = SecretKey::from_slice(&[2u8; 32]).unwrap();
        let sk_evil = SecretKey::from_slice(&[9u8; 32]).unwrap();
        let match_idx = 0u64;

        let m0 = zero_move(0, 11);
        let data = [commitment(match_idx, &m0), commitment(match_idx, &m0)];
        c.commit(
            match_idx,
            data,
            [sign(&sk_a, data[0]), sign(&sk_b, data[1])],
        );

        // next round: wrong signer for slot 0 must panic
        let m1 = zero_move(1, 12);
        let data1 = [commitment(match_idx, &m1), commitment(match_idx, &m1)];
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.commit(
                match_idx,
                data1,
                [sign(&sk_evil, data1[0]), sign(&sk_b, data1[1])],
            );
        }));
        assert!(result.is_err());
    }

    #[test]
    #[should_panic(expected = "Not operator")]
    fn non_operator_cannot_commit() {
        let mut c = setup();
        let ctx = VMContextBuilder::new()
            .predecessor_account_id(accounts(1)) // not the operator
            .build();
        testing_env!(ctx);
        c.commit(
            0,
            [[0u8; 32]; 2],
            [sign(&SecretKey::from_slice(&[1u8; 32]).unwrap(), [0u8; 32]); 2],
        );
    }
}
