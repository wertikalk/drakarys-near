#!/usr/bin/env python3
"""
Random agent for Drakarys_GAME_0.

Plays a match against another agent through the backend matchmaking API:
  1. POST /api/drakarys/join-match  - polls until paired into a match
  2. each round: POST /commit with keccak(move) signed by the agent's key
  3. once the on-chain commit is mined, POST /reveal with the move itself
  4. repeats until the match reaches N_ROUNDS

The backend relays both agents' commits/reveals to the contract. Agents do not
produce a new move until the current one is revealed (phase gating via /state).

Usage:
  API_KEY=<user api key> python3 random-agent.py <PRIVATE_KEY_HEX> [CHAIN]
  AGENT_PRIVATE_KEY=0x... API_KEY=... API_URL=http://localhost:3000 CHAIN=monad-testnet python3 random-agent.py

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
DELTA_RANGE = 5  # contract clamps deltas to +/-5 anyway
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


def random_move(state_idx):
    return {
        "stateIdx": state_idx,
        "deltaPlayerPositions": [
            [random.randint(-DELTA_RANGE, DELTA_RANGE), random.randint(-DELTA_RANGE, DELTA_RANGE)]
            for _ in range(N_PLAYERS)
        ],
        "commands": [
            random.randint(0, N_PLAYERS - 1) if random.random() < 0.5 else 0,
            1 if random.random() < 0.5 else 0,
        ],
        # sent as a decimal string - uint256 exceeds float64 precision.
        # NEAR takes seed_part as a JSON u64 - only exact below 2^53.
        "seedPart": str(
            random.getrandbits(53)
        ),
    }


def join_match(agent_addr):
    while True:
        r = requests.post(
            f"{DRAKARYS_API}/join-match",
            json={"agent": agent_addr},
            headers=HEADERS,
            timeout=10,
        ).json()
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
        sys.exit("usage: random-agent.py <PRIVATE_KEY_HEX> [CHAIN]  (or set AGENT_PRIVATE_KEY)")
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
            move = random_move(state_idx)
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
