# QA — Auto Image Generation (#8)

Feature: generación automática de imágenes PNG dentro de `auto-run` (Run All / scoped runs).
Antes, los runs automáticos producían texto pero no PNG, y downstream no los encontraba en `forge_assets`.

## Resumen de la implementación (backend, `forge-back`)

- **`src/services/image-gen.service.js`** (nuevo):
  - `generateOneImage()` — provider dispatch (comfyui/openai/fal) + cost log. Devuelve `{ url }`.
  - `parseOutputItems()` — port del frontend **sin** el colapso `png → 1 ítem` (respeta el ADN: N prompts → N imágenes).
  - `imageOutputsOf()` — filtro estricto `image_gen === true && format ∈ {png, image}`.
- **`src/routes/forge-canvas.routes.js`**:
  - Ruta `generate-item-image` adelgazada → usa `generateOneImage` (sin cambio de comportamiento).
  - `executeImageOutput()` — corre el ReAct del output png, parsea N ítems, genera imágenes en paralelo, persiste en `forge_sessions.output_images` **y** crea N filas `forge_assets` png.
  - `pendingImageOutputsForNode()` — mismo criterio "satisfecho" que los outputs de texto.
  - `auto-run` corre **texto primero, imágenes después** (respeta `siblings_if_present`).

Principio rector: **el ADN manda**. El conteo de imágenes no se hardcodea — sale de cuántos prompts produce el agente según el `prompt` del output.

## Manejo de tiempos (importante para el QA)

| Capa | Comportamiento |
|---|---|
| ComfyUI (`comfyui.provider.js`) | Bloqueante: `submit → poll cada 3s → download → upload R2`. Timeout duro **120s/imagen**. |
| `executeImageOutput` | N imágenes en `Promise.all` (concurrentes). Cada una con `.catch()` → un fallo no tumba las demás ni el nodo. |
| Server (`index.js:178`) | `server.timeout = 660_000` (**11 min**). Aguanta la petición larga. |
| Frontend (`autoRunNode`) | Sin timeout de cliente → el browser espera. |

Arquitectura: **request-scoped bloqueante** (mismo patrón que el botón ✦ manual). No hay cola/webhook.

**Riesgos conocidos:**
1. Run All compone concurrencia (tier en paralelo × N jobs/nodo) → puede quemar créditos o dar **402 COMFYUI_CREDITS**.
2. Wall-clock: ~hasta 3 min/nodo; un pipeline grande podría acercarse al techo de 11 min.
3. Sin feedback de progreso durante el auto-run (el nodo se queda "running" más tiempo, no está colgado).
4. Sin retry: imagen con timeout = se pierde (el nodo completa con menos imágenes).

Mitigaciones no implementadas (añadir si el QA lo pide): cap de concurrencia global (semáforo), retry.

---

## Checklist

### 0. Pre-requisitos
- [ ] Backend levantado: `npm run dev` en `forge-back`.
- [ ] `.env` con `COMFYUI_API_KEY`, `COMFYUI_BASE_URL`, `CF_R2_*` válidos y **con créditos** en ComfyUI Cloud.
- [ ] En `/admin/nodes`, el output de imagen (**2.4 `orientation_images`**) tiene `image_gen_model` seteado (ej. `comfyui:<workflow>`). Si está vacío → no genera (esperado, no es bug).
- [ ] Proyecto **nuevo y limpio**.

### 1. Camino feliz (single node)
- [ ] Llevar el proyecto hasta **Phase 02 Concept** (correr Ideation → aceptar gate 1.4).
- [ ] Correr **solo el nodo 2.4** (Run del nodo o scope lane).
- [ ] **Texto:** `image_prompts` (markdown) queda aprobado.
- [ ] **Imágenes:** se generan **N** PNGs, donde **N = nº de prompts que escribió el agente** (NO un número fijo). Valida "el ADN manda".
- [ ] Las imágenes aparecen en el canvas / output modal del nodo.

### 2. Verificación en DB (Supabase, schema v57)
```sql
-- output_images poblado con formato nuevo
select output_images from forge_sessions
where node_id = '<id 2.4>' and output_key = 'orientation_images' order by started_at desc limit 1;
-- → { "orientation_images": [{ "index":0, "variations":[{"url":"...","condition":null}] }, ...] }

-- N filas png en forge_assets (downstream las consume)
select name, format, storage_url, status from forge_assets
where node_id = '<id 2.4>' and format = 'png';

-- cost tracking registró las imágenes
select trigger_type, provider, model from forge_execution_log
where node_id = '<id 2.4>' and trigger_type = 'image_gen';
```

### 3. Respeto al orden (siblings)
- [ ] En logs del backend: `image_prompts` corre **antes** que `orientation_images` (texto → imagen). El prompt de la imagen debe reflejar la paleta/prompts del hermano.

### 4. Idempotencia / no-rehacer (no quemar créditos de más)
- [ ] Re-correr el nodo ya satisfecho → respuesta `{ skipped: true }`, **sin** nuevas imágenes ni filas en `execution_log`.
- [ ] Marcar el nodo **stale** y re-correr → regenera texto **e** imágenes.

### 5. Run All automático (el objetivo de #8)
- [ ] Proyecto limpio → **Run All pipeline** cruzando hasta Concept.
- [ ] El 2.4 genera imágenes **sin click manual**.
- [ ] **Downstream:** el nodo **2.5 Concept Presentation** (PPTX) encuentra las PNGs en `forge_assets` y las incrusta. ← esto es lo que antes fallaba.

### 6. Timing / resiliencia
- [ ] La petición de Run All **no se corta** aunque tarde minutos.
- [ ] Si una imagen falla (timeout/402): el nodo **completa con las demás**; en logs aparece `[auto-run img] item N failed`. No hay crash.

### 7. Regresión — botón ✦ manual (se refactorizó esa ruta)
- [ ] En el chat de un nodo, generar una variación con el botón ✦ → sigue funcionando, hace append a `output_images`. **Comportamiento idéntico al anterior.**

### 8. Edge cases
- [ ] Output con `image_gen_model` vacío → no genera, no crashea.
- [ ] Nodo sin outputs de imagen → idéntico al comportamiento previo (solo texto).

---

## Limitación conocida (v1)
Un nodo cuyo texto ya estaba aprobado **antes** de esta feature (sin imágenes) no las backfillea solo, porque `run-validate` cuenta solo outputs de texto. Workaround: marcarlo **stale** → re-corre todo. No se tocó la capa de validación para no arriesgar el run engine recién hecho.
