import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

interface SocialAccount {
  id: string
  user_id: string
  platform: string
  account_name: string
  account_id: string
  is_connected: boolean
  token_metadata: Record<string, unknown>
  token_expires_at: string | null
  platform_type: string | null
  meta_page_id: string | null
}

interface TokenResult {
  account_id: string
  platform: string
  account_name: string
  action: 'expired_marked' | 'expiring_soon_warning' | 'refreshed' | 'refresh_failed' | 'no_action'
  details: string
}

interface Summary {
  total_checked: number
  expired_marked: number
  expiring_soon_warning: number
  refreshed: number
  refresh_failed: number
  no_action: number
  results: TokenResult[]
}

function newSummary(): Summary {
  return {
    total_checked: 0,
    expired_marked: 0,
    expiring_soon_warning: 0,
    refreshed: 0,
    refresh_failed: 0,
    no_action: 0,
    results: [],
  }
}

function pushResult(s: Summary, r: TokenResult): void {
  s.total_checked++
  s.results.push(r)
  const key = r.action as keyof Omit<Summary, 'total_checked' | 'results'>
  if (key in s) (s[key] as number)++
}

async function refreshXToken(
  account: SocialAccount,
  supabase: ReturnType<typeof createClient>,
  dryRun: boolean
): Promise<TokenResult> {
  const refreshToken = account.token_metadata?.refresh_token as string | undefined
  if (!refreshToken) {
    console.warn(`[token-manager] ${account.account_name}: no refresh_token in metadata`)
    return {
      account_id: account.account_id,
      platform: account.platform,
      account_name: account.account_name,
      action: 'refresh_failed',
      details: 'No refresh_token available in token_metadata',
    }
  }

  const clientId = Deno.env.get('X_CLIENT_ID')
  const clientSecret = Deno.env.get('X_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    console.error('[token-manager] X_CLIENT_ID or X_CLIENT_SECRET not configured')
    return {
      account_id: account.account_id,
      platform: account.platform,
      account_name: account.account_name,
      action: 'refresh_failed',
      details: 'X_CLIENT_ID or X_CLIENT_SECRET not configured',
    }
  }

  if (dryRun) {
    return {
      account_id: account.account_id,
      platform: account.platform,
      account_name: account.account_name,
      action: 'refreshed',
      details: '[DRY RUN] Would refresh X token',
    }
  }

  try {
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      console.error(`[token-manager] X refresh error for ${account.account_name}:`, res.status, JSON.stringify(data))
      return {
        account_id: account.account_id,
        platform: account.platform,
        account_name: account.account_name,
        action: 'refresh_failed',
        details: `X API ${res.status}: ${data.error_description || data.error || 'Unknown error'}`,
      }
    }

    if (!data.access_token) {
      return {
        account_id: account.account_id,
        platform: account.platform,
        account_name: account.account_name,
        action: 'refresh_failed',
        details: 'No access_token in refresh response',
      }
    }

    const expiresIn = data.expires_in ?? 7200
    const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    const { error: updateError } = await supabase
      .from('social_accounts')
      .update({
        token_metadata: {
          access_token: data.access_token,
          refresh_token: data.refresh_token || refreshToken,
          token_type: data.token_type || 'bearer',
          expires_in: expiresIn,
          scope: data.scope || '',
          raw_response: data,
        },
        token_expires_at: newExpiresAt,
      })
      .eq('id', account.id)

    if (updateError) {
      console.error(`[token-manager] DB update failed for ${account.account_name}:`, updateError.message)
      return {
        account_id: account.account_id,
        platform: account.platform,
        account_name: account.account_name,
        action: 'refresh_failed',
        details: `Database error: ${updateError.message}`,
      }
    }

    console.log(`[token-manager] Refreshed X token for ${account.account_name}, expires ${newExpiresAt}`)
    return {
      account_id: account.account_id,
      platform: account.platform,
      account_name: account.account_name,
      action: 'refreshed',
      details: `Token refreshed, expires at ${newExpiresAt}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[token-manager] X refresh exception for ${account.account_name}:`, msg)
    return {
      account_id: account.account_id,
      platform: account.platform,
      account_name: account.account_name,
      action: 'refresh_failed',
      details: `Exception: ${msg}`,
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const platformFilter = url.searchParams.get('platform')
    const dryRun = url.searchParams.get('dry-run') === 'true'

    if (platformFilter && !['twitter', 'meta'].includes(platformFilter)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid platform filter. Use "twitter" or "meta".' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default'] ?? ''
    )

    const now = new Date()
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    let query = supabase
      .from('social_accounts')
      .select('*')
      .eq('is_connected', true)
      .not('token_expires_at', 'is', null)

    if (platformFilter === 'twitter') {
      query = query.eq('platform', 'twitter')
    } else if (platformFilter === 'meta') {
      query = query.in('platform', ['instagram', 'facebook', 'threads'])
    }

    const { data: accounts, error: queryError } = await query

    if (queryError) {
      throw new Error(`Database query error: ${queryError.message}`)
    }

    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ ...newSummary(), message: 'No active accounts with token expiry found' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }

    const summary = newSummary()

    for (const account of accounts as SocialAccount[]) {
      if (!account.token_expires_at) continue
      const expiresAt = new Date(account.token_expires_at)

      if (expiresAt < now) {
        if (!dryRun) {
          const { error: updateError } = await supabase
            .from('social_accounts')
            .update({ is_connected: false })
            .eq('id', account.id)

          if (updateError) {
            console.error(`[token-manager] Failed to mark ${account.platform}/${account.account_name} disconnected:`, updateError.message)
            pushResult(summary, {
              account_id: account.account_id,
              platform: account.platform,
              account_name: account.account_name,
              action: 'expired_marked',
              details: `Update failed: ${updateError.message}`,
            })
            continue
          }

          console.log(`[token-manager] Marked ${account.platform}/${account.account_name} disconnected (expired ${expiresAt.toISOString()})`)
        }

        pushResult(summary, {
          account_id: account.account_id,
          platform: account.platform,
          account_name: account.account_name,
          action: 'expired_marked',
          details: dryRun
            ? '[DRY RUN] Would mark as disconnected'
            : `Token expired at ${expiresAt.toISOString()}`,
        })
      } else if (expiresAt < sevenDaysFromNow) {
        if (account.platform === 'twitter') {
          const result = await refreshXToken(account, supabase, dryRun)
          pushResult(summary, result)
        } else {
          console.log(`[token-manager] ${account.platform}/${account.account_name} expires ${expiresAt.toISOString()} — no refresh available`)
          pushResult(summary, {
            account_id: account.account_id,
            platform: account.platform,
            account_name: account.account_name,
            action: 'expiring_soon_warning',
            details: `Token expires at ${expiresAt.toISOString()} (${account.platform} cannot be refreshed)`,
          })
        }
      } else {
        pushResult(summary, {
          account_id: account.account_id,
          platform: account.platform,
          account_name: account.account_name,
          action: 'no_action',
          details: `Token valid until ${expiresAt.toISOString()}`,
        })
      }
    }

    return new Response(
      JSON.stringify(summary, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[token-manager] Error:', message)
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  }
})
