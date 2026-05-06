'use client'

import { useState } from 'react'
import type { Project } from '@/lib/types'
import type { CodeGenerationResult } from '@/lib/api'
import { generateCode, approveStep4 } from '@/lib/api'
import GeneratingOverlay from '@/components/shared/GeneratingOverlay'
import ApprovalBar from '@/components/shared/ApprovalBar'
import ScriptViewer from '@/components/shared/ScriptViewer'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

type State = 'idle' | 'generating' | 'review'

interface Props {
  project: Project
  onApproved: () => void
  invalidated?: boolean
}

const ENGINE_ICON: Record<string, string> = {
  unity: '🎮',
  unreal: '⚡',
  godot: '🤖',
  phaser: '🌐',
}

const ENGINE_BADGE: Record<string, string> = {
  unity: 'bg-teal-500/20 text-teal-400 border border-teal-500/30',
  unreal: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  godot: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  phaser: 'bg-violet-500/20 text-violet-400 border border-violet-500/30',
}

const ENGINE_INFO: Record<string, string[]> = {
  unity: [
    'Compatible with Unity 2022.3 LTS+',
    'Scripts use MonoBehaviour pattern',
    'Import via: Assets → Import Package',
  ],
  unreal: ['Compatible with Unreal Engine 5.0+'],
  godot: ['Compatible with Godot 4.0+'],
  phaser: ['Runs in browser with Phaser 3.60'],
}

function fileExt(filename: string): string {
  return filename.includes('.') ? '.' + filename.split('.').pop() : ''
}

