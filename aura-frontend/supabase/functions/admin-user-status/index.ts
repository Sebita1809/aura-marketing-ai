import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { verifyAdminCaller } from '../_shared/adminAuth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_ACTIONS = ['block', 'unblock', 'deactivate', 'reactivate'] as const
type Action = (typeof VALID_ACTIONS)[number]

type Status = 'active' | 'blocked' | 'deactivated'

// Máquina de transiciones (design.md D8):
//   active --block--> blocked --unblock--> active
//   active --deactivate--> deactivated --reactivate--> active
//   blocked --deactivate--> deactivated
// No existe blocked <- deactivated directo.
//
// `from`: estados desde los que la acción efectivamente transiciona.
// `idempotentFrom`: estados en los que el usuario YA está en el resultado de
//   esta acción -> se responde éxito sin efectos ni traza nueva (D8: doble
//   click no debe dejar registro espurio). Ojo: `unblock` y `reactivate` NO
//   son idempotentes sobre `active` -- design.md lo marca explícitamente como
//   transición inválida ("unblock sobre active" es el ejemplo dado), porque
//   ambas acciones son la reversa específica de block/deactivate y no tienen
//   sentido pedidas sobre alguien que nunca pasó por ese estado a través de
//   esta función.
const TRANSITIONS: Record<Action, { from: Status[]; to: Status; idempotentFrom: Status[] }> = {
  block: { from: ['active'], to: 'blocked', idempotentFrom: ['blocked'] },
  unblock: { from: ['blocked'], to: 'active', idempotentFrom: [] },
  deactivate: { from: ['active', 'blocked'], to: 'deactivated', idempotentFrom: ['deactivated'] },
  reactivate: { from: ['deactivated'], to: 'active', idempotentFrom: [] },
}

