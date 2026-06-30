# TDD — Forge Run Engine

**Technical Design Document**

| Campo | Valor |
|---|---|
| **Título** | Forge Run Engine — Run multi-scope, autorización de gates y ejecución per-output |
| **Versión** | 0.1 (borrador para revisión) |
| **Fecha** | 2026-06-24 |
| **Autor** | Equipo Forge (asistido) |
| **Epic** | Forge Engine |
| **Sprints** | 12 (Run multi-scope + Gate Authorization), 13 (Changelog — fuera de scope) |
| **Estado** | 🟡 En diseño — decisiones abiertas pendientes de sign-off (§14) |
| **Docs relacionados** | `docs/RUN_BEHAVIOR_SPEC.md`, memoria `project-task-backlog`, `project-run-all` |

---

## 1. Resumen ejecutivo

Forge ejecuta pipelines de nodos LLM sobre un canvas (React Flow). Hoy el "Run" (auto-run) es **monolítico por nodo**: regenera el nodo completo en una sesión general, ignora el trabajo aprobado a nivel de output, no respeta fases selladas de forma confiable y solo opera sobre el pipeline completo sin alcances acotados ni autorización para cruzar gates.

Este TDD define el **Run Engine** rediseñado, con cuatro capacidades:

1. **Run multi-scope** — ejecutar el pipeline completo, una sola fase (blueprint) o un lane (rama instanciada).
2. **Ejecución per-output-aware** — correr solo los outputs pendientes/stale de cada nodo, sin pisar lo ya aprobado.
3. **Sellado de gates confiable** — bloquear de forma dura la re-ejecución de fases ya aceptadas.
4. **Autorización de gates** — para el Run de pipeline que cruza gates, un plan previo (gates + fan-out + costo) y un modal de autorización (pausar / auto-aceptar, con memoria).

## 2. Objetivos y no-objetivos

### 2.1 Objetivos
- **G1** — Run debe poder acotarse a pipeline / fase / lane.
- **G2** — Run nunca rehace ni sobrescribe un output ya ejecutado y aprobado por el usuario.
- **G3** — Run debe correr únicamente outputs **pendientes** o **stale**.
- **G4** — Una fase con gate `ACCEPT` no debe re-ejecutarse vía Run (garantía dura en backend).
- **G5** — El Run de pipeline que cruza gates requiere autorización explícita del usuario, con opción de recordar la decisión por proyecto.
- **G6** — El usuario obtiene una estimación de costo y alcance antes de un Run de pipeline.
- **G7** — Consistencia entre lo que la UI cuenta como "pendiente" y lo que el backend realmente ejecuta.

### 2.2 No-objetivos
- **NG1** — Generación automática de **imágenes** en runs (outputs `image_gen`). Se trata en tarea separada #8.
- **NG2** — Staleness **por output** (granularidad fina). v1 mantiene stale por nodo.
- **NG3** — Re-ejecución de upstream **fuera** del scope en runs de lane/blueprint (locked: opción A — se asume ya producido).
- **NG4** — Cambios al motor LLM (`runReActLoop`, providers) más allá de cómo se invoca.
- **NG5** — Cancelación a media ejecución de un nodo en curso (solo se corta entre tiers).

## 3. Glosario y modelo de dominio

| Término | Definición |
|---|---|
| **Nodo (DNA)** | `forge_nodes` — definición: `inputs`, `outputs[]`, `role`, `executor`, prompts. |
| **Instancia de nodo** | `forge_project_nodes` — nodo colocado en un proyecto (`blueprint_id`, `lane_id`, `bound_item_ref`). Varias instancias pueden compartir el mismo DNA (`node_id`). |
| **Output** | Entrada de `forge_nodes.outputs[]`: `{ key, label, type, format, image_gen }`. `type` = `connection` (datos wired) \| `asset` (artefacto). |
| **Sesión general** | `forge_sessions` con `output_key = NULL`. Cubre "el nodo completo" (chat libre / blob). |
| **Sesión per-output** | `forge_sessions` con `output_key = '<key>'`. Enfocada en un output. |
| **Blueprint** | `forge_blueprints` — secuencia de nodos de una fase (`phase`, `node_sequence`, `gate`). |
| **Gate** | Punto de decisión al final de una fase (`ACCEPT`/`REFINE`/`KILL`). Registrado en `forge_project_blueprints.gate_decision`. |
| **Fan-out / Lane** | Cuando un output `list<T>` alimenta un input `single<T>` del siguiente blueprint, se instancian N ramas (`forge_lanes`). |
| **Scope** | Alcance de un Run: `pipeline` \| `lane` \| `blueprint`. |
| **Stale** | `forge_project_nodes.is_stale` — output desactualizado por cambio upstream. |
| **Tier** | Nivel topológico del grafo; nodos del mismo tier corren en paralelo. |

