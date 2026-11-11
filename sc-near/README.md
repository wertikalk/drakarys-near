# Drakarys on NEAR (`sc-near`)

NEAR port of `sc/src/Drakarys_GAME_0.sol` — same commit/reveal protocol,
same transition logic, and the same `abi.encodePacked` + keccak move
commitments, so EVM agents can play on NEAR unchanged. Agent identities are
bound on-chain via the `ecrecover` host function (identical trust model to
the EVM contract).

Indexing extras vs the EVM/Solana deployments:

- the full state history is stored on-chain (bounded by `N_ROUNDS + 1`)
- every game event (commit, reveal, interception, shot, start, end) is
  appended to a per-match log and emitted as `EVENT_JSON` lines

`back/nearIndexer.js` only needs `get_match_ids` + `get_match` view calls —
no log scanning or state reconstruction.

## Build & test

```sh
cargo test                                            # unit tests (mocked VM, real ecrecover)
cargo build --target wasm32-unknown-unknown --release # contract wasm
```

## Deploy to testnet

`back/deploy_near.mjs` creates a funded `dev-*.testnet` account via the
testnet helper, deploys the wasm, and calls `new()` (which binds the
operator to the deployer account, mirroring the EVM constructor):

```sh
cd ../back && npm i && node deploy_near.mjs
# -> prints the account id, writes back/.env.near (NEAR_OPERATOR_ACCOUNT)
```

Update `back/chains.json` `near-testnet.contractAddress` with the printed
account id.

## Playing a match

`commit(match_idx, data, signatures)` and `reveal(match_idx, moves)` are
operator-only JSON method calls — the relay signs them with the operator
NEAR account (like the EVM `onlyOperator` relay). See
`back/test_near_chain.mjs` for a complete two-agent match played on
testnet end-to-end. Note: `seed_part`/`commands`/`match_idx` are u64 in the
JSON args — keep them below 2^53 (JSON integer precision), unlike EVM's
u256.

## Views

| Method | Returns |
|---|---|
| `get_match_ids(offset, limit)` | `u64[]` — all match ids, creation order |
| `get_match_count()` | `u64` |
| `get_match(match_idx)` | `MatchView` — agents (0x-hex), player_stats, current + full `states[]`, `events[]`, `ended` |
