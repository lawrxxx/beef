import "server-only";
import { z } from "zod";
import { getAsset } from "@/lib/market/assets";

const ticker = z.string().min(1).max(6).transform((s) => s.toUpperCase()).refine((s) => !!getAsset(s), "unsupported ticker");

export const settleableDuelSchema = z.object({
  id: z.string().min(1).max(64),
  status: z.string().max(32),
  participants: z.array(z.object({ userId: z.string().min(1).max(64), ticker })).min(2).max(8)
    .refine((ps) => new Set(ps.map((p) => p.ticker)).size === ps.length, "each participant needs a different stock"),
  acceptedAt: z.string().datetime(),
  deadline: z.string().datetime(),
});

export const lockOrSettleBody = z.object({
  duel: settleableDuelSchema.optional(),
  duelId: z.string().max(64).optional(),
  simulateAt: z.string().datetime().optional(),
});
