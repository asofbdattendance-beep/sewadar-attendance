// supabase/functions/create-user/index.ts
// Deploy with: supabase functions deploy create-user
//This is a tst thing
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

    const authHeader = req.headers.get("Authorization")

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Client with caller JWT
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: { headers: { Authorization: authHeader } },
      }
    )

    const { data: { user }, error: userError } = await callerClient.auth.getUser()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Check if caller is area_secretary
    const { data: callerProfile, error: roleError } = await callerClient
      .from("users")
      .select("role")
      .eq("auth_id", user.id)
      .maybeSingle()

    if (roleError || callerProfile?.role !== "area_secretary") {
      return new Response(
        JSON.stringify({ error: "Forbidden: area_secretary only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Service role client
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    const body = await req.json()

    const { email, password, name, badge_number, role, centre } = body

    if (!email || !password || !name || !badge_number || !role || !centre) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Create auth user
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

    if (authError) {
      throw new Error(authError.message)
    }

    // Insert profile into users table
    const { error: insertError } = await adminClient
      .from("users")
      .insert({
        auth_id: authData.user.id,
        email,
        name,
        badge_number: badge_number.toUpperCase(),
        role,
        centre,
        is_active: true,
        created_at: new Date().toISOString(),
      })

    if (insertError) {
      await adminClient.auth.admin.deleteUser(authData.user.id)
      throw new Error(insertError.message)
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: authData.user.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )

  } catch (err: any) {

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