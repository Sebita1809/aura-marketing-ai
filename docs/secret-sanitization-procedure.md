# Procedimiento de export saneado — anexo de tesis [A-50]

Cambio: `secrets-migration` — ver `openspec/changes/secrets-migration/` y la decisión D6 de `design.md`.

Este documento describe cómo obtener la versión del workflow que se adjunta como anexo **[A-50]** de la tesis, **sin exponer ninguna credencial**. Antes de la migración, `codigo.json` contenía el JWT `service_role` de Supabase (20 ocurrencias) y la API key de Postiz (2 ocurrencias) en texto plano; después de la migración, el export queda limpio **por construcción**. Los pasos siguientes verifican y sanearizan el export para que sea seguro de publicar.

## 1) Exportar el workflow desde la UI de n8n

1. Abrir el workflow en n8n (Workflows → seleccionar "Bot Aura" o el nombre real del workflow).
2. Menú de tres puntos del workflow → **Export** → guardar el archivo JSON.
3. El export **nunca incluye valores de credenciales**: los secretos viven en la base de datos de n8n, y el JSON solo guarda referencias `credentials: { <tipo>: { id, name } }`. Un export obtenido así no contiene JWT ni API keys por diseño.

> Verificación de consistencia con el repo: si el workflow fue re-importado desde `codigo.json`, el export debe coincidir con `codigo.json` en nodos, conexiones y referencias de credenciales (ver task 4.7 de `tasks.md`).

## 2) Correr el scan de secretos

Sobre el archivo exportado, en PowerShell (texto crudo):

```powershell
$raw = Get-Content codigo.json -Raw -Encoding UTF8

# 1. Ningún JWT (un JWT JOSE empieza con el header base64 "eyJ")
([regex]::Matches($raw, 'eyJ')).Count                                   # DEBE ser 0

# 2. Ningún valor de la API key de Postiz
([regex]::Matches($raw, '<ROTADA-2026-08-18-ver-nota-en-tasks.md-4.1>')).Count   # DEBE ser 0

# 3. Ningún header Authorization literal
([regex]::Matches($raw, 'Bearer ')).Count                               # DEBE ser 0

# 4. Ningún header apikey literal
([regex]::Matches($raw, '"apikey"')).Count                              # DEBE ser 0

# 5. La URL del proyecto Supabase no es un secreto: exactamente 10 (las URLs de los nodos)
([regex]::Matches($raw, 'supabase\.co')).Count                          # DEBE ser 10
```

Reglas 1–4 deben dar **0**; la 5 debe dar **10** (la URL del proyecto es necesaria para que el flujo funcione, no es información sensible). Si cualquier regla falla, **no** adjuntar el archivo: corregir el origen del secreto y re-exportar.

## 3) Reemplazar los `id` reales de credenciales por `<placeholder>` en la copia de anexo

El export referencia credenciales con su UUID interno de n8n (p.ej. `"id": "c9f0c1d5-..."`). Esos UUIDs son metadatos internos que conviene no filtrar. En la **copia** destinada al anexo:

```powershell
# Abrir la copia de anexo, reemplazar los UUID reales por <placeholder>
(Get-Content export-anexo.json -Raw -Encoding UTF8) `
  -replace '"id":\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"', '"id": "<placeholder>"' `
  | Set-Content export-anexo-saneado.json -Encoding UTF8
```

- Reemplazar **solo los `id` dentro del objeto `credentials`** de cada nodo (y del nivel raíz si el export los incluye). Si se prefiere precisión quirúrgica, reemplazarlos a mano por editor.
- No reemplazar los `id` de los **nodos** (son referencias internas del grafo, no secretos).
- n8n no valida el formato del `id` al importar y asocia credenciales por `name`; un anexo con `<placeholder>` sigue siendo un export válido y correctamente documentado (ver D2/D6 de `design.md`).

## 4) Confirmar `pinData` vacío

```powershell
$j = (Get-Content export-anexo-saneado.json -Raw -Encoding UTF8) | ConvertFrom-Json
($j.nodes | Where-Object { $_.pinData }).Count                          # DEBE ser 0
```

`pinData` contiene resultados de ejecuciones pineados ("pinned data"); si hubiera datos pineados con secretos (respuestas de APIs, binarios), el archivo quedaría contaminado aunque el JSON de nodos estuviera limpio. Con 0, el export no arrastra datos de ejecución.

## 5) Adjuntar como anexo [A-50]

- Adjuntar `export-anexo-saneado.json` como anexo **[A-50]** junto con esta documentación (`docs/secret-sanitization-procedure.md`) y las notas de ops de la migración (`docs/secrets-migration-ops-notes.md`).
- **Nunca** adjuntar el export crudo sin los pasos 2–4.
- **Prerrequisito de seguridad:** la rotación de la clave `service_role` y de la API key de Postiz es condición para considerar el incidente cerrado, independientemente de que el export esté saneado (ver §0.2 y §0.4 de `HALLAZGOS-DEL-FLUJO-n8n.md`). Un export saneado protege al documento; la rotación protege al sistema.

## Chequeo final antes de publicar

| Regla | Comando | Valor esperado |
|---|---|---|
| Sin JWT | `eyJ` | 0 |
| Sin API key de Postiz | `704b5278...` | 0 |
| Sin `Bearer ` | `Bearer ` | 0 |
| Sin header `apikey` literal | `"apikey"` | 0 |
| URL Supabase presente | `supabase.co` | 10 |
| `pinData` vacío | `nodes[] .pinData` | 0 |
| `id` de credenciales placeholdereados | scan visual de `"id"` en `credentials` | `<placeholder>` |
