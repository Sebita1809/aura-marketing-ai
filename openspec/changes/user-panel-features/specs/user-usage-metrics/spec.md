## ADDED Requirements

### Requirement: Página de métricas del usuario

La ruta protegida `/app/metrics` SHALL mostrar el uso del usuario autenticado, reemplazando el placeholder actual. La página SHALL presentar como mínimo: imágenes generadas, imágenes editadas, publicaciones realizadas y publicaciones programadas pendientes. Todos los valores SHALL corresponder exclusivamente al usuario autenticado.

#### Scenario: Usuario con actividad registrada

- **WHEN** un usuario autenticado con eventos registrados abre `/app/metrics`
- **THEN** ve las cuatro métricas con los totales calculados a partir de sus propios eventos

#### Scenario: Usuario no autenticado

- **WHEN** una sesión sin autenticar intenta acceder a `/app/metrics`
- **THEN** es redirigida al login por la ruta protegida y no se ejecuta ninguna consulta de métricas

#### Scenario: Aislamiento entre usuarios

- **WHEN** dos usuarios distintos abren la página con eventos propios en la base
- **THEN** cada uno ve únicamente sus propios totales y ninguno ve datos del otro

### Requirement: Desglose de publicaciones por red social

La página SHALL mostrar el desglose de publicaciones por red social para las plataformas soportadas (`instagram`, `facebook`, `threads`, `twitter`, `linkedin`), usando los mismos nombres e identidad visual que ya usa la página de Conexiones. Las plataformas sin actividad SHALL mostrarse en cero en vez de omitirse.

#### Scenario: Publicaciones en dos redes

- **WHEN** el usuario publicó cinco veces en Instagram y dos en Facebook
- **THEN** el desglose muestra Instagram 5, Facebook 2, y Threads, X y LinkedIn en 0

#### Scenario: Plataforma desconocida en los datos

- **WHEN** un evento trae un identificador de plataforma fuera de las cinco soportadas
- **THEN** la página no falla y ese evento queda excluido del desglose por plataforma

### Requirement: Selección de rango temporal

La página SHALL permitir acotar las métricas a los últimos 7, 30 o 90 días, o a todo el historial disponible. El cambio de rango SHALL recalcular todas las métricas y el desglose mostrados.

#### Scenario: Cambio de rango

- **WHEN** el usuario pasa de "últimos 30 días" a "últimos 7 días"
- **THEN** los totales y el desglose se recalculan considerando solo los eventos cuyo `occurred_at` cae dentro de los últimos 7 días

#### Scenario: Rango sin actividad

- **WHEN** el usuario tiene eventos antiguos pero ninguno en el rango elegido
- **THEN** la página muestra ceros junto con la indicación de que no hubo actividad en ese rango, sin mostrar datos de otro rango

### Requirement: Publicaciones programadas pendientes

La métrica de publicaciones programadas SHALL contar únicamente los eventos de programación cuya fecha programada es futura respecto del momento de la consulta.

#### Scenario: Programación futura

- **WHEN** existe un evento de programación con fecha dentro de tres días
- **THEN** se cuenta como programada pendiente

#### Scenario: Programación ya vencida

- **WHEN** existe un evento de programación con fecha pasada
- **THEN** no se cuenta como pendiente

### Requirement: Estado vacío y corte histórico explícitos

Cuando no haya eventos para el usuario, la página SHALL mostrar un estado vacío explícito en lugar de ceros sin contexto. La página SHALL comunicar que las métricas existen solo desde la activación del registro de uso y MUST NOT presentar estimaciones, proyecciones ni datos de ejemplo como si fueran reales.

#### Scenario: Usuario sin ningún evento

- **WHEN** un usuario que nunca usó el bot abre la página
- **THEN** ve un mensaje de que todavía no hay actividad registrada, junto con la fecha desde la cual se registra el uso

#### Scenario: Usuario anterior a la instrumentación

- **WHEN** un usuario con uso previo a la activación del tracking abre la página
- **THEN** la página aclara que solo se muestra la actividad posterior a esa fecha y no inventa el historial anterior

### Requirement: Carga, error y consistencia visual

La página SHALL mostrar un estado de carga mientras consulta y un estado de error accionable si la consulta falla. La página SHALL construirse con los componentes existentes del proyecto (`GlassCard`, `MaterialIcon`, `GradientButton`) y el layout de sidebar y header ya usado por las demás páginas del panel, sin agregar dependencias npm nuevas.

#### Scenario: Fallo de consulta

- **WHEN** la consulta de eventos falla
- **THEN** la página muestra un mensaje de error comprensible y una acción para reintentar, sin quedar en carga infinita ni mostrar totales en cero como si fueran reales

#### Scenario: Sin librerías nuevas

- **WHEN** se revisan las dependencias tras implementar la página
- **THEN** `package.json` no incorpora ninguna librería de gráficos ni dependencia nueva
