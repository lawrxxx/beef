"use client";

import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";

/** public cdp project id (safe in the browser). secrets stay on the server. */
export const CDP_PROJECT_ID = process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? "";
/** the sdk's built-in mock mode, for local ui work without a cdp project */
export const CDP_MOCK = process.env.NEXT_PUBLIC_CDP_MOCK === "true";
export const cdpEnabled = () => Boolean(CDP_PROJECT_ID) || CDP_MOCK;

const CONFIG = {
  projectId: CDP_PROJECT_ID || "beef-mock-project",
  useMock: CDP_MOCK,
  disableAnalytics: true,
  // every new user gets an embedded signer plus a smart account (no extension, no seed
  // phrase). spend permissions stay off: nothing can spend on a user's behalf.
  ethereum: { createOnLogin: "smart" as const, enableSpendPermissions: false },
};

const ReadyCtx = createContext(false);
/** true once the cdp sdk has loaded and its hooks can be used */
export const useCdpReady = () => useContext(ReadyCtx);

type ProviderType = ComponentType<{ config: typeof CONFIG; children: ReactNode }>;

/**
 * loads the cdp sdk only in deployments that configure it, and only in the browser,
 * so pages that never touch the wallet don't pay for it.
 */
export function CdpProvider({ children }: { children: ReactNode }) {
  const [Provider, setProvider] = useState<ProviderType | null>(null);
  useEffect(() => {
    if (!cdpEnabled()) return;
    let alive = true;
    import("@coinbase/cdp-hooks").then((m) => { if (alive) setProvider(() => m.CDPHooksProvider as unknown as ProviderType); });
    return () => { alive = false; };
  }, []);
  if (!Provider) return <ReadyCtx.Provider value={false}>{children}</ReadyCtx.Provider>;
  return (
    <Provider config={CONFIG}>
      <ReadyCtx.Provider value={true}>{children}</ReadyCtx.Provider>
    </Provider>
  );
}
