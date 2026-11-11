// Move encoding shared by the matchmaking relay and the DQN bot.
import { ethers } from "ethers";

export const FIELD_W = 1024;
export const FIELD_H = 512;
export const N_PLAYERS = 11;
export const N_TEAMS = 2;
export const N_ROUNDS = 20;
export const DELTA_X_RANGE = 5;
export const DELTA_Y_RANGE = 5;

// keccak256(abi.encodePacked(...)) of the move, matching the contract.
export function moveCommitment(matchIdx, move) {
  if (Number(move.stateIdx) === 0) {
    return ethers.solidityPackedKeccak256(
      ["uint256", "uint256"],
      [matchIdx, move.seedPart],
    );
  }
  return ethers.solidityPackedKeccak256(
    ["uint256", "uint256", "int256[2][11]", "uint256[2]", "uint256"],
    [
      matchIdx,
      move.stateIdx,
      move.deltaPlayerPositions,
      move.commands,
      move.seedPart,
    ],
  );
}

// Fresh 128-bit seed contribution as a decimal string (same shape agents POST).
export function randomSeedPart() {
  return BigInt(ethers.hexlify(ethers.randomBytes(16))).toString();
}
