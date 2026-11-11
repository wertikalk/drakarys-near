#!/usr/bin/env python3
"""
Fixed-strategy agent for Drakarys_GAME_0.

Same commit/reveal protocol as random-agent.py, but the move is derived
deterministically from the latest on-chain state:

  attack: every non-keeper pushes toward the opponent's goal (the ball holder
          dribbles forward too), drifting toward the centre of the pitch
  shoot:  only when the holder is already in the opposing half - anything else
          is a guaranteed turnover to their keeper
  pass:   otherwise play it forward to the most advanced teammate
  defend: when the opponent has the ball, everyone presses toward the holder -
          interception odds scale with how close our nearest defender is to the
          pass lane midpoint

Note commands[0] is a pass TARGET, not a flag: 0 means "pass to the keeper",
so 'no pass' is expressed by targeting the holder himself.

Usage:
  API_KEY=<user api key> python3 fixed-strategy-agent.py <PRIVATE_KEY_HEX> [CHAIN]
  AGENT_PRIVATE_KEY=0x... API_KEY=... API_URL=http://localhost:3000 CHAIN=monad-testnet python3 fixed-strategy-agent.py

CHAIN picks a backend chain (see /api/chains); unset = server default.
The playing endpoints require a per-user API key (from /api/auth/me after
X login): pass it via API_KEY or requests will get 401.
Deps: pip install eth-account requests
"""

import os
import random
import sys
import time

import requests
from eth_account import Account
from eth_utils import keccak

API_URL = os.environ.get("API_URL", "http://localhost:3000")
HEADERS = {"x-api-key": os.environ.get("API_KEY", "")}
CHAIN = None  # set from argv[2] or CHAIN env below
DRAKARYS_API = None  # resolved in main()
N_PLAYERS = 11
N_ROUNDS = 20
FIELD_W, FIELD_H = 1024, 512
DELTA_RANGE = 5
POLL_SECONDS = 1.0


def pack_u(value):
    return int(value).to_bytes(32, "big")


def pack_i(value):
    return (int(value) % (1 << 256)).to_bytes(32, "big")


def move_commitment(match_idx, move):
    """keccak256(abi.encodePacked(...)) exactly as the contract computes it."""
    if move["stateIdx"] == 0:
        # init round commits the seed only
        return keccak(pack_u(match_idx) + pack_u(move["seedPart"]))
    data = pack_u(match_idx) + pack_u(move["stateIdx"])
    for delta in move["deltaPlayerPositions"]:
        data += pack_i(delta[0]) + pack_i(delta[1])
    data += pack_u(move["commands"][0]) + pack_u(move["commands"][1])
    data += pack_u(move["seedPart"])
    return keccak(data)


def sign_digest(private_key, digest):
    """Raw-digest signature - the contract ecrecovers without EIP-191 prefix."""
    signed = Account.unsafe_sign_hash(digest, private_key=private_key)
    return signed.v, "0x%064x" % signed.r, "0x%064x" % signed.s


def clamp_delta(v):
    return max(-DELTA_RANGE, min(DELTA_RANGE, v))


def sign(v):
    return (v > 0) - (v < 0)


def plan_move(state_idx, state, my_team):
    """Deterministic move for round `state_idx` given the previous state."""
    attack_dir = 1 if my_team == 0 else -1
    goal_x = FIELD_W if my_team == 0 else 0
    my_players = state["teams"][my_team]["playerPositions"]
    holder_team = state["hasBallTeamIdx"]
    holder_idx = state["hasBallPlayerIdx"]
    have_ball = holder_team == my_team

    if have_ball:
        hx, hy = my_players[holder_idx]
        in_opposing_half = hx > FIELD_W / 2 if my_team == 0 else hx < FIELD_W / 2

        if in_opposing_half:
            pass_target, shoot = holder_idx, 1
        else:
            # furthest teammate toward the opponent goal - never the holder or
            # the pinned keeper, who can't carry the ball anywhere
            progress = [
                (attack_dir * (x - hx), j)
                for j, (x, y) in enumerate(my_players)
                if j != holder_idx and j != 0
            ]
            pass_target, shoot = max(progress)[1], 0
    else:
        pass_target, shoot = 0, 0  # commands are ignored without the ball

    deltas = []
    for j, (x, y) in enumerate(my_players):
        if j == 0:
            deltas.append([0, 0])  # keepers are pinned by the contract anyway
            continue
        if have_ball:
            # surge toward the goal, drifting toward the centre line
            deltas.append([DELTA_RANGE * attack_dir, clamp_delta(sign(FIELD_H / 2 - y))])
        else:
            # press: run at the ball holder to sit in the pass lanes
            bx, by = state["teams"][holder_team]["playerPositions"][holder_idx]
            deltas.append([clamp_delta(sign(bx - x) * DELTA_RANGE), clamp_delta(sign(by - y) * DELTA_RANGE)])

    return {
        "stateIdx": state_idx,
        "deltaPlayerPositions": deltas,
        "commands": [pass_target, shoot],
        # sent as a decimal string - uint256 exceeds float64 precision.
        # Solana only stores a u64 seed_part - cap it when CHAIN is solana-*.
        "seedPart": str(
            random.getrandbits(64 if CHAIN and CHAIN.startswith("solana") else 128)
        ),
    }


