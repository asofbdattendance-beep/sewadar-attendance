// supabase/functions/save-credential/index.ts
// SECURE: Stores hashed credentials - ASO only via Authorization header
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? ""
const ANON_KEY = Deno.env.get("ANON_KEY") ?? ""
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://sewadar-attendance.netlify.app"

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function unauthorized(msg: string) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
}

function forbidden(msg: string) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
}

function badRequest(msg: string) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
}

function serverError(msg: string) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
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

  const origin = req.headers.get("origin") || ""
  if (origin !== ALLOWED_ORIGIN) {
    return forbidden("Unauthorized origin")
  }

  const providedKey = req.headers.get("apikey") || ""
  if (ANON_KEY && providedKey !== ANON_KEY) {
    return unauthorized("Invalid API key")
  }

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return unauthorized("Missing authorization token")
  }

  try {
    const token = authHeader.slice(7)
    
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    
    const { data: { user }, error: userError } = await userClient.auth.getUser(token)
    if (userError || !user) {
      return unauthorized("Invalid or expired token")
    }
    
    const { data: profile } = await userClient
      .from("users")
      .select("role, is_active")
      .eq("auth_id", user.id)
      .single()
    
    if (!profile || profile.role !== "aso" || !profile.is_active) {
      return forbidden("Only active ASO users can save credentials")
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = await req.json()
    const { name, badge_number, email, password, role, centre, created_by } = body

    if (!name || !badge_number || !email || !password || !role || !centre) {
      return badRequest("All fields are required")
    }

    if (password.length < 6) {
      return badRequest("Password must be at least 6 characters")
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
        return badRequest("Credentials already exist for this badge number")
      }
      throw insertError
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Credential stored securely"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (err) {
    console.error("Save credential error:", err)
    return serverError("Internal server error")
  }
})
