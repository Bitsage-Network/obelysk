/**
 * STWO GPU Prover Module
 *
 * Provides client-side integration with BitSage STWO prover nodes.
 */

export {
  STWOProverService,
  getSTWOProver,
  useSTWOProver,
  PROVER_ENDPOINTS,
  STWO_PROGRAM_HASHES,
} from "./stwoProver";

export type {
  ProofType,
  ProverConfig,
  ProofResult,
  ProofProgress,
  RangeProofInput,
  BalanceProofInput,
  TransferProofInput,
  UseSTWOProverResult,
} from "./stwoProver";