### 3.1 Tablas relevantes (schema `v57`)
- `forge_nodes`, `forge_project_nodes`, `forge_project_edges`
- `forge_sessions` (`output_key`, `status`, `output_asset_id`, `output_images`)
- `forge_assets`, `forge_blueprints`, `forge_project_blueprints` (`gate_decision`, `trigger`, `loaded_at`)
- `forge_lanes` (`lane_key`, `label`, `color`, `bound_item_ref`)
- `forge_execution_log` (costos), `projects` (`canvas_layout`, `concept`, **`run_config`** nuevo)

### 3.2 Estados de sesión
`active` → `approved` (manual) \| `auto_approved` (autopilot) ; `REFINE`/`KILL` aplican a nivel gate, no sesión.

## 4. Arquitectura actual (as-is)

### 4.1 Archivos clave
| Capa | Archivo | Rol |
|---|---|---|
| FE canvas | `components/pipeline/ForgeCanvas.tsx` | `runScope`/`executeRunScope`, `isNodeRunnable`, `runMenu`, tiers, modal de autorización |
| FE toolbar | `components/pipeline/ForgeToolbar.tsx` | Dropdown `▶ Run` por scope |
| FE API | `lib/api.ts` | `runValidate`, `runPlan`, `saveRunConfig`, `autoRunNode` |
| FE tipos | `lib/types.ts` | `RunScope` |
| BE rutas | `src/routes/forge-canvas.routes.js` | `/run-validate`, `/run-plan`, `/run-config`, `/auto-run`, `/gate`, `/` |
| BE chat | `src/services/canvas-chat.service.js` | `buildSystemPrompt`, `runReActLoop`, `propagateStale` |
| BE fan-out | `src/services/fan-out.service.js` | `fanOut`, `detectFanOut`, `classifySequenceNodes` |
| BE wiring | `src/services/auto-wire.service.js` | `autoWire`, `cleanupAndRewire` |
| BE costo | `src/services/execution-log.service.js` | `logExecution`, `calculateLLMCost`, `LLM_PRICING` |

### 4.2 Flujo de Run actual
```
runScope(scope)
  └─ runValidate(project, scope)            # valida inputs requeridos
  └─ topoTiers(nodes, edges)                # ordena por dependencias
  └─ for tier in tiers:                     # secuencial entre tiers
       Promise.allSettled(autoRunNode×tier) # paralelo dentro del tier
  └─ loadCanvas()                           # recarga estado
```

`autoRunNode` → `POST /auto-run` →
```
guard gate_sealed (.maybeSingle)   # FRÁGIL (§5 bug B)
crear sesión GENERAL (output_key NULL)
buildSystemPrompt(targetOutputKey = null)   # genera NODO COMPLETO
runReActLoop
crear asset (approved) con todo el contenido
cerrar sesión = auto_approved
limpiar is_stale + propagateStale(descendientes)
```

### 4.3 Estado de implementación parcial (ya en working tree, sin commitear)
- ✅ #1 Run scope-aware (`runScope`/`executeRunScope`, `run-validate` filtra por scope).
- ✅ #2 UI multi-scope (dropdown toolbar `runMenu`, botón ▶ en `LaneGroupNode`).
- ✅ #3 (parcial) `gate_sealed` en `run-validate` + `auto-run` (pero con bug B).
- ✅ #4 (parcial) migración `032_run_config`, `detectFanOut`, `POST /run-plan`, `PATCH /run-config`, modal de autorización.
- ⬜ #5 loop gate-crossing, #6 QA, #8 imágenes.

## 5. Problema (gaps confirmados)

