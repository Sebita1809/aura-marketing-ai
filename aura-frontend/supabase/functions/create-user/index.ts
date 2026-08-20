import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { verifyAdminCaller } from '../_shared/adminAuth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_ROLES = ['admin', 'user']

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verificación de admin del lado servidor (design.md D7, BREAKING): antes
    // de crear nada, el llamador debe estar autenticado y ser profiles.role =
    // 'admin'. Cierra la escalada de privilegios donde cualquier usuario podía
    // invocar esta función y pasar role: 'admin' en el body.
    const auth = await verifyAdminCaller(req)
    if (!auth.ok) {
      return new Response(JSON.stringify({ success: false, error: auth.error }), {
        status: auth.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    const { email, password, company, telegram, full_name, role } = await req.json()

    if (!email || !password) {
      throw new Error('Email y contraseña son requeridos')
    }

    // El role del body ya no autoriza nada por sí solo (eso lo hizo
    // verifyAdminCaller arriba); solo se valida contra el enum permitido.
    if (role !== undefined && role !== null && !VALID_ROLES.includes(role)) {
      throw new Error(`Rol inválido. Valores permitidos: ${VALID_ROLES.join(', ')}`)
    }

    const supabase = auth.serviceClient

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, company },
      app_metadata: { role: role || 'user' },
    })

    if (authError) throw authError
    if (!authData.user) throw new Error('No se pudo crear el usuario')

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        email,
        full_name: full_name || null,
        company: company || null,
        telegram_id: telegram || null,
        role: role || 'user',
        // is_active ya no se setea: es columna GENERATED (design.md D2),
        // Postgres rechaza un INSERT que le asigne valor explícito.
      })

    if (profileError) {
      await supabase.auth.admin.deleteUser(authData.user.id)
      throw profileError
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: authData.user.id,
          email: authData.user.email,
        },
        message: 'Usuario creado exitosamente',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Error al crear el usuario',
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    )
  }
})
