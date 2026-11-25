// deploys contracts/BeefEscrow.sol to BASE SEPOLIA ONLY.
// usage:
//   npm run contracts:build
//   DEPLOYER_PRIVATE_KEY=0x... SETTLEMENT_ORACLE_ADDRESS=0x... node scripts/deploy-escrow.mjs
// the deployer needs a little base sepolia eth for gas (deployment isn't sponsored).
// keys are read from the environment and never written anywhere.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // circle test usdc on base sepolia
const pk = process.env.DEPLOYER_PRIVATE_KEY;
const oracle = process.env.SETTLEMENT_ORACLE_ADDRESS;
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("set DEPLOYER_PRIVATE_KEY (0x + 64 hex)");
if (!oracle || !isAddress(oracle)) throw new Error("set SETTLEMENT_ORACLE_ADDRESS (the address of SETTLEMENT_ORACLE_PRIVATE_KEY)");

const transport = http(process.env.BASE_SEPOLIA_RPC_URL || undefined);
const pub = createPublicClient({ chain: baseSepolia, transport });
const chainId = await pub.getChainId();
if (chainId !== 84532) throw new Error(`refusing to deploy: rpc is chain ${chainId}, not base sepolia (84532)`);

const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
const { abi, bytecode } = JSON.parse(readFileSync("contracts/out/BeefEscrow.json", "utf8"));
console.log(`deploying BeefEscrow to base sepolia from ${account.address}, oracle ${getAddress(oracle)}`);
const hash = await wallet.deployContract({ abi, bytecode, args: [USDC, getAddress(oracle)] });
const r = await pub.waitForTransactionReceipt({ hash });
if (r.status !== "success" || !r.contractAddress) throw new Error("deployment failed");
console.log(`\nBeefEscrow: ${r.contractAddress}\nhttps://sepolia.basescan.org/address/${r.contractAddress}\n\nset NEXT_PUBLIC_ESCROW_ADDRESS=${r.contractAddress} in vercel, then allowlist it in the cdp paymaster policy.`);