| ID | Severidad | Descripción | Causa raíz |
|---|---|---|---|
| **A** | Alta | Run regenera todos los outputs y **pisa** lo aprobado per-output. | `auto-run` crea sesión general y genera el nodo completo; ignora `output_sessions`. |
| **B** | Alta | Nodos de fase **sellada** igual corren. | Guard usa `.maybeSingle()` sobre `forge_project_blueprints`, que tiene >1 fila por blueprint → falla abierto. |
| **C** | Media | Nodo "approved" → "auto_approved" tras Run. | Síntoma visible de A. |
| **D** | Media | Conteos inconsistentes: "Run (15)" vs "1/11 approved". | `runnableCount` cuenta **instancias**; `totalCount` deduplica por DNA (`Set`). Además `isNodeRunnable` ignoraba outputs per-output (ya parcialmente corregido). |
| **E** | Media | `active_blueprint` resuelve a la fase **sellada** (Ideation) en vez de la viva (Concept). | Resolución por `loaded_at desc` con posible `loaded_at` null/orden incorrecto en la fila de fan-out. Afecta `run-plan` (parte del blueprint activo). |
| **F** | Baja | Badge ⚠ stale en nodos idle. | `propagateStale` marca descendientes sin output. (Mitigado en FE; raíz en BE.) |

## 6. Diseño propuesto (to-be)

### 6.1 Principio rector
> **Run nunca rehace ni pisa un output ya ejecutado/aprobado. Solo corre outputs pendientes o stale. El resto se corre manualmente. Una fase sellada está bloqueada.**

### 6.2 Run per-output-aware (resuelve A, C, D)

La unidad de trabajo pasa a ser el **output**, no el nodo.

**Cálculo de outputs pendientes de un nodo** (fuente única, compartida FE/BE):
```
pendingOutputs(node):
  if nodo sellado(gate ACCEPT): return []          # bloqueado (§6.3)
  outs = node.outputs filtrando NO image_gen        # NG1: imágenes fuera
  if outs vacío: return []
  if sesión general approved/auto_approved AND !is_stale: return []   # DECISIÓN 2A
  pending = []
  for o in outs:
    s = output_sessions[o.key]
    satisfecho = s.status ∈ {approved, auto_approved} AND !is_stale
    if not satisfecho: pending.push(o.key)
  return pending
```

**Ejecución (`auto-run` rediseñado):**
- Recibe `target_output_key` opcional. Si viene → corre **solo** ese output. Si no → corre **todos los pendientes** del nodo, **uno por uno**, cada uno como sesión **per-output** (`output_key = key`), auto-aprobada.
- Nodo sin pendientes → **no-op** (204 / `skipped: true`), no crea sesión.
- Outputs ya satisfechos → intactos.

**Nota de compatibilidad:** se deja de usar la sesión **general** para Run (queda solo para chat libre manual). DECISIÓN 2A mantiene que una general aprobada previa "tapa" el nodo (retro-compat con nodos viejos en blob).

### 6.3 Sellado de gates confiable (resuelve B)

Helper backend `isBlueprintSealed(project_id, blueprint_id)`:
```sql
SELECT gate_decision FROM forge_project_blueprints
WHERE project_id = ? AND blueprint_id = ?
-- sellado si ALGUNA fila tiene gate_decision = 'ACCEPT'
```
Sin `.maybeSingle()`. Se usa en `auto-run` (bloqueo 423 `gate_sealed`), `run-validate` (error `gate_sealed`) y el loop de pipeline (§6.5).

El FE necesita saber qué nodos están sellados → el `GET /canvas` expone `sealed: boolean` por nodo (o `gate_decision` por blueprint). `isNodeRunnable` excluye sellados.

### 6.4 Autorización de gates — run-plan + modal + run_config (#4)

**`POST /canvas/run-plan`** (solo scope `pipeline`): construye la cadena de fases desde el blueprint activo, detecta fan-out por gate inmediato (`detectFanOut`, read-only), estima costo (promedio por sesión de `forge_execution_log` × node_runs, con multiplicador de lanes), devuelve `{ phases, gates, estimated, requires_authorization, remembered }`.

**Modal (FE):** lista de fases + gates con fan-out + costo; radio **pause** / **auto_accept**; checkbox **remember**. `confirmRunPlan` → persiste en `run_config` si remember, luego ejecuta.

