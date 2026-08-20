import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const META_API_VERSION = 'v21.0'
const META_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')
    const errorDescription = url.searchParams.get('error_description')

    if (oauthError) {
      throw new Error(errorDescription || oauthError)
    }

    if (!code) {
      throw new Error('No se recibió el código de autorización de Meta')
    }

    if (!state) {
      throw new Error('No se recibió el parámetro state — falta token de sesión')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default'] ?? ''
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser(state)
    if (userError || !user) {
      throw new Error(`Token de sesión inválido o expirado: ${userError?.message || 'usuario no encontrado'}`)
    }

    const META_APP_ID = Deno.env.get('META_APP_ID') ?? ''
    const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? ''
    const META_REDIRECT_URI = Deno.env.get('META_REDIRECT_URI') ?? ''
    const FRONTEND_URL = Deno.env.get('FRONTEND_URL') ?? ''

    if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI || !FRONTEND_URL) {
      throw new Error('Falta configuración de Meta OAuth en las variables de entorno')
    }

    const tokenResponse = await fetch(
      `${META_GRAPH_URL}/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`,
      { method: 'POST' }
    )

    const tokenData = await tokenResponse.json()
    if (!tokenData.access_token) {
      throw new Error(`Error al intercambiar código por token: ${tokenData.error?.message || JSON.stringify(tokenData)}`)
    }

    const shortLivedToken = tokenData.access_token

    const longLivedResponse = await fetch(
      `${META_GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${shortLivedToken}`
    )

    const longLivedData = await longLivedResponse.json()
    if (!longLivedData.access_token) {
      throw new Error(`Error al obtener token de larga duración: ${longLivedData.error?.message || JSON.stringify(longLivedData)}`)
    }

    const accessToken = longLivedData.access_token
    const expiresIn = longLivedData.expires_in
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null

    // 1. Fetch pages and threads in parallel
    const [pagesRes, threadsRes] = await Promise.all([
      fetch(`${META_GRAPH_URL}/me/accounts?access_token=${accessToken}`),
      fetch(`${META_GRAPH_URL}/me?fields=threads_profile&access_token=${accessToken}`),
    ])

    const [pagesData, threadsData] = await Promise.all([
      pagesRes.json(),
      threadsRes.json(),
    ])

    const pages = pagesData.data || []
    console.log(`[auth-meta-callback] pages found: ${pages.length}`, JSON.stringify(pagesData))

    const threadsProfileId = threadsData.threads_profile?.id || null
    console.log(`[auth-meta-callback] threads profile:`, JSON.stringify(threadsData))

    const platformRecords = []

    // 2. For each page: save the page + check for linked Instagram Business Account
    for (const page of pages) {
      const pageToken = page.access_token || accessToken

      platformRecords.push({
        user_id: user.id,
        platform: 'facebook',
        platform_type: 'facebook',
        account_name: page.name,
        account_id: page.id,
        meta_page_id: page.id,
        is_connected: true,
        connected_at: new Date().toISOString(),
        token_metadata: {
          access_token: pageToken,
          token_type: 'page',
          scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
        },
        token_expires_at: null,
      })

      // instagram_business_account is a field on the PAGE, not on /me
      try {
        const igPageRes = await fetch(
          `${META_GRAPH_URL}/${page.id}?fields=instagram_business_account&access_token=${pageToken}`
        )
        const igPageData = await igPageRes.json()
        console.log(`[auth-meta-callback] page ${page.id} instagram:`, JSON.stringify(igPageData))

        const igAccountId = igPageData.instagram_business_account?.id
        if (igAccountId) {
          let igName = `Instagram ${igAccountId}`
          try {
            const igDetailRes = await fetch(
              `${META_GRAPH_URL}/${igAccountId}?fields=username,name&access_token=${pageToken}`
            )
            const igDetail = await igDetailRes.json()
            igName = igDetail.username || igDetail.name || igName
          } catch {
            // non-critical — use fallback name
          }

          platformRecords.push({
            user_id: user.id,
            platform: 'instagram',
            platform_type: 'instagram',
            account_name: igName,
            account_id: igAccountId,
            meta_page_id: page.id,
            is_connected: true,
            connected_at: new Date().toISOString(),
            token_metadata: {
              access_token: pageToken,
              token_type: 'page',
              scopes: ['instagram_basic', 'instagram_content_publish'],
            },
            token_expires_at: tokenExpiresAt,
          })
        }
      } catch (err) {
        console.error(`[auth-meta-callback] Error fetching Instagram for page ${page.id}:`, err.message)
      }
    }

    // 3. Threads
    if (threadsProfileId) {
      let threadsName = `Threads ${threadsProfileId}`
      try {
        const threadsDetailRes = await fetch(
          `${META_GRAPH_URL}/${threadsProfileId}?fields=name,username&access_token=${accessToken}`
        )
        const threadsDetail = await threadsDetailRes.json()
        threadsName = threadsDetail.name || threadsDetail.username || threadsName
      } catch {
        // non-critical — use fallback name
      }

      platformRecords.push({
        user_id: user.id,
        platform: 'threads',
        platform_type: 'threads',
        account_name: threadsName,
        account_id: threadsProfileId,
        meta_page_id: null,
        is_connected: true,
        connected_at: new Date().toISOString(),
        token_metadata: {
          access_token: accessToken,
          token_type: 'user',
          scopes: ['threads_basic', 'threads_content_publish'],
        },
        token_expires_at: tokenExpiresAt,
      })
    }

    console.log(`[auth-meta-callback] platformRecords to save: ${platformRecords.length}`)

    if (platformRecords.length === 0) {
      throw new Error(
        'No se encontraron cuentas compatibles. Necesitás una Página de Facebook o una cuenta de Instagram Business/Creator vinculada a una página de Facebook.'
      )
    }

    for (const record of platformRecords) {
      const { error: upsertError } = await supabase
        .from('social_accounts')
        .upsert(record, {
          onConflict: 'user_id, platform, account_id',
          ignoreDuplicates: false,
        })

      if (upsertError) {
        console.error(`[auth-meta-callback] Error al guardar ${record.platform}/${record.account_id}:`, upsertError.message)
      }
    }

    const successUrl = new URL('/app/connections', FRONTEND_URL)
    successUrl.searchParams.set('oauth', 'success')

    return new Response(null, {
      status: 302,
      headers: {
        Location: successUrl.toString(),
        ...corsHeaders,
      },
    })
  } catch (error) {
    console.error('[auth-meta-callback] Error:', error.message)

    const FRONTEND_URL = Deno.env.get('FRONTEND_URL') ?? ''
    const errorUrl = new URL('/app/connections', FRONTEND_URL)
    errorUrl.searchParams.set('oauth', 'error')
    errorUrl.searchParams.set('message', error.message || 'Error en el callback OAuth de Meta')

    return new Response(null, {
      status: 302,
      headers: {
        Location: errorUrl.toString(),
        ...corsHeaders,
      },
    })
  }
})
