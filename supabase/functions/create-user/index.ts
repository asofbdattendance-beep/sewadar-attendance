// supabase/functions/create-user/index.ts
// SECURE: Creates new user accounts - ASO only
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? ""

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id",
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // Get user ID from x-user-id header
  const userId = req.headers.get("x-user-id") || ""
  console.log("x-user-id header:", userId)

  if (!userId) {
    return new Response(JSON.stringify({ error: "Missing x-user-id header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verify caller's profile is ASO
    const { data: profile, error: profileError } = await adminClient
      .from("users")
      .select("role, is_active")
      .eq("auth_id", userId)
      .single()
    
    console.log("Profile lookup:", { profile, error: profileError })
    
    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "User profile not found" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    
    if (profile.role !== "aso" || !profile.is_active) {
      return new Response(JSON.stringify({ error: "Only active ASO users can create new users" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = await req.json()
    const { email, password, name, badge_number, role, centre } = body

    if (!email || !password || !name || !badge_number || !role || !centre) {
      return new Response(JSON.stringify({ error: "All fields are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
    })

    if (authError) {
      if (authError.message.includes("already been registered")) {
        return new Response(JSON.stringify({ error: "Email already registered" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      throw new Error("Failed to create auth user: " + authError.message)
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
        return new Response(JSON.stringify({ error: "Badge number already exists" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      throw new Error("Failed to create user profile: " + insertError.message)
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
    return new Response(JSON.stringify({ error: "Internal server error: " + err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
