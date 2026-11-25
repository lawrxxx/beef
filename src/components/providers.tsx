"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/chain/config";
import { ToastProvider } from "@/components/ui";
import { loadPersisted, setState, tickDuels } from "@/lib/store/store";
import { getBrowserSupabase } from "@/lib/supabase/client";

function Boot() {
  useEffect(() => {
    loadPersisted();
    tickDuels();
    const id = setInterval(tickDuels, 30_000);

    // service worker (production only, so dev hot reload isn't cached)
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // supabase auth bridge: real auth when credentials are configured
    const sb = getBrowserSupabase();
    const sub = sb?.auth.onAuthStateChange((_e, session) => {
      setState((s) => ({
        ...s,
        session: { ...s.session, mode: "supabase", email: session?.user.email ?? undefined, userId: session ? s.session.userId ?? "u_me" : null },
      }));
    });
    return () => { clearInterval(id); sub?.data.subscription.unsubscribe(); };
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
