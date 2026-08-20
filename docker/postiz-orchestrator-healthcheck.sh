#!/bin/sh
# Healthcheck de postiz: ademas del chequeo HTTP basico (backend/frontend),
# valida que el proceso PM2 "orchestrator" (worker de Temporal que publica
# de verdad en Instagram/Facebook/etc.) tenga alguna conexion de red activa.
#
# Motivo: se detecto que tras un arranque en frio del stack completo, el
# orchestrator a veces queda "online" en PM2 pero sin conectar nunca a
# Temporal/Postgres/Redis -> los posts quedan en QUEUE para siempre sin
# ningun error visible. El HTTP check original no detectaba esto porque
# backend/frontend seguian respondiendo con normalidad.
#
# Si NINGUN proceso "orchestrator/src/main.js" tiene conexion activa durante
# STUCK_THRESHOLD segundos seguidos, se asume colgado y se reinicia
# automaticamente. El primer tramo sin conexiones (compilando los ~20
# workers por plataforma con webpack) es normal y no dispara el reinicio.
#
# Nota: no se asume "cual" pid es el vigente (pm2/dotenv anidan varios
# wrappers y en un restart puede quedar mas de un candidato un instante) -
# alcanza con que ALGUNO de los procesos que matchean tenga conexion.

set -u

STUCK_MARKER=/tmp/.postiz_orchestrator_stuck_since
STUCK_THRESHOLD=90

# 1. Chequeo HTTP basico (backend/frontend vivos)
if ! node -e "const r=require('http').get('http://localhost:5000/',res=>process.exit(res.statusCode<500?0:1));r.on('error',()=>process.exit(1));r.setTimeout(4000,()=>{r.destroy();process.exit(1)})"; then
  exit 1
fi

# 2. Encontrar todos los PIDs del proceso orchestrator real (no el wrapper de dotenv)
ORCH_PIDS=""
for p in /proc/[0-9]*; do
  pid=$(basename "$p")
  cmdline=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null || true)
  case "$cmdline" in
    *orchestrator/src/main.js*)
      case "$cmdline" in
        *dotenv*) ;;
        *) ORCH_PIDS="$ORCH_PIDS $pid" ;;
      esac
      ;;
  esac
done

if [ -z "$ORCH_PIDS" ]; then
  # PM2 todavia no lo levanto (arranque muy temprano); dejamos que retries/start_period
  # de docker-compose den margen.
  exit 1
fi

# 3. Alguno de esos PIDs tiene conexion de red activa? (temporal:7233 / postgres:5432 / redis:6379)
CONN_PIDS=$(ss -tnp 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
CONNECTED=0
for pid in $ORCH_PIDS; do
  if echo "$CONN_PIDS" | grep -qx "$pid"; then
    CONNECTED=1
    break
  fi
done

if [ "$CONNECTED" = "1" ]; then
  rm -f "$STUCK_MARKER"
  exit 0
fi

# 4. Ninguno conectado: puede ser arranque legitimo (compilando workers) o cuelgue real
now=$(date +%s)
if [ ! -f "$STUCK_MARKER" ]; then
  echo "$now" > "$STUCK_MARKER"
  exit 1
fi

since=$(cat "$STUCK_MARKER" 2>/dev/null || echo "$now")
elapsed=$((now - since))

if [ "$elapsed" -ge "$STUCK_THRESHOLD" ]; then
  echo "[postiz-healthcheck] orchestrator sin conexiones hace ${elapsed}s (>= ${STUCK_THRESHOLD}s): reiniciando" >&2
  # Limpieza: matar todos los candidatos actuales (huerfanos incluidos) antes de
  # reiniciar, para no acumular procesos colgados en reinicios sucesivos.
  kill $ORCH_PIDS >&2 2>&1 || true
  pm2 restart orchestrator >&2 2>&1 || true
  date +%s > "$STUCK_MARKER"
fi

exit 1
