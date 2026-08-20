import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const codeVerifier = url.searchParams.get('code_verifier')
    const error = url.searchParams.get('error')

    const siteUrl = Deno.env.get('PUBLIC_SITE_URL') ?? ''
    const fallbackUrl = `${siteUrl || url.origin}/app/connections`

    const redirectError = (message: string) => {
      return Response.redirect(
        `${fallbackUrl}?oauth=error&message=${encodeURIComponent(message)}`,
        302
      )
    }

    if (error) {
      return redirectError(`X authorization denied: ${error}`)
    }

    if (!code || !state || !codeVerifier) {
      return redirectError('Missing required OAuth parameters')
    }

    let userId: string
    try {
      const stateData = JSON.parse(state)
      userId = stateData.user_id
      if (!userId) throw new Error()
    } catch {
      return redirectError('Invalid state parameter')
    }

    const clientId = Deno.env.get('X_CLIENT_ID')
    const clientSecret = Deno.env.get('X_CLIENT_SECRET')
    if (!clientId || !clientSecret) {
      return redirectError('X API credentials not configured')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const redirectUri = `${supabaseUrl}/functions/v1/auth-x-callback`

    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    })

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text()
      console.error('X token exchange error:', tokenResponse.status, body)
      return redirectError('Failed to exchange authorization code with X')
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token
    if (!accessToken) {
      return redirectError('No access token received from X')
    }

    const userResponse = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!userResponse.ok) {
      const body = await userResponse.text()
      console.error('X user info error:', userResponse.status, body)
      return redirectError('Failed to fetch X user profile')
    }

    const userData = await userResponse.json()
    const xUser = userData.data
    if (!xUser?.id || !xUser?.username) {
      return redirectError('Invalid user data from X API')
    }

    const expiresIn = tokenData.expires_in ?? 7200

    const supabase = createClient(
      supabaseUrl,
      JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default'] ?? ''
    )

    const record = {
      user_id: userId,
      platform: 'twitter',
      account_name: `@${xUser.username}`,
      account_id: xUser.id,
      is_connected: true,
      connected_at: new Date().toISOString(),
      token_metadata: {
        access_token: accessToken,
        refresh_token: tokenData.refresh_token || null,
        token_type: tokenData.token_type || 'bearer',
        expires_in: expiresIn,
        scope: tokenData.scope || '',
        raw_response: tokenData,
      },
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      platform_type: null,
    }

    const { data: existing } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'twitter')
      .maybeSingle()

    if (existing) {
      const { error: updateError } = await supabase
        .from('social_accounts')
        .update(record)
        .eq('id', existing.id)
      if (updateError) {
        console.error('Supabase update error:', updateError)
        return redirectError('Failed to update social account')
      }
    } else {
      const { error: insertError } = await supabase
        .from('social_accounts')
        .insert(record)
      if (insertError) {
        console.error('Supabase insert error:', insertError)
        return redirectError('Failed to save social account')
      }
    }

    return Response.redirect(`${fallbackUrl}?oauth=success`, 302)
  } catch (err) {
    const url = new URL(req.url)
    const siteUrl = Deno.env.get('PUBLIC_SITE_URL') ?? ''
    const fallbackUrl = `${siteUrl || url.origin}/app/connections`
    const message = err instanceof Error ? err.message : 'Unexpected error'
    console.error('auth-x-callback error:', message)
    return Response.redirect(
      `${fallbackUrl}?oauth=error&message=${encodeURIComponent(message)}`,
      302
    )
  }
})
