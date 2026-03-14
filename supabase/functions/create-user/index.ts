// supabase/functions/create-user/index.ts
// Deploy with: supabase functions deploy create-user
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {

  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {

    // Verify API key is provided
    const apikey = req.headers.get("apikey")
    if (!apikey) {
      return new Response(
        JSON.stringify({ error: "Missing API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Use service role to bypass RLS and create user
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? ""

    if (!serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const body = await req.json()
    const { email, password, name, badge_number, role, centre } = body

    // Validate required fields
    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (!password) {
      return new Response(
        JSON.stringify({ error: "Password is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (!name) {
      return new Response(
        JSON.stringify({ error: "Name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (!badge_number) {
      return new Response(
        JSON.stringify({ error: "Badge number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (!role) {
      return new Response(
        JSON.stringify({ error: "Role is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (!centre) {
      return new Response(
        JSON.stringify({ error: "Centre is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Validate role
    const validRoles = ['aso', 'centre_user', 'sc_sp_user']
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Check if email already exists
    const { data: existingUser } = await adminClient
      .from("users")
      .select("id, email")
      .eq("email", email.toLowerCase())
      .maybeSingle()

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: "A user with this email already exists" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Create auth user
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
    })

    if (authError) {
      // Check for specific error types
      if (authError.message.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "This email is already registered" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
      throw new Error(authError.message)
    }

    // Insert profile into users table
    const { error: insertError } = await adminClient
      .from("users")
      .insert({
        auth_id: authData.user.id,
        email: email.toLowerCase(),
        name,
        badge_number: badge_number.toUpperCase(),
        role,
        centre,
        is_active: true,
        created_at: new Date().toISOString(),
      })

    if (insertError) {
      // Cleanup: delete the auth user if profile creation fails
      await adminClient.auth.admin.deleteUser(authData.user.id)
      
      if (insertError.message.includes("duplicate")) {
        return new Response(
          JSON.stringify({ error: "A user with this badge number already exists" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
      throw new Error(insertError.message)
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: authData.user.id,
        message: `User ${email} created successfully with role ${role}`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )

  } catch (err: any) {
    console.error("Error creating user:", err.message)

    return new Response(
      JSON.stringify({
        error: err.message ?? "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )

  }

})
