// supabase/functions/create-user/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://sewadar-attendance.netlify.app"
const ANON_KEY = Deno.env.get("ANON_KEY") || ""

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const origin = req.headers.get("origin") || ""
  if (origin !== ALLOWED_ORIGIN) {
    return new Response(
      JSON.stringify({ error: "Unauthorized origin" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  // Basic API key check as a fallback (since --no-verify-jwt bypasses JWT auth)
  const providedKey = req.headers.get("apikey") || ""
  if (ANON_KEY && providedKey !== ANON_KEY) {
    return new Response(
      JSON.stringify({ error: "Invalid API key" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  try {

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? ""

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = await req.json()
    const { email, password, name, badge_number, role, centre } = body

    if (!email || !password || !name || !badge_number || !role || !centre) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const validRoles = ['aso', 'centre_user', 'sc_sp_user']
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: "Invalid role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
    })

    if (authError) {
      if (authError.message.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "Email already registered" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
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
        return new Response(
          JSON.stringify({ error: "Badge number already exists" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
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

  } catch (_err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
