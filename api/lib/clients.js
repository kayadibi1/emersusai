import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);