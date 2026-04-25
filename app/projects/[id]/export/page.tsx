'use client'

import { useEffect, useState } from 'react'
import { getProject } from '@/lib/api'
import type { Project } from '@/lib/types'
import Header from '@/components/layout/Header'
import Step6Export from '@/components/wizard/Step6Export'
import Link from 'next/link'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function ExportPage({ params }: PageProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    params.then(({ id }) =>
      getProject(id)
        .then(setProject)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    )
  }, [params])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-center">
        <div>
          <p className="text-red-400 mb-2">{error ?? 'Project not found'}</p>
          <Link href="/" className="text-violet-400 hover:text-violet-300 text-sm">
            ← Back to home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Header />
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href={`/projects/${project.id}`}
            className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
          >
            ← {project.name}
          </Link>
          <span className="text-slate-700">/</span>
          <span className="text-slate-300 text-sm font-medium">Export</span>
        </div>
        <h1 className="text-2xl font-black text-white mb-8">Export project</h1>
        <Step6Export project={project} />
      </main>
    </div>
  )
}
