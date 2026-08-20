# start-dev.ps1
# Levanta ngrok (1 tunnel a Caddy :8080) + Caddy + Docker
# Uso: .\start-dev.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$CADDYFILE = "$ProjectRoot\Caddyfile"
$DOMAIN = "inexpressibly-remigial-teddy.ngrok-free.dev"
$PUBLIC_URL = "https://$DOMAIN"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "   ERROR: $msg" -ForegroundColor Red }

# ─── 1. Matar procesos anteriores ─────────────────────────────────────────
Write-Step "Deteniendo procesos anteriores..."
Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "caddy" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# ─── 2. Arrancar ngrok (1 tunnel -> Caddy :8080) ─────────────────────────
Write-Step "Iniciando ngrok (main -> localhost:8080)..."
Start-Process -FilePath "ngrok" -ArgumentList "start main" -WindowStyle Minimized

# ─── 3. Esperar a que la API de ngrok responda ────────────────────────────
Write-Step "Esperando que ngrok este listo..."
$ready = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-RestMethod "http://localhost:4040/api/tunnels" -ErrorAction Stop
        if ($res.tunnels.Count -ge 1) { $ready = $true; break }
    } catch {}
    Write-Host "   ($i/30)..." -NoNewline
}
if (-not $ready) {
    Write-Err "ngrok no arranco en 30 segundos."
    exit 1
}
Write-Ok "ngrok listo -> $PUBLIC_URL"

# ─── 4. Arrancar Caddy ────────────────────────────────────────────────────
Write-Step "Iniciando Caddy (reverse proxy)..."
$caddyProcess = Start-Process -FilePath "caddy" -ArgumentList "run --config `"$CADDYFILE`"" -WindowStyle Minimized -PassThru

# Esperar que Caddy responda
Write-Step "Verificando que Caddy este listo..."
$caddyReady = $false
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $null = Invoke-WebRequest "http://localhost:8080/" -TimeoutSec 2 -UseBasicParsing
        $caddyReady = $true; break
    } catch {}
    Write-Host "   ($i/15)..." -NoNewline
}
if (-not $caddyReady) {
    Write-Err "Caddy no respondio en 15 segundos. Verificar: caddy run --config `"$CADDYFILE`""
    exit 1
}
Write-Ok "Caddy listo (PID: $($caddyProcess.Id))"

# ─── 5. Actualizar .env para docker-compose (preservando otras variables) ─
Write-Step "Actualizando .env de n8n..."
$envPath = "$ProjectRoot\.env"
$envVars = [ordered]@{}
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            $envVars[$Matches[1]] = $Matches[2]
        }
    }
}
$envVars['N8N_WEBHOOK_URL'] = "$PUBLIC_URL/n8n/"
$envVars['DOMAIN'] = $DOMAIN
$envVars.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Out-File -FilePath $envPath -Encoding utf8
Write-Ok ".env actualizado (WEBHOOK_URL apunta a $PUBLIC_URL/n8n/, resto de variables preservado)"

# ─── 6. Levantar contenedores ─────────────────────────────────────────────
Write-Step "Levantando Docker..."
docker compose -f "$ProjectRoot\docker-compose.yml" up -d --force-recreate n8n postiz

# ─── 7. Resumen ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  LISTO!" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Todos los servicios en 1 URL:" -ForegroundColor Yellow
Write-Host "  $PUBLIC_URL" -ForegroundColor Green
Write-Host "    Postiz : / (root)" -ForegroundColor Green
Write-Host "    n8n    : /n8n/"         -ForegroundColor Green
Write-Host "    App    : /login, /app/*, /admin/*, /oauth/*, /assets/*" -ForegroundColor Green
Write-Host ""
Write-Host "  Edge Functions (URL fija - no cambian):" -ForegroundColor Yellow
Write-Host "  Meta callback: https://legffrhakunfignlaftl.supabase.co/functions/v1/auth-meta-callback" -ForegroundColor Magenta
Write-Host "  X callback    : https://legffrhakunfignlaftl.supabase.co/functions/v1/auth-x-callback"    -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