function fileBasename(filename: string): string {
  return filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function collectTodos(result: CodeGenerationResult): string[] {
  const todos: string[] = []
  for (const f of result.files) {
    if (!f.content) continue
    for (const line of f.content.split('\n')) {
      if (line.includes('// TODO')) {
        const trimmed = line.trim().slice(0, 60)
        todos.push(trimmed)
        if (todos.length >= 5) return todos
      }
    }
  }
  return todos
}

export default function Step4Code({ project, onApproved, invalidated }: Props) {
  const [state, setState] = useState<State>('idle')
  const [result, setResult] = useState<CodeGenerationResult | null>(null)
  const [activeTab, setActiveTab] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  const engine = project.target_engine || 'unity'

  async function generate() {
    setError(null)
    setState('generating')
    try {
      const res = await generateCode(project.id)
      setResult(res)
      setActiveTab(res.files[0]?.filename ?? 'architecture')
      setState('review')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setState('idle')
    }
  }

  async function handleApprove() {
    if (!result) return
    setApproving(true)
    try {
      await approveStep4(project.id, result)
      onApproved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error approving')
      setApproving(false)
    }
  }

  const mechanics = project.concept?.pipeline?.gdd?.mechanics ?? []

  function activeContent(): string {
    if (!result) return ''
    if (activeTab === 'architecture') return result.architecture_md
    return result.files.find(f => f.filename === activeTab)?.content ?? ''
  }

  function activeEngine(): string {
    if (activeTab === 'architecture') return 'markdown'
    return result?.engine ?? engine
  }

  const todos = result ? collectTodos(result) : []

  return (
    <div className="relative">
      {state === 'generating' && <GeneratingOverlay step={4} />}

      {state === 'idle' && (
        <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
          {invalidated && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm mb-2">
              ⚠️ This step was modified. Regenerate to update the content.
            </div>
          )}
          <div className="w-16 h-16 rounded-2xl bg-[#13151f] border border-slate-800 flex items-center justify-center text-3xl">
            {ENGINE_ICON[engine] ?? '🎮'}
          </div>
          <div>
            <h2 className="text-white font-bold text-xl mb-2">Script Generation</h2>
            <p className="text-slate-500 text-sm">
              AI will generate {engine.charAt(0).toUpperCase() + engine.slice(1)} scripts based on your approved GDD
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${ENGINE_BADGE[engine] ?? ENGINE_BADGE.unity}`}>
            {engine.toUpperCase()}
          </span>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={generate}
            className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
          >
            Generate {engine.charAt(0).toUpperCase() + engine.slice(1)} scripts
          </button>
        </div>
      )}

      {state === 'review' && result && (
        <div className="flex flex-col gap-4 pb-28">

          {/* Phaser-only live preview */}
          {result.engine === 'phaser' && (
            <div className="rounded-xl border border-slate-800 bg-[#0d0f16] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <span className="text-white font-semibold text-sm">▶ Live Preview</span>
                <a
                  href={`${BACKEND_URL}/api/projects/${project.id}/play`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:text-violet-300 text-xs transition-colors"
                >
                  Open fullscreen ↗
                </a>
              </div>
              <iframe
                src={`${BACKEND_URL}/api/projects/${project.id}/play`}
                style={{ width: '100%', height: '400px', border: 'none', display: 'block' }}
              />
              <p className="text-xs text-slate-500 text-center py-2">
                {'← → Move  |  ↑ Jump  |  SHIFT  Dimensional Shift'}
              </p>
            </div>
          )}

          {/* Tab bar */}
          <div className="flex gap-1 border-b border-slate-800 overflow-x-auto">
            {result.files.map(f => {
              const active = activeTab === f.filename
              const ext = fileExt(f.filename)
              const base = fileBasename(f.filename)
              return (
                <button
                  key={f.filename}
                  onClick={() => setActiveTab(f.filename)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                    active
                      ? 'bg-violet-600/20 text-violet-300 border-violet-500'
                      : 'text-slate-500 hover:text-slate-300 border-transparent'
                  }`}
                >
                  {base}
                  {ext && (
                    <span className={`px-1 py-0.5 rounded text-[10px] font-mono ${
                      active ? 'bg-violet-500/30 text-violet-300' : 'bg-slate-800 text-slate-500'
                    }`}>
                      {ext}
                    </span>
                  )}
                </button>
              )
            })}
            <button
              onClick={() => setActiveTab('architecture')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                activeTab === 'architecture'
                  ? 'bg-violet-600/20 text-violet-300 border-violet-500'
                  : 'text-slate-500 hover:text-slate-300 border-transparent'
              }`}
            >
              architecture
              <span className={`px-1 py-0.5 rounded text-[10px] font-mono ${
                activeTab === 'architecture' ? 'bg-violet-500/30 text-violet-300' : 'bg-slate-800 text-slate-500'
              }`}>
                .md
              </span>
            </button>
          </div>

          {/* Code + right panel */}
          <div className="flex gap-6">
            <div className="flex-[13] min-w-0">
              <ScriptViewer
                content={activeContent()}
                engine={activeEngine()}
                filename={activeTab === 'architecture' ? 'architecture.md' : activeTab}
              />
            </div>

            <div className="flex-[7] flex flex-col gap-4 min-w-0">

              {/* Card 1 — Generated Files */}
              <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-5">
                <h3 className="font-bold text-white text-sm mb-3">Generated Files</h3>
                <div className="space-y-2">
                  {result.files.map(f => {
                    const selected = activeTab === f.filename
                    const ext = fileExt(f.filename)
                    return (
                      <button
                        key={f.filename}
                        onClick={() => setActiveTab(f.filename)}
                        className={`w-full text-left flex items-start gap-3 p-2 rounded-lg transition-colors ${
                          selected ? 'bg-violet-600/10 border border-violet-500/30' : 'hover:bg-slate-800/50'
                        }`}
                      >
                        <span className="text-lg mt-0.5">{ext === '.md' ? '📝' : '📄'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-slate-200 truncate">{f.filename}</span>
                            {selected && <span className="text-green-400 text-xs">✓</span>}
                          </div>
                          <p className="text-xs text-slate-500 truncate">{f.description}</p>
                          <p className="text-xs text-slate-600">{formatBytes(f.size_bytes)}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Card 2 — Engine Info */}
              <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-5">
                <h3 className="font-bold text-white text-sm mb-3">Engine Info</h3>
                <div className="space-y-1.5">
                  {(ENGINE_INFO[result.engine] ?? ENGINE_INFO.unity).map((line, i) => (
                    <p key={i} className="text-xs text-slate-400">{line}</p>
                  ))}
                </div>
              </div>

              {/* Card 3 — TODO Summary */}
              {todos.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
                  <h3 className="font-bold text-amber-400 text-sm mb-1">
                    {todos.length} item{todos.length !== 1 ? 's' : ''} need developer attention
                  </h3>
                  <div className="space-y-1 mt-2">
                    {todos.map((t, i) => (
                      <p key={i} className="text-xs font-mono text-amber-300/70 truncate">{t}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Card 4 — Mechanics */}
              <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-5">
                <h3 className="font-bold text-white text-sm mb-3">Mechanics Implemented</h3>
                <ul className="space-y-2">
                  {mechanics.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-violet-400 mt-0.5">▸</span>
                      <span className="text-slate-300">{m.name}</span>
                    </li>
                  ))}
                </ul>
              </div>

            </div>
          </div>
        </div>
      )}

      {state === 'review' && result && (
        <ApprovalBar
          onRegenerate={generate}
          onApprove={handleApprove}
          approveDisabled={approving}
          approveLabel={approving ? 'Approving...' : 'Approve scripts and continue →'}
          centerText={`${project.name} · ${result.files.length} scripts · ${result.engine}`}
        />
      )}
    </div>
  )
}