**`PATCH /canvas/run-config`:** merge no destructivo en `projects.run_config.gate_authorization = { mode, remember }`.

> Dependencia: corregir bug E (resolución de `active_blueprint`) para que la cadena de fases parta del lugar correcto.

### 6.5 Loop full-pipeline gate-crossing (#5)

Consume `run_config.gate_authorization.mode`:
```
runPipelineLoop():
  loop:
    correr fase actual (tiers, per-output-aware)
    evaluar gate de la fase
    if gate no listo: break
    if mode == 'pause': pausar → UI muestra gate → esperar decisión usuario
    if mode == 'auto_accept':
        POST /gate ACCEPT  → sella fase + carga siguiente + fan-out
        recargar canvas → recomputar tiers (incluye nuevas lanes)
    if no hay siguiente fase: break
```
Requiere hardening de `/gate ACCEPT` **idempotente** (re-entradas no deben duplicar lanes/edges).

## 7. Cambios de modelo de datos

| Migración | Cambio | Estado |
|---|---|---|
| `032_run_config.sql` | `ALTER TABLE projects ADD COLUMN run_config JSONB NOT NULL DEFAULT '{}'` | ✅ aplicada |
| (sin migración) | `run_config.gate_authorization = { mode: 'pause'\|'auto_accept', remember: bool }` | Convención JSONB |
| (diferido, NG2) | staleness por output (nueva estructura) | ❌ fuera de scope |

No se requieren migraciones adicionales para per-output (usa `forge_sessions.output_key` ya existente, migración 027).

## 8. Contrato de API

### 8.1 `POST /api/projects/:id/canvas/run-validate`
**Req:** `{ type: 'pipeline'|'lane'|'blueprint', lane_id?, blueprint_id? }`
**Res:** `{ success, valid, errors: RunValidateError[] }`
`RunValidateError.type ∈ { unreviewed_session, missing_input, empty_source, gate_sealed }`

### 8.2 `POST /api/projects/:id/canvas/run-plan`
**Req:** `RunScope`
**Res:**
```ts
{
  requires_authorization: boolean
  phases: { blueprint_id, name, phase, node_count, is_current, sealed }[]
  gates:  { blueprint_id, name, will_fan_out, configured, item_count, item_type }[]
  estimated: { node_runs, avg_cost_per_node, cost_usd, is_estimated } | null
  remembered: { mode } | null
}
```

### 8.3 `PATCH /api/projects/:id/canvas/run-config`
**Req:** `{ gate_authorization: { mode, remember } }` → **Res:** `{ success, run_config }`

### 8.4 `POST /api/projects/:id/canvas/nodes/:project_node_id/auto-run` (rediseñado)
**Req:** `{ member_id?, target_output_key? }`
**Res (éxito):** `{ success, ran: string[], skipped: string[], sessions: {...} }`
**Res (sellado):** `423 { success:false, error_code:'gate_sealed' }`
**Res (nada que correr):** `{ success:true, ran:[], skipped:[...] }`

### 8.5 `GET /api/projects/:id/canvas` (extensión)
Agregar por nodo: `sealed: boolean`. (O `active_blueprint` corregido + `gate_decision` por blueprint.)

## 9. Cambios de frontend

