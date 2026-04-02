"use client";

import { getSupabaseClient } from "@/lib/supabase/browser";

export function createClient() {
  return getSupabaseClient();
}
