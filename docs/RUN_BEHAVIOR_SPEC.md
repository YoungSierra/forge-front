# Run / Auto-run — Especificación de comportamiento

_Documento de diseño. Estado: **borrador para revisión** (2026-06-24). No implementar hasta lockear las decisiones marcadas ⚙️._

Cubre el comportamiento de **"Run"** (auto-run) en todos sus alcances: Run de un nodo, Run lane, Run phase y Run all. El foco es: **¿qué pasa cuando un nodo tiene varios outputs y algunos ya están ejecutados/aprobados?** y **¿qué pasa cuando el gate de la fase ya está sellado?**

---

## 1. Modelo de datos (cómo funciona hoy)

### 1.1 Outputs de un nodo
Cada `forge_node` define `outputs[]` (JSONB). Cada output tiene:
- `key` (id estable), `label`, `type` (`connection` | `asset`), `format` (`markdown` | `docx` | `pptx` | `png` | …), `image_gen` (bool).

### 1.2 Sesiones — dos modos (migración 027)
`forge_sessions.output_key` distingue dos tipos de sesión por nodo:

| Tipo | `output_key` | Significado |
|---|---|---|
| **General** | `NULL` | Chat libre / ejecución del nodo completo. Una respuesta cubre "todo el nodo". |
| **Per-output** | `'competitive_scan'`, etc. | Sesión enfocada en **un** output específico. |

El `GET /canvas` arma cada nodo así:
- `session` = última sesión **general** (`output_key NULL`).
- `output_sessions[key]` = última sesión **per-output** por cada key.

### 1.3 Cuándo se considera un nodo "aprobado" (frontend, `approvedNodeIds`)
Un nodo cuenta como aprobado si **cualquiera** de estas es cierta:
1. La sesión **general** está `approved` o `auto_approved`, **o**
2. **Todos** sus outputs tienen una sesión **per-output** `approved`/`auto_approved`.

> ⚠️ Punto clave: hoy una sesión general aprobada "tapa" al nodo entero, aunque no exista ninguna sesión per-output. Y al revés: si no hay general pero todos los per-output están aprobados, también cuenta.

---

## 2. Comportamiento ACTUAL de "Run" (auto-run) — lo que el código hace hoy

Ruta: `POST /canvas/nodes/:project_node_id/auto-run`.

1. **Guard de gate sellado** — consulta `forge_project_blueprints` con `.maybeSingle()` y bloquea (423) si `gate_decision === 'ACCEPT'`.
2. **Siempre crea una sesión GENERAL nueva** (`output_key = NULL`), `status: active`.
3. Llama `buildSystemPrompt` con `targetOutputKey = req.body.target_output_key || null`. En Run all / lane / phase **no se pasa** `target_output_key` → genera el **nodo completo** (todos los outputs en un solo markdown).
4. Crea **un asset** (`status: approved`) con todo el contenido.
5. Cierra la sesión general como **`auto_approved`**.
6. Limpia `is_stale` del nodo y propaga `is_stale=true` a descendientes.

### 2.1 Consecuencias (bugs confirmados)

| # | Problema | Causa |
|---|---|---|
| **A** | Run **re-genera todos los outputs** y **pisa** lo ya aprobado. Si un nodo tiene 2 outputs y 1 ya estaba hecho/aprobado per-output, Run los rehace ambos en una sesión general nueva; el trabajo per-output queda **huérfano**. Gasta costo de nuevo. | auto-run no es per-output-aware: ignora `output_sessions`, siempre crea sesión general y genera el nodo entero. |
| **B** | Un nodo de una fase **ya sellada** (gate ACCEPT) igual corre. | El guard usa `.maybeSingle()`, pero `forge_project_blueprints` acumula varias filas por blueprint (historial). Con >1 fila, `.maybeSingle()` devuelve error + `data=null` → el guard **falla abierto**. Mismo patrón en `run-validate`. |
| **C** | Un nodo "approved" (per-output) pasa a "auto_approved" tras un Run. | Es la consecuencia visible de A: Run creó una sesión general nueva que desplaza el estado per-output previo. |

---

## 3. Comportamiento DESEADO (propuesta a lockear)

> Principio rector (de la conversación): **Run nunca debe rehacer ni pisar un output que el usuario ya ejecutó y aprobó. Solo debe correr lo que falta o quedó stale. El usuario puede entrar manualmente a correr outputs sueltos.**

### 3.1 Unidad de trabajo: **el output**, no el nodo

⚙️ **DECISIÓN 1 — Granularidad de Run.**
**Propuesta (recomendada):** Run opera a nivel **output**. Para cada nodo en el alcance:
1. Calcular el conjunto de outputs **pendientes** (no satisfechos) y **stale**.
2. Generar **solo esos** outputs, cada uno como sesión **per-output** (`target_output_key`), auto-aprobada.
3. **Saltar** outputs ya satisfechos. **Nunca** pisarlos.
4. Si el nodo no tiene outputs pendientes → **saltar el nodo entero** (no crear sesión).

_Alternativa B (menor cambio):_ mantener Run a nivel nodo (sesión general, blob completo) pero **saltar nodos totalmente aprobados**. No resuelve el caso de aprobación parcial (seguiría pisando). **No recomendada.**

