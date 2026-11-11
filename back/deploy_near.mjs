// Deploy the NEAR Drakarys contract (sc-near) to testnet.
//
// Creates a funded dev account via the public testnet helper
// (the same service `cargo near create-dev-account` uses), deploys
// target/wasm32-unknown-unknown/release/drakarys_near.wasm, calls new(),
// then writes the account + its private key to back/.env.near-local so the
// relay (and chains.json's NEAR_OPERATOR_ACCOUNT env) can pick it up.
//
//   node deploy_near.mjs
//
// Requires a prior `cargo build --target wasm32-unknown-unknown --release`
// in sc-near/.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  Account,
  JsonRpcProvider,
  KeyPair,
  KeyPairSigner,
} from "near-api-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM = path.join(
  HERE,
  "../sc-near/target/wasm32-unknown-unknown/release/drakarys_near.wasm",
);
const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const HELPER = process.env.NEAR_HELPER ?? "https://helper.testnet.near.org";

if (!existsSync(WASM)) {
  console.error(`wasm not found at ${WASM} - build sc-near first:`);
  console.error("  cd sc-near && cargo build --target wasm32-unknown-unknown --release");
  process.exit(1);
}

// A short, valid testnet account name: dev-<ts>-<rand>.testnet
const rand = Math.random().toString(36).slice(2, 8);
const accountId = `dev-${Date.now()}-${rand}.testnet`;

const keyPair = KeyPair.fromRandom("ed25519");
const publicKey = keyPair.getPublicKey().toString();

console.log(`creating ${accountId} via ${HELPER} ...`);
const res = await fetch(`${HELPER}/account`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    newAccountId: accountId,
    newAccountPublicKey: publicKey,
  }),
});
if (!res.ok) {
  console.error(`account creation failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`account created: ${accountId}`);

const provider = new JsonRpcProvider({ url: RPC });
const signer = new KeyPairSigner(keyPair);
const account = new Account(accountId, provider, signer);

const wasm = readFileSync(WASM);
console.log(`deploying ${wasm.length} bytes of wasm ...`);
await account.deployContract(wasm);

console.log("initializing (new) ...");
await account.callFunction({
  contractId: accountId,
  methodName: "new",
  args: {},
});

const secretKey = keyPair.toString();
const envFile = path.join(HERE, ".env.near");
writeFileSync(
  envFile,
  [
    `NEAR_CONTRACT_ACCOUNT=${accountId}`,
    `NEAR_OPERATOR_ACCOUNT=${secretKey}`,
    "",
  ].join("\n"),
);
console.log(`\nDONE - contract live at ${accountId}`);
console.log(`credentials written to ${envFile}`);
console.log(`\nset in chains.json:  "contractAddress": "${accountId}"`);
console.log(`verify: ${RPC.replace("rpc", "rpc")} query -> get_match_count {}`);
