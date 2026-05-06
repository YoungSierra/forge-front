'use client'

import { useState } from 'react'
import type { Project } from '@/lib/types'
import { exportProject } from '@/lib/api'

interface Props {
  project: Project
}

const ENGINES = ['Unity', 'Phaser', 'Godot', 'Unreal'] as const
type Engine = (typeof ENGINES)[number]

export default function Step6Export({ project }: Props) {
  const [engine, setEngine] = useState<Engine>('Unity')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const characters = project.concept?.pipeline?.gdd?.characters ?? []
  const levels = project.concept?.pipeline?.gdd?.levels ?? []

  async function handleExport() {
    setLoading(true)
    setError(null)
    try {
      const res = await exportProject(project.id, engine)
      const a = document.createElement('a')
      a.href = res.package_url.startsWith('http')
        ? res.package_url
        : `${process.env.NEXT_PUBLIC_BACKEND_URL}${res.package_url}`
      a.download = `${project.name.replace(/\s+/g, '_')}_forge_package.zip`
      a.click()
      setDone(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al exportar')
    } finally {
      setLoading(false)
    }
  }

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 flex flex-col gap-5">
        <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-6">
          <h2 className="text-white font-bold text-lg mb-4">Project summary</h2>
          <div className="space-y-2 text-sm">
            <Row label="Game" value={project.name} />
            <Row label="Genre" value={project.genre} />
            <Row label="Characters" value={`${characters.length} approved`} />
            <Row label="Levels" value={`${levels.length} approved`} />
            <Row label="Status" value="All steps completed" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-6">
          <h3 className="font-bold text-white text-sm mb-4">Target engine</h3>
          <div className="grid grid-cols-2 gap-3">
            {ENGINES.map((e) => (
              <label
                key={e}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  engine === e
                    ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="engine"
                  value={e}
                  checked={engine === e}
                  onChange={() => setEngine(e)}
                  className="accent-violet-500"
                />
                <span className="text-sm font-medium">{e}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-5 text-xs text-slate-500 space-y-1">
          <p>Forge v1.0 · Generado el {today}</p>
          <p>Motor: {engine} · Proyecto: {project.id.slice(0, 8)}</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {done && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 text-green-400 text-sm">
            ✓ Package downloaded successfully
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={loading}
          className={`w-full py-4 rounded-xl font-bold text-sm transition-all ${
            loading
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20'
          }`}
        >
          {loading ? 'Generating package...' : '⬇ Generate and download package'}
        </button>
      </div>

      <div className="flex-1">
        <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-6 h-full">
          <h3 className="font-bold text-white text-sm mb-4">Package structure</h3>
          <div className="font-mono text-xs leading-7 text-slate-400">
            <p className="text-slate-300">Assets/</p>
            <p className="ml-4 text-slate-300">└── Forge/</p>
            <p className="ml-8 text-slate-500">├── Scripts/</p>
            <p className="ml-12 text-slate-500">│   └── <span className="text-green-400">game.js</span></p>
            <p className="ml-8 text-slate-500">├── Sprites/</p>
            {characters.slice(0, 3).map((c, i) => (
              <p key={i} className="ml-12 text-slate-500">
                │   {i < characters.slice(0, 3).length - 1 ? '├' : '└'}── <span className="text-purple-400">{c.name.toLowerCase().replace(/\s+/g, '_')}.png</span>
              </p>
            ))}
            {characters.length > 3 && (
              <p className="ml-12 text-slate-600">│   └── ... ({characters.length - 3} más)</p>
            )}
            <p className="ml-8 text-slate-500">├── Backgrounds/</p>
            {levels.slice(0, 3).map((l, i) => (
              <p key={i} className="ml-12 text-slate-500">
                │   {i < levels.slice(0, 3).length - 1 ? '├' : '└'}── <span className="text-blue-400">level-{l.order}.png</span>
              </p>
            ))}
            {levels.length > 3 && (
              <p className="ml-12 text-slate-600">│   └── ... ({levels.length - 3} más)</p>
            )}
            <p className="ml-8 text-slate-500">├── Audio/</p>
            <p className="ml-12 text-slate-600">│   └── [audio descriptions]</p>
            <p className="ml-8 text-slate-500">└── Docs/</p>
            <p className="ml-12 text-slate-500">    ├── <span className="text-yellow-400">gdd.json</span></p>
            <p className="ml-12 text-slate-500">    └── <span className="text-cyan-400">architecture.md</span></p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-medium">{value}</span>
    </div>
  )
}
