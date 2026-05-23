import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    // Convert base64url to base64
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    return JSON.parse(atob(b64))
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const INTERNAL_SECRET = Deno.env.get('INTERNAL_SECRET')
  if (!INTERNAL_SECRET) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Extract caller's JWT from Authorization header (auto-sent by supabase-js SDK)
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const payload = decodeJWTPayload(token)
  const callerUserId = payload?.sub as string | undefined
  if (!callerUserId) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Verify caller is a super_admin using service-role client
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: caller, error: callerError } = await supabase
    .from('users')
    .select('role')
    .eq('auth_id', callerUserId)
    .single()

  if (callerError || !caller || caller.role !== 'super_admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: super_admin access required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { email, password, user_metadata } = await req.json()

  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'email and password required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ auth_id: data.user.id, temp_password: null })
    .eq('email', email)

  if (updateError) {
    console.error('Failed to update user with auth_id:', updateError)
    // Roll back: delete the auth user we just created
    await supabase.auth.admin.deleteUser(data.user.id)
    return new Response(JSON.stringify({ error: 'Failed to link auth user to profile' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ user_id: data.user.id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
