import type { GDD } from './types'

function esc(s: unknown): string {
  if (s == null) return '–'
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ability(a: unknown): string {
  if (typeof a === 'string') return esc(a)
  if (typeof a === 'object' && a !== null) return esc((a as Record<string, unknown>).name ?? JSON.stringify(a))
  return esc(a)
}

export function exportGDDToPDF(gdd: GDD) {
  const DIFF_ICON: Record<string, string> = { easy: '●', medium: '◆', hard: '▲', boss: '★' }
  const ROLE_ICON: Record<string, string>  = { hero: '◈', enemy: '✖', npc: '◉', boss: '♛' }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GDD — ${esc(gdd.project.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 20mm 18mm 22mm; }

  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    font-size: 10.5pt;
    color: #111;
    background: #fff;
    line-height: 1.55;
  }

  /* ── typography ── */
  h1 { font-size: 28pt; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 6pt; }
  h2 { font-size: 13pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
       border-bottom: 1.5pt solid #111; padding-bottom: 4pt; margin: 22pt 0 10pt; color: #111; }
  h3 { font-size: 11pt; font-weight: 700; margin-bottom: 3pt; color: #111; }
  p  { margin-bottom: 6pt; }
  em { color: #444; }

  /* ── layout ── */
  .cover    { padding-bottom: 20pt; border-bottom: 2pt solid #111; margin-bottom: 18pt; }
  .meta-grid{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8pt; margin: 12pt 0; }
  .meta-cell{ border: 1pt solid #d0d0d0; border-radius: 4pt; padding: 6pt 9pt; }
  .meta-key { font-family: monospace; font-size: 7.5pt; text-transform: uppercase;
              letter-spacing: 0.1em; color: #888; margin-bottom: 2pt; }
  .meta-val { font-size: 10.5pt; font-weight: 600; }

  .card     { border: 1pt solid #d0d0d0; border-radius: 5pt; padding: 10pt 13pt; margin-bottom: 8pt;
              break-inside: avoid; }
  .badge    { display: inline-block; font-family: monospace; font-size: 7.5pt; text-transform: uppercase;
              letter-spacing: 0.07em; border: 1pt solid; border-radius: 99pt;
              padding: 1.5pt 7pt; margin-right: 4pt; }
  .badge-role-hero       { border-color: #7c3aed; color: #7c3aed; }
  .badge-role-enemy      { border-color: #dc2626; color: #dc2626; }
  .badge-role-npc        { border-color: #0891b2; color: #0891b2; }
  .badge-role-boss       { border-color: #9333ea; color: #9333ea; }
  .badge-type-core       { border-color: #2563eb; color: #2563eb; }
  .badge-type-secondary  { border-color: #6b7280; color: #6b7280; }
  .badge-type-progression{ border-color: #16a34a; color: #16a34a; }
  .badge-diff-easy       { border-color: #16a34a; color: #16a34a; }
  .badge-diff-medium     { border-color: #ca8a04; color: #ca8a04; }
  .badge-diff-hard       { border-color: #dc2626; color: #dc2626; }
  .badge-diff-boss       { border-color: #9333ea; color: #9333ea; }

  .prompt-box { background: #f5f5f5; border-left: 3pt solid #aaa; padding: 6pt 10pt;
                font-family: monospace; font-size: 8.5pt; color: #444; line-height: 1.6;
                margin-top: 7pt; border-radius: 0 3pt 3pt 0; }
  .prompt-label{ font-size: 7pt; text-transform: uppercase; letter-spacing: 0.1em;
                 color: #888; margin-bottom: 3pt; }

  .abilities { display: flex; flex-wrap: wrap; gap: 4pt; margin: 5pt 0; }
  .ability   { font-family: monospace; font-size: 8pt; background: #f0f0f0;
               border: 1pt solid #ddd; padding: 1pt 6pt; border-radius: 3pt; }

  .tags      { display: flex; flex-wrap: wrap; gap: 4pt; margin-top: 4pt; }
  .tag       { font-family: monospace; font-size: 7.5pt; color: #666;
               background: #f5f5f5; border: 1pt solid #e0e0e0;
               padding: 1pt 6pt; border-radius: 3pt; }

  .two-col   { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; }
  .dir-grid  { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8pt; margin-bottom: 10pt; }
  .dir-cell  { padding: 6pt 9pt; background: #fafafa; border: 1pt solid #e0e0e0; border-radius: 4pt; }

  .feat-row  { display: flex; gap: 8pt; font-size: 10pt; margin-bottom: 4pt; }
  .feat-bullet { flex-shrink: 0; font-weight: 700; }
  .feat-ok   { color: #16a34a; }
  .feat-no   { color: #dc2626; }
  .feat-warn { color: #ca8a04; }

  .mech-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; }

  .page-break { break-before: page; }

  .footer { position: fixed; bottom: 10mm; left: 0; right: 0;
            text-align: center; font-family: monospace; font-size: 7.5pt; color: #bbb; }

  @media screen { body { max-width: 820px; margin: 0 auto; padding: 40px 48px; } }
</style>
</head>
<body>

<!-- ── Cover ── -->
<div class="cover">
  <h1>${esc(gdd.project.name)}</h1>
  <div style="margin-bottom:8pt;">
    <span class="badge badge-type-core" style="border-color:#111;color:#111;">${esc(gdd.project.genre)}</span>
    <span class="badge" style="border-color:#555;color:#555;">${esc(gdd.project.tone)}</span>
    ${gdd.project.target_platform ? `<span class="badge" style="border-color:#888;color:#888;">${esc(gdd.project.target_platform)}</span>` : ''}
  </div>
  <p><em>${esc(gdd.project.elevator_pitch)}</em></p>

  <div class="meta-grid">
    ${[
      ['Engine', gdd.development.suggested_engine],
      ['Scope', gdd.development.estimated_scope],
      ['Camera', gdd.project.camera ?? '–'],
    ].map(([k, v]) => `
      <div class="meta-cell">
        <div class="meta-key">${esc(k)}</div>
        <div class="meta-val">${esc(v)}</div>
      </div>`).join('')}
  </div>

  ${gdd.project.core_loop ? `
  <div style="background:#f5f5f5;border:1pt solid #d0d0d0;border-radius:4pt;padding:9pt 13pt;">
    <div class="meta-key" style="margin-bottom:4pt;">Core Loop</div>
    <p style="margin:0;font-size:10.5pt;">${esc(gdd.project.core_loop)}</p>
  </div>` : ''}
</div>

<!-- ── Mechanics ── -->
<h2>Mechanics <span style="font-size:9pt;font-weight:400;color:#888;">(${gdd.mechanics.length})</span></h2>
<div class="mech-grid">
${gdd.mechanics.map(m => `
  <div class="card">
    <div style="display:flex;align-items:center;gap:8pt;margin-bottom:5pt;">
      <h3 style="flex:1;margin:0;">${esc(m.name)}</h3>
      <span class="badge badge-type-${m.type}">${esc(m.type)}</span>
    </div>
    <p style="margin:0;font-size:10pt;color:#333;">${esc(m.description)}</p>
    ${m.gameplay_tags?.length ? `<div class="tags">${m.gameplay_tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
  </div>`).join('')}
</div>

<!-- ── Characters ── -->
<h2 class="page-break">Characters <span style="font-size:9pt;font-weight:400;color:#888;">(${gdd.characters.length})</span></h2>
${gdd.characters.map(c => `
<div class="card">
  <div style="display:flex;align-items:flex-start;gap:12pt;">
    <div style="font-size:22pt;line-height:1;flex-shrink:0;padding-top:2pt;">${ROLE_ICON[c.role] ?? '◈'}</div>
    <div style="flex:1;">
      <div style="display:flex;align-items:center;gap:8pt;margin-bottom:5pt;">
        <h3 style="margin:0;">${esc(c.name)}</h3>
        <span class="badge badge-role-${c.role}">${esc(c.role)}</span>
      </div>
      <p style="margin-bottom:4pt;color:#333;">${esc(c.description)}</p>
      ${c.personality ? `<p style="margin-bottom:6pt;font-style:italic;color:#555;font-size:10pt;">${esc(c.personality)}</p>` : ''}
      ${c.abilities?.length ? `<div class="abilities">${c.abilities.map(a => `<span class="ability">${ability(a)}</span>`).join('')}</div>` : ''}
      ${c.gameplay_tags?.length ? `<div class="tags">${c.gameplay_tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${c.sprite_prompt ? `
      <div class="prompt-box">
        <div class="prompt-label">Sprite Prompt</div>
        ${esc(c.sprite_prompt)}
      </div>` : ''}
    </div>
  </div>
</div>`).join('')}

<!-- ── Levels ── -->
<h2 class="page-break">Levels <span style="font-size:9pt;font-weight:400;color:#888;">(${gdd.levels.length})</span></h2>
${gdd.levels.map((l, i) => `
<div class="card">
  <div style="display:flex;align-items:center;gap:10pt;margin-bottom:6pt;">
    <span style="font-family:monospace;font-size:14pt;font-weight:700;color:#bbb;">${String(l.order ?? i + 1).padStart(2, '0')}</span>
    <h3 style="flex:1;margin:0;">${esc(l.name)}</h3>
    <span class="badge badge-diff-${l.difficulty ?? ''}">${DIFF_ICON[l.difficulty ?? ''] ?? ''} ${esc(l.difficulty)}</span>
    <span class="badge" style="border-color:#888;color:#666;">${esc(l.environment)}</span>
  </div>
  <p style="margin-bottom:5pt;color:#333;">${esc(l.description)}</p>
  ${l.objectives?.length ? `
  <div style="margin-bottom:5pt;">
    ${l.objectives.map(o => `<div class="feat-row"><span class="feat-bullet feat-ok">›</span><span>${esc(o)}</span></div>`).join('')}
  </div>` : ''}
  ${l.introduced_mechanics?.length ? `
  <div class="tags" style="margin-bottom:5pt;">
    <span style="font-family:monospace;font-size:7.5pt;color:#888;margin-right:4pt;">introduces:</span>
    ${l.introduced_mechanics.map(mid => `<span class="tag" style="border-color:#2563eb;color:#2563eb;">${esc(mid)}</span>`).join('')}
  </div>` : ''}
  ${l.background_prompt ? `
  <div class="prompt-box">
    <div class="prompt-label">Background Prompt</div>
    ${esc(l.background_prompt)}
  </div>` : ''}
</div>`).join('')}

<!-- ── Direction ── -->
<div class="page-break">
<h2>Art Direction</h2>
<div class="dir-grid">
  ${[
    ['Style', gdd.art_direction.style],
    ['Palette', gdd.art_direction.palette],
    ['Sprite res.', gdd.art_direction.sprite_resolution ?? gdd.art_direction.resolution ?? '–'],
    ['Background res.', gdd.art_direction.background_resolution ?? '–'],
    ['Lighting', gdd.art_direction.lighting_style ?? '–'],
    ['UI style', gdd.art_direction.ui_style ?? '–'],
  ].map(([k, v]) => `
    <div class="dir-cell">
      <div class="meta-key">${esc(k)}</div>
      <div style="font-size:10.5pt;font-weight:600;">${esc(v)}</div>
    </div>`).join('')}
</div>
${gdd.art_direction.references?.length ? `
<div style="margin-bottom:14pt;">
  <div class="meta-key" style="margin-bottom:5pt;">References</div>
  <div class="tags">
    ${gdd.art_direction.references.map(r => `<span class="tag" style="border-color:#7c3aed;color:#7c3aed;">${esc(r)}</span>`).join('')}
  </div>
</div>` : ''}

<h2>Audio Direction</h2>
<div class="dir-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;">
  ${[
    ['Music Mood', gdd.audio_direction.music_mood],
    ['Music Style', gdd.audio_direction.music_style],
    ['Adaptive', gdd.audio_direction.adaptive_audio ?? '–'],
  ].map(([k, v]) => `
    <div class="dir-cell">
      <div class="meta-key">${esc(k)}</div>
      <div style="font-size:10.5pt;font-weight:600;">${esc(v)}</div>
    </div>`).join('')}
</div>
${gdd.audio_direction.sfx_notes ? `
<div class="card" style="margin-top:0;">
  <div class="meta-key" style="margin-bottom:4pt;">SFX Notes</div>
  <p style="margin:0;">${esc(gdd.audio_direction.sfx_notes)}</p>
</div>` : ''}
</div>

<!-- ── Development ── -->
<h2 class="page-break">Development</h2>
<div class="two-col">
  <div>
    ${gdd.development.core_features?.length ? `
    <div class="card">
      <div class="meta-key" style="margin-bottom:6pt;color:#16a34a;">Core Features</div>
      ${gdd.development.core_features.map(f => `
        <div class="feat-row">
          <span class="feat-bullet feat-ok">›</span>
          <span>${esc(typeof f === 'string' ? f : (f as Record<string,unknown>).name ?? JSON.stringify(f))}</span>
        </div>`).join('')}
    </div>` : ''}
  </div>
  <div>
    ${gdd.development.out_of_scope?.length ? `
    <div class="card">
      <div class="meta-key" style="margin-bottom:6pt;color:#dc2626;">Out of Scope</div>
      ${gdd.development.out_of_scope.map(f => `
        <div class="feat-row">
          <span class="feat-bullet feat-no">✕</span>
          <span style="color:#555;">${esc(typeof f === 'string' ? f : (f as Record<string,unknown>).name ?? JSON.stringify(f))}</span>
        </div>`).join('')}
    </div>` : ''}
  </div>
</div>
${gdd.development.technical_risks?.length ? `
<div class="card">
  <div class="meta-key" style="margin-bottom:6pt;color:#ca8a04;">Technical Risks</div>
  ${gdd.development.technical_risks.map(r => `
    <div class="feat-row">
      <span class="feat-bullet feat-warn">⚡</span>
      <span>${esc(r)}</span>
    </div>`).join('')}
</div>` : ''}

${gdd.systems && Object.values(gdd.systems).some(Boolean) ? `
<h2>Game Systems</h2>
${Object.entries(gdd.systems).filter(([, v]) => v).map(([k, v]) => `
  <div class="card">
    <div class="meta-key" style="margin-bottom:4pt;">${esc(k.replace(/_/g, ' '))}</div>
    <p style="margin:0;">${esc(v as string)}</p>
  </div>`).join('')}
` : ''}

<div class="footer">Game Design Document · ${esc(gdd.project.name)} · Generated by FORGE</div>

<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
}
