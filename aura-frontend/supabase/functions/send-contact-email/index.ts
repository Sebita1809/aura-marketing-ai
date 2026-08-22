import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  validateContactPayload,
  isHoneypotFilled,
  escapeHtml,
  sanitizeHeaderValue,
  extractClientIp,
} from './validation.js'

// Edge Function pública (sin sesión de usuario) que entrega el formulario de
// contacto de la landing por correo, vía Resend (landing-contact-email,
// design.md Decisión 1 y 2). Mismo esqueleto que create-user/index.ts:
// serve() -> OPTIONS con corsHeaders -> parse del body en try/catch propio ->
// validación -> proveedor -> Response JSON. A diferencia de create-user, este
// endpoint NO usa la service key ni verifyAdminCaller: es anónimo por diseño,
// así que las defensas viven en validation.js (honeypot, límites, rate
// limit, escapado) en vez de en auth.
//
// La validación y el escapado están extraídos a validation.js para poder
// testearlos con node:test sin un runtime Deno (ver validation.test.js).
// Este archivo orquesta: parseo del request, rate limit (RPC a Postgres),
// llamada a Resend y armado de la Response -- no se testea directamente,
// mismo criterio que admin-user-status y create-user.
//
// El rate limit por IP vive en Postgres desde la escalada post-lanzamiento
// (ver supabase/migrations/20260818210000_contact_rate_limits.sql): la
// versión original usaba un Map en memoria del isolate (design.md Decisión
// 5.3), pero en producción Supabase no reusa el isolate de forma confiable
// entre invocaciones consecutivas de este proyecto -- verificado en vivo,
// 9 requests seguidos desde la misma IP y ninguno bloqueado. La función
// contact_rate_limit_check() hace el check-and-increment atómico
// (advisory lock por IP) en una sola llamada RPC vía el cliente de servicio.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Mismo patrón que adminAuth.ts / token-manager: cliente de servicio vía
// SUPABASE_SECRET_KEYS (JSON con la key activa bajo 'default'), nunca la
// anon key -- esta llamada tiene que bypassear RLS para poder usar
// contact_rate_limit_check() aunque la tabla no tenga políticas de cliente.
function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default'] ?? ''
  )
}

function jsonResponse(body, status) {
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
    // Config leída una vez por request. RESEND_API_KEY y CONTACT_TO_EMAIL NO
    // tienen default: si faltan, la función debe fallar explícito (tasks.md
    // 2.6 / design.md Decisión 3), nunca responder success:true sin haber
    // enviado ni mandar el contacto a una casilla sorpresa. CONTACT_FROM_EMAIL
    // sí tiene default: onboarding@resend.dev es la dirección pública de
    // sandbox de Resend, funciona sin verificar dominio propio.
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const CONTACT_TO_EMAIL = Deno.env.get('CONTACT_TO_EMAIL')
    const CONTACT_FROM_EMAIL = Deno.env.get('CONTACT_FROM_EMAIL') || 'onboarding@resend.dev'

    // Rate limit por IP (tasks.md 3.3, ahora en Postgres): se chequea ANTES
    // de tocar el body, así una IP que ya superó el límite ni siquiera gasta
    // ciclos parseando JSON malformado.
    const clientIp = extractClientIp(req.headers.get('x-forwarded-for'))
    const serviceClient = getServiceClient()
    const { data: allowed, error: rateLimitError } = await serviceClient.rpc(
      'contact_rate_limit_check',
      { p_ip: clientIp }
    )

    if (rateLimitError) {
      // Fail-open (mismo criterio que el rate limiter del bot en
      // input-security-hardening/bot-rate-limiting: si el store de conteo no
      // responde, se deja pasar el request y se registra la falla, en vez de
      // convertir un problema de infra en un formulario de contacto caído
      // para todo el mundo). El resto de los controles -- validación,
      // honeypot, escapado -- siguen fail-closed sin excepción.
      console.error('send-contact-email: fallo el check de rate limit, fail-open:', rateLimitError.message)
    } else if (allowed === false) {
      return jsonResponse(
        { success: false, error: 'Alcanzaste el límite de envíos. Reintentá en unos minutos.' },
        429
      )
    }

    let body
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ success: false, error: 'El cuerpo del request no es un JSON válido.' }, 400)
    }

    const { name, email, message, company } = body || {}

    // Honeypot (tasks.md 3.2): si un bot completó el campo oculto, se
    // responde éxito sin enviar nada -- el bot no debe distinguir el
    // rechazo de un envío real.
    if (isHoneypotFilled(company)) {
      return jsonResponse({ success: true }, 200)
    }

    const { valid, error: validationError } = validateContactPayload({ name, email, message })
    if (!valid) {
      return jsonResponse({ success: false, error: validationError }, 400)
    }

    // RESEND_API_KEY / CONTACT_TO_EMAIL ausentes: 500 explícito, nunca
    // success:true (spec contact-email-delivery, "Key ausente").
    if (!RESEND_API_KEY) {
      console.error('send-contact-email: RESEND_API_KEY no está configurada.')
      return jsonResponse(
        { success: false, error: 'El servicio de contacto no está configurado. Intentá por WhatsApp.' },
        500
      )
    }
    if (!CONTACT_TO_EMAIL) {
      console.error('send-contact-email: CONTACT_TO_EMAIL no está configurada.')
      return jsonResponse(
        { success: false, error: 'El servicio de contacto no está configurado. Intentá por WhatsApp.' },
        500
      )
    }

    const safeName = escapeHtml(name.trim())
    const safeEmail = escapeHtml(email.trim())
    const safeMessageHtml = escapeHtml(message.trim()).replace(/\n/g, '<br/>')

    // subject y reply_to se construyen con valores saneados (sin saltos de
    // línea/control chars) para que no se pueda inyectar headers adicionales
    // (tasks.md 3.5) -- nunca se concatena el input crudo en un header.
    const subject = `Nuevo contacto desde la landing — ${sanitizeHeaderValue(name.trim())}`
    const replyTo = sanitizeHeaderValue(email.trim())

    const html = `
      <div>
        <p><strong>Nombre:</strong> ${safeName}</p>
        <p><strong>Correo:</strong> ${safeEmail}</p>
        <p><strong>Mensaje:</strong></p>
        <p>${safeMessageHtml}</p>
      </div>
    `.trim()

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: CONTACT_FROM_EMAIL,
        to: [CONTACT_TO_EMAIL],
        subject,
        reply_to: replyTo,
        html,
      }),
    })

    if (!resendResponse.ok) {
      // Se loguea el status y el cuerpo de error de Resend para diagnóstico,
      // nunca la API key (tasks.md 4.3).
      const errorBody = await resendResponse.text().catch(() => '<sin cuerpo>')
      console.error(`send-contact-email: Resend respondió ${resendResponse.status}: ${errorBody}`)
      return jsonResponse(
        { success: false, error: 'No pudimos enviar tu mensaje. Intentá por WhatsApp.' },
        500
      )
    }

    return jsonResponse({ success: true }, 200)
  } catch (error) {
    console.error('send-contact-email: error inesperado:', error?.message || error)
    return jsonResponse({ success: false, error: 'Ocurrió un error inesperado.' }, 500)
  }
})
