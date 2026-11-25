import "server-only";
import { InMemorySettlementRepository } from "@/lib/settlement/service";

// demo mode keeps settlements in server memory so repeat calls return the stored
// result (idempotent per server instance). supabase mode uses the database instead.
const g = globalThis as unknown as { __beefRepo?: InMemorySettlementRepository };
export const demoRepo = g.__beefRepo ?? (g.__beefRepo = new InMemorySettlementRepository());
