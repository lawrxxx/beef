// deploys contracts/BeefEscrow.sol to BASE SEPOLIA ONLY.
// usage:
//   npm run contracts:build
//   DEPLOYER_PRIVATE_KEY=0x... SETTLEMENT_ORACLE_ADDRESS=0x... node scripts/deploy-escrow.mjs
// stake limits (test usdc, per participant) default to 1 and 1000. they're immutable once
// deployed and must match NEXT_PUBLIC_STAKE_MIN_USDC / NEXT_PUBLIC_STAKE_MAX_USDC and the
// database's duels_stake_check:
//   STAKE_MIN_USDC=1 STAKE_MAX_USDC=1000
// the deployer needs a little base sepolia eth for gas (deployment isn't sponsored).
// keys are read from the environment and never written anywhere.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // circle test usdc on base sepolia
const pk = process.env.DEPLOYER_PRIVATE_KEY;
const oracle = process.env.SETTLEMENT_ORACLE_ADDRESS;
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("set DEPLOYER_PRIVATE_KEY (0x + 64 hex)");
if (!oracle || !isAddress(oracle)) throw new Error("set SETTLEMENT_ORACLE_ADDRESS (the address of SETTLEMENT_ORACLE_PRIVATE_KEY)");

const min = parseUnits(process.env.STAKE_MIN_USDC || "1", 6);
const max = parseUnits(process.env.STAKE_MAX_USDC || "1000", 6);
if (min <= 0n || max < min) throw new Error("STAKE_MIN_USDC must be > 0 and ≤ STAKE_MAX_USDC");

const transport = http(process.env.BASE_SEPOLIA_RPC_URL || undefined);
const pub = createPublicClient({ chain: baseSepolia, transport });
const chainId = await pub.getChainId();
if (chainId !== 84532) throw new Error(`refusing to deploy: rpc is chain ${chainId}, not base sepolia (84532)`);

const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
const { abi, bytecode } = JSON.parse(readFileSync("contracts/out/BeefEscrow.json", "utf8"));
console.log(`deploying BeefEscrow to base sepolia from ${account.address}, oracle ${getAddress(oracle)}, stakes ${process.env.STAKE_MIN_USDC || "1"}–${process.env.STAKE_MAX_USDC || "1000"} test usdc`);
const hash = await wallet.deployContract({ abi, bytecode, args: [USDC, getAddress(oracle), min, max] });
const r = await pub.waitForTransactionReceipt({ hash });
if (r.status !== "success" || !r.contractAddress) throw new Error("deployment failed");
console.log(`\nBeefEscrow: ${r.contractAddress}\nhttps://sepolia-explorer.base.org/address/${r.contractAddress}\n\nset NEXT_PUBLIC_ESCROW_ADDRESS=${r.contractAddress} in vercel, then allowlist it in the cdp paymaster policy.`);
