import { getAddress, isAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { entryPoint06Address, entryPoint07Address } from "viem/account-abstraction";

// beef's onchain layer runs on base sepolia only. there is no mainnet chain object
// anywhere in the app, and every transaction path asserts this chain id.

export const CHAIN = baseSepolia;
export const CHAIN_ID = 84532 as const;
export const CHAIN_ID_HEX = "0x14a34" as const;
/** cdp network identifier for user operations */
export const CDP_NETWORK = "base-sepolia" as const;
export const NETWORK_NAME = "base sepolia";
export const RPC_URL = "https://sepolia.base.org";
/** base sepolia block explorer */
export const EXPLORER = "https://sepolia-explorer.base.org";
export const FAUCET_URL = "https://faucet.circle.com/";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;

/** circle test usdc on base sepolia (same address the cdp sdk uses for "base-sepolia") */
export const USDC_ADDRESS = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
export const USDC_DECIMALS = 6;

/** erc-4337 entrypoints. coinbase smart wallets (cdp smart accounts) use v0.6. */
export const ENTRYPOINTS = [getAddress(entryPoint06Address), getAddress(entryPoint07Address)] as const;

const rawEscrow = process.env.NEXT_PUBLIC_ESCROW_ADDRESS ?? "";
/** deployed BeefEscrow on base sepolia, or null until one is deployed and configured */
export const ESCROW_ADDRESS: `0x${string}` | null = isAddress(rawEscrow) ? getAddress(rawEscrow) : null;

/**
 * escrows deployed earlier that may still hold stakes for older duels (settle/refund
 * only). new duels always open on ESCROW_ADDRESS. 0xAe3a… had a fixed 25 usdc cap.
 */
export const PREVIOUS_ESCROWS: readonly `0x${string}`[] = [getAddress("0xae3a647029a7a3fedf10f12dc7bbd098a5bf9f88")];
/** every escrow beef recognises: the current one first */
export const KNOWN_ESCROWS: readonly `0x${string}`[] = [...(ESCROW_ADDRESS ? [ESCROW_ADDRESS] : []), ...PREVIOUS_ESCROWS.filter((a) => a !== ESCROW_ADDRESS)];
export const isKnownEscrow = (a: string) => isAddress(a) && KNOWN_ESCROWS.includes(getAddress(a));

/** hard off. there is no code path that moves real money. */
export const REAL_MONEY_ENABLED = false as const;

export class WrongChainError extends Error {
  constructor(got: number | string) {
    super(`beef only works on base sepolia (chain ${CHAIN_ID}). refusing chain ${got}.`);
  }
}

export function assertBaseSepolia(chainId: number | string | bigint) {
  const n = typeof chainId === "string" ? Number.parseInt(chainId, chainId.startsWith("0x") ? 16 : 10) : Number(chainId);
  if (n !== CHAIN_ID) throw new WrongChainError(String(chainId));
}

export const shortAddress = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
