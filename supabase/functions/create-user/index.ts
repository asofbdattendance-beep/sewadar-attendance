// supabase/functions/create-user/index.ts
// SECURE: Creates new user accounts - ASO only via Authorization header
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? ""
const ANON_KEY = Deno.env.get("ANON_KEY") ?? ""
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sewadar-attendance.netlify.app").split(",").map(s => s.trim())

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const origin = req.headers.get("origin") || ""
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return forbidden("Unauthorized origin: " + origin)
  }

  const providedKey = req.headers.get("apikey") || ""
  if (ANON_KEY && providedKey !== ANON_KEY) {
    return unauthorized("Invalid API key: " + providedKey)
  }
  if (!ANON_KEY) {
    console.warn("ANON_KEY not set in env - skipping API key check")
  }

  // Verify caller is authorized ASO via Authorization header
  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return unauthorized("Missing authorization token")
  }

  try {
    const token = authHeader.slice(7)
    
    // Create client with user's JWT to verify their role
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    
    const { data: { user }, error: userError } = await userClient.auth.getUser(token)
    if (userError || !user) {
      return unauthorized("Invalid or expired token")
    }
    
    // Get the caller's profile to verify ASO role
    const { data: profile } = await userClient
      .from("users")
      .select("role, is_active")
      .eq("auth_id", user.id)
      .single()
    
    if (!profile || profile.role !== "aso" || !profile.is_active) {
      return forbidden("Only active ASO users can create new users")
    }

    // Now use service role for operations
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = await req.json()
    const { email, password, name, badge_number, role, centre } = body

    if (!email || !password || !name || !badge_number || !role || !centre) {
      return badRequest("All fields are required")
    }

    if (password.length < 6) {
      return badRequest("Password must be at least 6 characters")
    }

    const validRoles = ['aso', 'centre', 'sc_sp_user']
    if (!validRoles.includes(role)) {
      return badRequest("Invalid role")
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
    })

    if (authError) {
      if (authError.message.includes("already been registered")) {
        return badRequest("Email already registered")
      }
      throw new Error("Failed to create auth user")
    }

    const { error: insertError } = await adminClient.from("users").insert({
      auth_id: authData.user.id,
      email: email.toLowerCase().trim(),
      name: name.trim(),
      badge_number: badge_number.toUpperCase().trim(),
      role,
      centre,
      is_active: true,
      created_at: new Date().toISOString(),
    })

    if (insertError) {
      await adminClient.auth.admin.deleteUser(authData.user.id)
      if (insertError.message.includes("duplicate")) {
        return badRequest("Badge number already exists")
      }
      throw new Error("Failed to create user profile")
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: authData.user.id,
        message: `User created: ${email} (${role})`
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (err) {
    console.error("Create user error:", err)
    return serverError("Internal server error")
  }
})
