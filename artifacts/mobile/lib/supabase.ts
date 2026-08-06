import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Client Supabase par défaut (clé anon — pour les lectures publiques et les uploads). */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Crée un client Supabase avec un JWT Firebase injecté dans le header Authorization.
 * Permet à Supabase RLS de valider les règles basées sur l'identité Firebase.
 *
 * Usage :
 *   const client = createSupabaseWithToken(await firebaseUser.getIdToken());
 *   await client.from("profiles").upsert({ ... });
 */
export function createSupabaseWithToken(firebaseIdToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${firebaseIdToken}` },
    },
  });
}