// Duración de ban "efectivamente permanente" -- mismo idiom documentado en
// los ejemplos del SDK (auth-js AdminUserAttributes.ban_duration, verificado
// en vivo: ver notas de apply de la tarea 2.1). ~100 años.
const BAN_DURATION_PERMANENT = '876000h'
const BAN_DURATION_NONE = 'none'

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Paso 1 del contrato (design.md D3): autenticar al llamador y verificar
    // profiles.role = 'admin' -- misma rutina que create-user (design.md D7,
    // tasks.md 1.10: ambas funciones deben quedar idénticas en este punto).
    const auth = await verifyAdminCaller(req)
    if (!auth.ok) {
      return jsonResponse(auth.status, { success: false, error: auth.error })
    }
    const { callerId, serviceClient } = auth

    // Paso 2: validar la petición (D3, spec "Petición malformada").
    let body: { user_id?: unknown; action?: unknown; reason?: unknown }
    try {
      body = await req.json()
    } catch {
      return jsonResponse(400, { success: false, error: 'Cuerpo de la petición inválido' })
    }

    const userId = body.user_id
    const action = body.action
    const reason = body.reason

    if (typeof userId !== 'string' || !userId) {
      return jsonResponse(400, { success: false, error: 'user_id es requerido' })
    }
    if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as Action)) {
      return jsonResponse(400, {
        success: false,
        error: `action inválida. Valores permitidos: ${VALID_ACTIONS.join(', ')}`,
      })
    }
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      return jsonResponse(400, { success: false, error: 'reason debe ser texto' })
    }
    const statusReason = typeof reason === 'string' && reason.trim() !== '' ? reason : null
    const validatedAction = action as Action

    // Cargar el usuario objetivo. Solo se llega acá si el llamador ya es
    // admin verificado (D7/D11: un no-admin nunca ve si un user_id existe o
    // no, porque ni siquiera pasa el paso 1).
    const { data: target, error: targetError } = await serviceClient
      .from('profiles')
      .select('id, role, status')
      .eq('id', userId)
      .single()

    if (targetError || !target) {
      return jsonResponse(404, { success: false, error: 'Usuario no encontrado' })
    }

    // D9, salvaguarda 1: no auto-bloqueo / no auto-baja. Incondicional para
    // block/deactivate sobre el propio user_id, sin importar el estado actual
    // (spec: "Auto-bloqueo por API" no condiciona en el estado presente).
    if (userId === callerId && (validatedAction === 'block' || validatedAction === 'deactivate')) {
      return jsonResponse(400, {
        success: false,
        error: 'No podés bloquear ni dar de baja tu propia cuenta',
      })
    }

    // D9, salvaguarda 2: no dejar el sistema sin admins activos. Solo aplica
    // cuando el objetivo ES HOY el único admin activo y la acción reduciría
    // ese estado (block/deactivate). Si ya está blocked/deactivated, la rama
    // de idempotencia de abajo la resuelve sin necesidad de este chequeo.
    if (
      (validatedAction === 'block' || validatedAction === 'deactivate') &&
      target.role === 'admin' &&
      target.status === 'active'
    ) {
      const { count, error: countError } = await serviceClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('status', 'active')

      if (countError) {
        return jsonResponse(500, { success: false, error: 'No se pudo verificar el estado de administradores' })
      }
      if ((count ?? 0) <= 1) {
        return jsonResponse(400, {
          success: false,
          error: 'No se puede bloquear ni dar de baja al único administrador activo',
        })
      }
    }

    // D8: resolver la transición.
    const transition = TRANSITIONS[validatedAction]
    const currentStatus = target.status as Status

    if (transition.idempotentFrom.includes(currentStatus)) {
      // Idempotente: el usuario ya está en el estado resultante de esta
      // acción. Éxito sin efectos ni traza nueva (evita registro espurio por
      // doble click).
      return jsonResponse(200, { success: true, user_id: userId, status: currentStatus })
    }

    if (!transition.from.includes(currentStatus)) {
      return jsonResponse(400, {
        success: false,
        error: `Transición inválida: no se puede aplicar "${validatedAction}" a un usuario en estado "${currentStatus}"`,
      })
    }

    const newStatus = transition.to

    // Paso 3 del contrato (D3): aplicar el estado en profiles. Se guarda el
    // valor previo de las columnas tocadas para poder revertir si el paso 4
    // (Auth) falla (D3 paso 5 / tasks.md 2.9).
    const previous = {
      status: currentStatus,
      status_changed_at: null as string | null,
      status_changed_by: null as string | null,
      status_reason: null as string | null,
      telegram_chat_id: undefined as string | null | undefined,
    }
    // Se necesitan los valores previos reales de traza + telegram_chat_id
    // para poder revertir con exactitud (no alcanza con "currentStatus").
    const { data: fullTarget, error: fullTargetError } = await serviceClient
      .from('profiles')
      .select('status_changed_at, status_changed_by, status_reason, telegram_chat_id')
      .eq('id', userId)
      .single()
    if (fullTargetError || !fullTarget) {
      return jsonResponse(500, { success: false, error: 'No se pudo leer el estado actual del usuario' })
    }
    previous.status_changed_at = fullTarget.status_changed_at
    previous.status_changed_by = fullTarget.status_changed_by
    previous.status_reason = fullTarget.status_reason
    previous.telegram_chat_id = fullTarget.telegram_chat_id

    const nowIso = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      status_changed_at: nowIso,
      status_changed_by: callerId,
      status_reason: statusReason,
    }
    // D1: deactivate libera el vínculo de Telegram; block lo conserva.
    if (validatedAction === 'deactivate') {
      updatePayload.telegram_chat_id = null
    }

    const { error: updateError } = await serviceClient
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId)

    if (updateError) {
      return jsonResponse(500, { success: false, error: 'No se pudo actualizar el estado del usuario' })
    }

    // Paso 4 del contrato (D3): efecto en Auth. Verificado en vivo (tarea
    // 2.1): banear con ban_duration invalida INMEDIATAMENTE el access token
    // vigente del usuario (GoTrue lo valida en cada request, no solo al
    // refrescar) además de impedir logins nuevos -- no hace falta un signOut
    // separado.
    const banDuration =
      validatedAction === 'block' || validatedAction === 'deactivate'
        ? BAN_DURATION_PERMANENT
        : BAN_DURATION_NONE

    const { error: authEffectError } = await serviceClient.auth.admin.updateUserById(userId, {
      ban_duration: banDuration,
    })

    if (authEffectError) {
      // Paso 5 (D3) / tasks.md 2.9: si el efecto en Auth falla, se revierte
      // el cambio en profiles. Nunca responder éxito con el perfil
      // mostrando un estado que el acceso real no refleja.
      const { error: rollbackError } = await serviceClient
        .from('profiles')
        .update({
          status: previous.status,
          status_changed_at: previous.status_changed_at,
          status_changed_by: previous.status_changed_by,
          status_reason: previous.status_reason,
          ...(validatedAction === 'deactivate'
            ? { telegram_chat_id: previous.telegram_chat_id }
            : {}),
        })
        .eq('id', userId)

      return jsonResponse(500, {
        success: false,
        error: rollbackError
          ? 'Falló el cambio de acceso en Auth y además falló el rollback del perfil. Requiere revisión manual inmediata.'
          : 'Falló el cambio de acceso en Auth. El cambio de estado fue revertido.',
      })
    }

    return jsonResponse(200, { success: true, user_id: userId, status: newStatus })
  } catch (error) {
    return jsonResponse(400, {
      success: false,
      error: error instanceof Error ? error.message : 'Error al procesar la solicitud',
    })
  }
})