def neutral_move(state_idx):
    return {
        "stateIdx": state_idx,
        "deltaPlayerPositions": [[0, 0]] * N_PLAYERS,
        "commands": [0, 0],
        "seedPart": str(
            random.getrandbits(64 if CHAIN and CHAIN.startswith("solana") else 128)
        ),
    }


def join_match(agent_addr):
    while True:
        try:
            r = requests.post(
                f"{DRAKARYS_API}/join-match",
                json={"agent": agent_addr},
                headers=HEADERS,
                timeout=10,
            ).json()
        except requests.RequestException:
            time.sleep(3)
            continue
        if r.get("status") == "matched":
            return r
        print(f"[agent] waiting for opponent... ({r})", flush=True)
        time.sleep(2)


def get_state(match_idx):
    return requests.get(
        f"{DRAKARYS_API}/state/{match_idx}", headers=HEADERS, timeout=10
    ).json()


def main():
    global CHAIN, DRAKARYS_API
    key = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("AGENT_PRIVATE_KEY")
    if not key:
        sys.exit("usage: fixed-strategy-agent.py <PRIVATE_KEY_HEX> [CHAIN]  (or set AGENT_PRIVATE_KEY)")
    CHAIN = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("CHAIN")
    DRAKARYS_API = (
        f"{API_URL}/api/chains/{CHAIN}/drakarys" if CHAIN else f"{API_URL}/api/drakarys"
    )
    account = Account.from_key(key)
    print(f"[agent] {account.address} joining matchmaking at {DRAKARYS_API}", flush=True)

    match = join_match(account.address)
    match_idx, slot = match["matchIdx"], match["slot"]
    print(f"[agent] matched: match {match_idx}, slot {slot}", flush=True)

    pending = {}   # stateIdx -> move committed but not yet revealed
    revealed = set()

    while True:
        try:
            st = get_state(match_idx)
        except requests.RequestException as e:
            print(f"[agent] backend unreachable ({e.__class__.__name__}), retrying", flush=True)
            time.sleep(3)
            continue
        if "error" in st:
            print(f"[agent] match lost ({st['error']}) - rejoining", flush=True)
            match = join_match(account.address)
            match_idx, slot = match["matchIdx"], match["slot"]
            pending.clear()
            revealed.clear()
            continue
        if st.get("ended"):
            break
        state_idx, phase = st.get("stateIdx"), st.get("phase")

        if phase == "commit" and state_idx not in pending:
            if state_idx == 0:
                move = neutral_move(0)  # init round only commits the seed
            else:
                latest = (st.get("indexed") or {}).get("latest")
                seen = ((st.get("indexed") or {}).get("metadata") or {}).get("stateIdx")
                if latest is None or seen is None or seen < state_idx:
                    continue  # indexer hasn't caught up to the last reveal yet
                move = plan_move(state_idx, latest, slot)
            digest = move_commitment(match_idx, move)
            v, r, s = sign_digest(account.key, digest)
            resp = requests.post(
                f"{DRAKARYS_API}/commit",
                headers=HEADERS,
                json={
                    "matchIdx": match_idx,
                    "agent": account.address,
                    "commitment": "0x" + digest.hex(),
                    "v": v,
                    "r": r,
                    "s": s,
                },
                timeout=10,
            )
            if resp.ok:
                pending[state_idx] = move
                print(f"[agent] committed move for state {state_idx}", flush=True)
            else:
                print(f"[agent] commit rejected: {resp.text}", flush=True)

        elif phase == "reveal" and state_idx in pending and state_idx not in revealed:
            resp = requests.post(
                f"{DRAKARYS_API}/reveal",
                headers=HEADERS,
                json={
                    "matchIdx": match_idx,
                    "agent": account.address,
                    "move": pending[state_idx],
                },
                timeout=10,
            )
            if resp.ok:
                revealed.add(state_idx)
                del pending[state_idx]
                print(f"[agent] revealed move for state {state_idx}", flush=True)
            else:
                print(f"[agent] reveal rejected: {resp.text}", flush=True)

        time.sleep(POLL_SECONDS)

    print(f"[agent] match {match_idx} finished", flush=True)


if __name__ == "__main__":
    main()
