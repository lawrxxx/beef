import { http, createConfig, injected } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";

export const CHAIN = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;

/** usdc contract addresses (circle-issued native usdc) */
export const USDC: Record<number, `0x${string}`> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "") as `0x${string}` | "";

/**
 * real-money staking stays off until legal, custody, asset-permission and oracle
 * reviews are complete. this flag alone is not sufficient – the escrow service also
 * refuses to run without a deployed, configured escrow contract.
 */
export const REAL_MONEY_ENABLED = process.env.NEXT_PUBLIC_REAL_MONEY_ENABLED === "true" && !!ESCROW_ADDRESS;

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  // eip-6963 discovery surfaces every installed wallet (coinbase wallet, metamask, rabby…).
  // the wagmi/connectors barrel is avoided on purpose: it bundles optional sdks.
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  transports: { [base.id]: http(), [baseSepolia.id]: http() },
  ssr: true,
});
