import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    return JSON.parse(atob(b64))
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
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

  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata
  })

  if (createError) {
    const { data: userList } = await supabase.auth.admin.listUsers()
    const existing = userList?.users?.find(u => u.email === email)
    if (existing) {
      await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata
      }).then(() => {}).catch(() => {})

      const { error: linkError } = await supabase
        .from('users')
        .update({ auth_id: existing.id, temp_password: null })
        .eq('email', email)

      if (linkError) {
        return new Response(JSON.stringify({ error: 'Auth user exists but link failed. Create manually in Supabase Dashboard.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ user_id: existing.id, linked: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: createError.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ auth_id: createData.user.id, temp_password: null })
    .eq('email', email)

  if (updateError) {
    console.error('Failed to update user with auth_id:', updateError)
    await supabase.auth.admin.deleteUser(createData.user.id)
    return new Response(JSON.stringify({ error: 'Failed to link auth user to profile' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ user_id: createData.user.id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
