import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// 請填入 Supabase Project URL 與 Publishable key。
// 不可在前端放入 Secret key / service_role key。
export const SUPABASE_URL = "https://kszlquodnkzrggizkshk.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NZpiJlhF22Cc71hMwTqd4g_MWDKA4sR";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export function isConfigured() {
  return !SUPABASE_URL.includes("YOUR_") && !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_");
}
