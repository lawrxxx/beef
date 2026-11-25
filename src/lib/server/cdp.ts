import "server-only";
import { getAddress, isAddress, type Address } from "viem";

// server-side verification of cdp embedded-wallet users. the browser sends its cdp
// access token; cdp tells us who the user is and which accounts they own. addresses
// supplied by the browser are never trusted.

export interface VerifiedEndUser {
  cdpUserId: string;
  eoa: Address | null;
  smartAccount: Address | null;
  authMethods: string[];
  /** emails cdp verified for this user (email otp or oauth) */
  emails: string[];
  /** `sub` claims from custom-auth (supabase jwt) logins */
  jwtSubs: string[];
}

export type EndUserVerifier = (accessToken: string) => Promise<VerifiedEndUser>;

export class CdpNotConfiguredError extends Error {
  constructor() { super("wallet verification isn't configured on the server (CDP_API_KEY_ID / CDP_API_KEY_SECRET)"); }
}

export const cdpServerConfigured = () => Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);

let client: any = null;
async function getCdp() {
  if (!cdpServerConfigured()) throw new CdpNotConfiguredError();
  if (!client) {
    const { CdpClient } = await import("@coinbase/cdp-sdk");
    // only the api key is needed to validate end-user tokens. no wallet secret: the
    // server never signs for users.
    client = new CdpClient({ apiKeyId: process.env.CDP_API_KEY_ID, apiKeySecret: process.env.CDP_API_KEY_SECRET });
  }
  return client;
}

const addr = (a: unknown): Address | null => (typeof a === "string" && isAddress(a) ? getAddress(a) : null);

/** maps cdp's end-user object to what beef needs (exported for tests) */
export function mapEndUser(eu: any): VerifiedEndUser {
  const methods = eu?.authenticationMethods;
  const list: any[] = Array.isArray(methods) ? methods : methods ? Object.values(methods) : [];
  const authMethods = list.map((m) => m?.type).filter(Boolean);
  const emails = list.map((m) => (typeof m?.email === "string" ? m.email.toLowerCase() : null)).filter(Boolean) as string[];
  const jwtSubs = list.filter((m) => m?.type === "jwt" && typeof m.sub === "string").map((m) => m.sub as string);
  return {
    cdpUserId: String(eu.userId),
    eoa: addr(eu.evmAccountObjects?.[0]?.address ?? eu.evmAccounts?.[0]),
    smartAccount: addr(eu.evmSmartAccountObjects?.[0]?.address ?? eu.evmSmartAccounts?.[0]),
    authMethods,
    emails,
    jwtSubs,
  };
}

export const verifyWithCdp: EndUserVerifier = async (accessToken) => {
  if (!accessToken || accessToken.length > 8192) throw new Error("missing wallet session");
  const cdp = await getCdp();
  try {
    return mapEndUser(await cdp.endUser.validateAccessToken({ accessToken }));
  } catch {
    throw new Error("your wallet session couldn't be verified. sign in to your wallet again.");
  }
};
