"use client";

import { useEffect, type ReactNode } from "react";
import { CdpProvider } from "@/components/wallet/cdp-provider";
import { ToastProvider } from "@/components/ui";
import { loadPersisted, tickDuels } from "@/lib/store/store";

function Boot() {
  useEffect(() => {
    loadPersisted();
    // referral links: /?ref=username (or any page). remembered until sign-up; not a secret.
    try {
      const ref = new URL(window.location.href).searchParams.get("ref");
      if (ref && /^[a-z0-9._]{3,20}$/.test(ref)) localStorage.setItem("beef:ref", ref);
    } catch { /* storage unavailable */ }
    tickDuels();
    const id = setInterval(tickDuels, 30_000);

    // service worker (production only, so dev hot reload isn't cached)
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // in supabase mode loadPersisted() connects to the database and listens for auth
    // and realtime changes (see lib/store/store.ts)
    return () => { clearInterval(id); };
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CdpProvider>
      <ToastProvider>
        <Boot />
        {children}
      </ToastProvider>
    </CdpProvider>
  );
}
