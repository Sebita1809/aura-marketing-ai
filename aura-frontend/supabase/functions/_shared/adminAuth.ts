// Verificación compartida de "el llamador es admin" (design.md D7).
//
// Usada al inicio de TODA Edge Function que produce un efecto privilegiado
// (create-user, y admin-user-status en el grupo 2 de admin-user-management).
// Criterio no negociable (tasks.md 1.10): ambas funciones deben quedar
// IDÉNTICAS en este punto, por eso vive acá y no duplicada.
//
// Fuente de verdad = profiles.role, leído con el cliente de servicio. NUNCA el
// `role` del body de la petición ni el `app_metadata` del JWT (pueden
// desincronizarse de profiles.role; el body además es responsabilidad de un
// llamador que todavía no verificamos).
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface AdminAuthOk {
  ok: true
  callerId: string
  serviceClient: SupabaseClient
}

export interface AdminAuthFail {
  ok: false
  status: number
  error: string
}

export type AdminAuthResult = AdminAuthOk | AdminAuthFail

function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default'] ?? ''
  )
}

/**
 * Resuelve el JWT del header Authorization, verifica que corresponde a un
 * usuario autenticado y que profiles.role = 'admin' para ese usuario.
 * Rechaza (401/403) sin revelar más información que "no autenticado" /
 * "no autorizado" (D7: respuestas no diagnósticas hacia afuera).
 */
export async function verifyAdminCaller(req: Request): Promise<AdminAuthResult> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!jwt) {
    return { ok: false, status: 401, error: 'No autenticado' }
  }

  const serviceClient = getServiceClient()

  const { data: userData, error: userError } = await serviceClient.auth.getUser(jwt)
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: 'No autenticado' }
  }

  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()

  if (profileError || !profile || profile.role !== 'admin') {
    return { ok: false, status: 403, error: 'No autorizado' }
  }

  return { ok: true, callerId: userData.user.id, serviceClient }
}
