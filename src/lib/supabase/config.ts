export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * supabase mode is opt-in: it needs the keys *and* NEXT_PUBLIC_BACKEND=supabase.
 * adding a supabase integration in vercel alone keeps the app in demo mode.
 */
export const BACKEND_FLAG = process.env.NEXT_PUBLIC_BACKEND === "supabase";
export const isSupabaseConfigured = () => Boolean(BACKEND_FLAG && SUPABASE_URL && SUPABASE_ANON_KEY);