| Componente | Cambio |
|---|---|
| `isNodeRunnable` | ✅ ya excluye nodos con todos los outputs aprobados. Falta: excluir **sellados** (`node.sealed`); contar **outputs pendientes**. |
| `runnableCount` / `runMenu` | Denominador = outputs pendientes (no instancias crudas). Alinear con "approved/total". |
| `runScope`/`executeRunScope` | ✅ wrapper con run-plan/modal hecho. Falta: loop gate-crossing (#5) consumiendo `mode`. |
| Modal autorización | ✅ implementado. |
| `ForgeNodeCard` | ✅ badge/borde stale solo si hay output (`showStale`). |

## 10. Flujos (secuencia)

### 10.1 Run lane (no cruza gate)
```
Usuario ▶ Run (lane) → runScope({lane}) → run-validate(lane)
  → tiers ∩ lane → auto-run per nodo (solo outputs pendientes) → loadCanvas
```

### 10.2 Run pipeline (cruza gates)
```
Usuario ▶ Run all → runScope({pipeline}) → run-plan
  ├─ requires_authorization && !remembered → MODAL
  │     usuario elige mode + remember → confirmRunPlan → (saveRunConfig)
  └─ runPipelineLoop(mode):
        correr fase (per-output) → gate
          → pause: detener, mostrar gate
          → auto_accept: POST /gate ACCEPT → fan-out → recargar → recomputar tiers → repetir
```

## 11. Matriz de decisión (resultado de Run por nodo)

| Estado nodo | Gate | Resultado |
|---|---|---|
| idle, 2 outputs pendientes | abierto | corre los 2 (per-output) |
| 1 output aprobado + 1 pendiente | abierto | corre **solo** el pendiente |
| todos los outputs aprobados | abierto | **salta** el nodo |
| sesión general aprobada (sin per-output) | abierto | **salta** (Decisión 2A) |
| cualquiera | **sellado** | **bloquea** (423) |
| auto_approved + stale | abierto | re-corre todos (Decisión 3A) |
| output imagen pendiente | abierto | **salta** (NG1, va en #8) |

## 12. Estrategia de pruebas

- **Unitarias (BE):** `pendingOutputs`, `isBlueprintSealed`, `detectFanOut`, estimación de costo.
- **Integración (BE):** auto-run per-output (no pisa aprobados); guard sellado con múltiples filas de blueprint; run-validate por scope.
- **E2E (#6):** los 3 scopes; pre-gate lock; persistencia `remember`; pipeline cruza gates con auto_accept; sin edges/lanes basura; conteos consistentes UI↔ejecución.
- **Regresión:** retro-compat con nodos viejos en sesión general (Decisión 2A); fan-out idempotente en re-ACCEPT.

## 13. Rollout

1. Bug B (guard sellado robusto) + bug E (resolución `active_blueprint`) — **bajo riesgo, primero**.
2. `GET /canvas` expone `sealed` + `isNodeRunnable` lo usa.
3. Run per-output-aware (`auto-run` + `pendingOutputs` compartido) — **núcleo**.
4. Loop gate-crossing (#5) consumiendo `run_config`.
5. QA E2E (#6).
6. (Aparte) Imágenes en runs (#8).

Sin feature flags: cambios incrementales, cada paso deja el sistema funcional. Nada se commitea/pushea sin aprobación explícita del usuario.

## 14. Decisiones abiertas (requieren sign-off)

| # | Decisión | Propuesta |
|---|---|---|
| 1 | Granularidad de Run | **Per-output** |
| 2 | ¿Sesión general aprobada tapa el nodo? | **Sí (2A)** retro-compat |
| 3 | Granularidad de stale | **Por nodo (3A)** en v1 |
| 4 | Nodo en fase sellada | **Bloqueo total**; reabrir gate es el camino |
| 5 | Outputs de imagen | **Fuera** (tarea #8) |
| 6 | Conteo del toolbar | ¿mostrar **outputs pendientes** o **instancias** o **DNA distinto**? Propuesta: outputs pendientes |

## 15. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Per-output rompe nodos viejos (modo blob) | Alto | Decisión 2A: general aprobada sigue tapando |
| `/gate ACCEPT` no idempotente duplica lanes en el loop | Alto | Hardening idempotente (#5) antes del loop |
| Costo estimado impreciso | Bajo | Marcado `is_estimated`; promedio histórico por sesión |
| `active_blueprint` mal resuelto desvía run-plan | Medio | Corregir bug E primero |
| Latencia de runs grandes (muchas lanes × outputs) | Medio | Paralelizar dentro de tier; per-output secuencial por nodo |

## 16. Mapeo a backlog

| Tarea backlog | Sección TDD |
|---|---|
| #1 Run engine + scoped validation | §4.3, §6.2, §8.1 — ✅ base hecha |
| #2 Scoped runs UI | §9 — ✅ hecho |
| #3 Pre-gate lock | §6.3, §8.4 — fix bug B pendiente |
| #4 Gate authorization | §6.4, §8.2/8.3 — ✅ base hecha |
| #5 Gate-crossing loop | §6.5, §10.2 |
| #6 E2E QA | §12 |
| #8 Imágenes en runs | NG1 (fuera) |
| **Nuevo** Bug B/E/per-output | §6.2, §6.3, §5 |

---

_Fin del TDD v0.1. Pendiente: sign-off de §14 antes de implementación._
