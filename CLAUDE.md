@AGENTS.md

# Quick Commands

Cuando el usuario escriba uno de estos comandos, ejecútalo directamente sin pedir confirmación adicional.

| Comando | Acción |
|---|---|
| `QC_COMMIT` | Stage de archivos modificados (sin .env) + commit en forge-front y forge-back con mensaje generado en inglés |
| `QC_PUBLISH` | Igual que QC_COMMIT + corre `npm run build` en forge-front; si el build falla, detener y reportar errores sin pushear. Si pasa limpio, `git push` en ambos repos |
| `QC_STATUS` | `git status` + `git diff --stat` en ambos repos, resumen de qué cambió |
| `QC_BACK` | Indica al usuario que ejecute `! npm run dev` en la terminal del backend para reiniciar |
| `QC_SYNC` | Busca desincronías entre los tipos TypeScript del frontend (`lib/types.ts`) y los campos reales que usa el backend |

Reglas para QC_COMMIT y QC_PUBLISH:
- Nunca incluir archivos `.env` ni archivos con credenciales en el commit
- Mensaje de commit en inglés, describe el "why" no el "what"
- Un commit por repo si hay cambios en ambos
- Añadir siempre: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- QC_PUBLISH es la única excepción a la regla de no pushear sin orden — el comando mismo es la autorización

---

# Forge — Contexto de proyecto

## Stack
- **Frontend:** Next.js 16 + Tailwind v4 — `localhost:3000`
- **Backend:** Node.js / Express — `localhost:8000` (`forge-back/src/`)
- **DB:** Supabase, schema `v57`. Tablas clave:
  - `forge_nodes` — definición DNA de cada nodo (inputs, outputs, executor, tools, skills)
  - `forge_project_nodes` — instancias de nodos en un proyecto (`project_id`, `node_id`, `blueprint_id`)
  - `forge_project_edges` — conexiones entre nodos (`source_node_id`, `target_node_id`, handles)
  - `forge_sessions` — conversaciones activas/aprobadas por nodo (`output_images` JSONB)
  - `forge_messages` — mensajes humano/agente dentro de una sesión
  - `forge_assets` — outputs aprobados de nodos (markdown, document, etc.)
  - `forge_blueprints` — plantillas de secuencias de nodos por fase
  - `forge_project_blueprints` — historial de blueprints cargados por proyecto
  - `projects` — proyecto raíz (`canvas_layout` JSONB, `concept` JSONB)

## Convenciones — OBLIGATORIAS
- Comentarios en código siempre en **español**
- Texto de UI siempre en **inglés**
- **Nunca** hacer `git push` ni deploy sin aprobación explícita del usuario
- **Siempre** buscar si ya existe (componente, función, estado, endpoint, tipo) antes de crear algo nuevo
- No añadir manejo de errores para casos imposibles; confiar en garantías internas del framework

## Arquitectura LLM (backend)
Providers disponibles: `gemini` | `groq` | `together` | `openrouter` | `openai` | `minimax` | `mimo`

- Punto de entrada: `forge-back/src/services/llm.service.js` → `callLLM(systemPrompt, userMsg, options)`
- Cada provider vive en `forge-back/src/services/providers/<nombre>.provider.js`
- Formato de modelo en DB/config: `"provider:model_name"` (ej. `"openai:gpt-4o-mini"`)
- Modelos disponibles en UI: `forge-front/app/admin/nodes/page.tsx` → `MODELS_BY_PROVIDER`

## Arquitectura Canvas (frontend + backend)
- Canvas principal: `forge-front/components/pipeline/ForgeCanvas.tsx`
- Chat de nodo: `forge-front/components/shared/NodeChatWindow.tsx`
- Rutas canvas: `forge-back/src/routes/forge-canvas.routes.js`
- Auto-wiring: `forge-back/src/services/auto-wire.service.js` — conecta outputs→inputs por nombre y tipo aceptado
- El `autoWire()` se llama en: `load-blueprint`, `gate`, `add-node`, `add-asset-node`, y `POST /projects` (creación)

## Imágenes por ítem (feature en progreso)
- `buildItems()` en NodeChatWindow genera `InlineImageItem[]` por cada output con `image_gen: true`
- `buildImageGenComponents()` inyecta botones ✦ inline en el markdown renderizado
- Los URLs generados se guardan en `forge_sessions.output_images` (JSONB por output key + índice)
- **Pendiente:** `parseOutputItems` no captura descripción para formato `### **Variation N:** title` con bold — ver `project_imagegen_pending.md` en memory

## Almacenamiento de assets
- Cloudflare R2: bucket `forge-assets` (assets generales), `feedback-screenshots`, `forge-system-prompts`
- URL pública: `CF_R2_PUBLIC_URL` en `.env`
- Imágenes ComfyUI: deben subirse a ComfyUI Cloud antes de usarse como extras (no pasar URLs externas directamente)
