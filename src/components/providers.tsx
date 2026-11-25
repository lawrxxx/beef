"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/chain/config";
import { ToastProvider } from "@/components/ui";
import { loadPersisted, tickDuels } from "@/lib/store/store";

function Boot() {
  useEffect(() => {
    loadPersisted();
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
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <Boot />
          {children}
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