### 3.2 Definición de "output satisfecho"
Un output `k` está satisfecho y **no** se vuelve a correr si:
- existe sesión per-output `output_sessions[k]` con `status ∈ {approved, auto_approved}` **y** el nodo **no** está stale; **o**
- ⚙️ **DECISIÓN 2** — ¿una sesión **general** aprobada cuenta como "todos los outputs satisfechos"?
  - **Opción 2A (recomendada):** Sí, retro-compat. Si la sesión general está aprobada y el nodo no está stale, se considera el nodo completo satisfecho (no se corre nada). Cubre nodos viejos hechos con el modelo general/blob.
  - **Opción 2B:** No. Solo cuentan sesiones per-output; una general aprobada se ignora para efectos de Run. Más estricto pero rompe retro-compat con nodos ya hechos en modo blob.

### 3.3 Staleness
Hoy `is_stale` es **por nodo**, no por output. Al correr un upstream, `propagateStale` marca el nodo entero.

⚙️ **DECISIÓN 3 — Granularidad de stale.**
- **Opción 3A (recomendada para v1):** mantener stale **por nodo**. Si el nodo está stale, se re-corren **todos** sus outputs (se asume que el cambio upstream afecta a todo el nodo). Simple, sin migración.
- **Opción 3B:** stale **por output** (nueva columna/estructura). Permite re-correr solo el output afectado. Más preciso, más trabajo (migración + propagación más fina). Diferir.

### 3.4 Gate sellado (fix del bug B)
- Un nodo cuyo blueprint tiene **alguna** fila con `gate_decision = 'ACCEPT'` está **sellado** → Run lo **bloquea siempre** (no corre ninguno de sus outputs).
- Fix: reemplazar `.maybeSingle()` por traer todas las filas del blueprint y sellar si **alguna** es ACCEPT. Aplica a `auto-run` y `run-validate`.
- El usuario solo puede correr nodos de una fase sellada **manualmente** entrando al nodo (⚙️ **DECISIÓN 4** — ¿permitir override manual per-output en fase sellada, o bloqueo total? Propuesta: **bloqueo total** en v1; reabrir el gate es el camino.)

### 3.5 Outputs de imagen (`image_gen`)
Hoy auto-run **no** genera imágenes (solo texto/markdown/docx/pptx). Es la tarea #8 del backlog.

⚙️ **DECISIÓN 5 — Alcance de este trabajo.**
- **Propuesta:** este spec cubre **solo outputs de texto/asset**. Los outputs de imagen (`image_gen === true && format ∈ {png, image}`) quedan **fuera** y se atienden en la tarea #8. Run los **salta** (no los marca como pendientes que bloqueen el nodo) hasta que #8 exista.

---

## 4. Matriz de decisión (resultado esperado de "Run" por nodo)

| Estado del nodo | Outputs | Gate | Resultado de Run |
|---|---|---|---|
| Sin sesiones (idle) | 2 pendientes | abierto | Corre los 2 (per-output) |
| 1 output aprobado, 1 pendiente | parcial | abierto | Corre **solo** el pendiente; respeta el aprobado |
| Todos los outputs aprobados | completo | abierto | **Salta** el nodo (no corre nada) |
| Sesión general aprobada, sin per-output | — | abierto | **Salta** (Opción 2A) / Corre per-output (Opción 2B) |
| Cualquier estado | — | **sellado (ACCEPT)** | **Bloquea** (423 `gate_sealed`) |
| Nodo `auto_approved` + `is_stale` | — | abierto | Re-corre (todos los outputs, Opción 3A) |
| Output de imagen pendiente | imagen | abierto | **Salta** hasta tarea #8 (Decisión 5) |

---

## 5. Impacto en código (cuando se implemente — NO ahora)

- **Backend `auto-run`:** aceptar/derivar lista de outputs pendientes; iterar por output con `target_output_key`; crear sesión **per-output** por cada uno; saltar nodo sin pendientes. Guard de sellado robusto (sin `.maybeSingle()`).
- **Backend `run-validate`:** mismo cálculo de "pendiente" para no marcar error en outputs ya satisfechos; guard de sellado robusto.
- **Frontend `isNodeRunnable` / `runMenu` / `runScope`:** ya ajustado parcialmente (un nodo con todos los outputs aprobados no es runnable). Falta: contar **outputs pendientes**, no nodos; excluir nodos de fase sellada (requiere que el backend exponga `gate_decision` por blueprint o un flag `sealed` por nodo).
- **Conteos del toolbar / menú Run:** alinear denominador (instancias vs DNA distinto — ver nota aparte).

---

## 6. Decisiones a lockear antes de codear

1. **Granularidad de Run** → per-output (3.1, recomendado) vs per-nodo.
2. **Sesión general aprobada cuenta como nodo satisfecho** → 2A (sí, retro-compat) vs 2B (no).
3. **Granularidad de stale** → por nodo (3A, v1) vs por output (3B, diferir).
4. **Fase sellada** → bloqueo total (propuesta) vs permitir override manual per-output.
5. **Outputs de imagen** → fuera de este spec, van en tarea #8 (propuesta).

> Una vez confirmadas, esto se vuelve la base de implementación de **A** (Run per-output-aware) y **B** (guard de sellado robusto).
