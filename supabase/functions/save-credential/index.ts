// supabase/functions/save-credential/index.ts
// SECURE: Stores hashed credentials - ASO only via Authorization header
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? ""

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + "sewadar-salt-2024")
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const token = authHeader.slice(7)
    const parts = token.split('.')
    if (parts.length !== 3) {
      return new Response(JSON.stringify({ error: "Invalid token format" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    const userId = payload.sub

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: profile } = await adminClient
      .from("users")
      .select("role, is_active")
      .eq("auth_id", userId)
      .single()

    if (!profile || profile.role !== "aso" || !profile.is_active) {
      return new Response(JSON.stringify({ error: "Only active ASO users can save credentials" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = await req.json()
    const { name, badge_number, email, password, role, centre, created_by } = body

    if (!name || !badge_number || !email || !password || !role || !centre) {
      return new Response(JSON.stringify({ error: "All fields are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const hashedPassword = await hashPassword(password)

    const { error: insertError } = await adminClient.from("user_credentials").insert({
      name: name.trim(),
      badge_number: badge_number.toUpperCase().trim(),
      email: email.toLowerCase().trim(),
      password_hash: hashedPassword,
      role,
      centre,
      created_by: created_by || null,
      created_at: new Date().toISOString(),
    })

    if (insertError) {
      if (insertError.message.includes("duplicate")) {
        return new Response(JSON.stringify({ error: "Credentials already exist for this badge number" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      throw insertError
    }

    return new Response(
      JSON.stringify({ success: true, message: "Credential stored securely" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (err) {
    console.error("Save credential error:", err)
    return new Response(JSON.stringify({ error: "Internal server error: " + err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
