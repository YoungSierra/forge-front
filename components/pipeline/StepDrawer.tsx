'use client'

import { useEffect } from 'react'
import type { Project } from '@/lib/types'
import GDDCanvas from '@/components/gdd/GDDCanvas'
import Step2Sprites from '@/components/wizard/Step2Sprites'
import Step3Levels from '@/components/wizard/Step3Levels'
import Step4Code from '@/components/wizard/Step4Code'
import Step5Audio from '@/components/wizard/Step5Audio'
import Step6Export from '@/components/wizard/Step6Export'
import { CATEGORY_COLOR, type NodeCategory } from './constants'

const STEP_FOR_NODE: Record<string, { label: string; category: NodeCategory; stepKey: string }> = {
  gdd: { label: 'Game Design Document', category: 'gdd', stepKey: 'gdd' },
  'gdd-gate': { label: 'GDD Review', category: 'gate', stepKey: 'gdd' },
  sprites: { label: 'Sprites Generation', category: 'sprites', stepKey: 'sprites' },
  'sprites-gate': { label: 'Sprites Review', category: 'gate', stepKey: 'sprites' },
  levels: { label: 'Levels Generation', category: 'levels', stepKey: 'levels' },
  'levels-gate': { label: 'Levels Review', category: 'gate', stepKey: 'levels' },
  code: { label: 'Code Generation', category: 'code', stepKey: 'code' },
  'code-gate': { label: 'Code Review', category: 'gate', stepKey: 'code' },
  audio: { label: 'Audio Generation', category: 'audio', stepKey: 'audio' },
  'audio-gate': { label: 'Audio Review', category: 'gate', stepKey: 'audio' },
  export: { label: 'Export Project', category: 'export', stepKey: 'export' },
}

interface Props {
  nodeId: string | null
  project: Project
  onClose: () => void
  onRefresh: () => void
}

export default function StepDrawer({ nodeId, project, onClose, onRefresh }: Props) {
  const open = nodeId !== null
  const meta = nodeId ? STEP_FOR_NODE[nodeId] : null
  const color = meta ? CATEGORY_COLOR[meta.category] : '#7c3aed'
  const isInvalidated = false

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleApproved() {
    onRefresh()
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 z-40 transition-opacity duration-200"
        style={{
          background: 'rgba(0,0,0,0.5)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      {/* Drawer panel */}
      <div
        className="absolute top-0 right-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 640,
          background: '#0a0a0a',
          borderLeft: `1px solid ${color}33`,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: open ? `-8px 0 40px rgba(0,0,0,0.6)` : 'none',
        }}
      >
        {/* Drawer header */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-6 h-12 border-b"
          style={{ borderColor: `${color}22` }}
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color }}>
              {meta?.label ?? ''}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[#555] hover:text-[#aaa] transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Drawer content — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {meta && renderContent(meta.stepKey, project, handleApproved, isInvalidated)}
        </div>
      </div>
    </>
  )
}

function renderContent(
  stepKey: string,
  project: Project,
  onApproved: () => void,
  invalidated: boolean
) {
  switch (stepKey) {
    case 'gdd':
      return project.concept?.pipeline?.gdd ? (
        <GDDCanvas gdd={project.concept.pipeline.gdd} />
      ) : (
        <EmptyState message="GDD not generated yet." />
      )

    case 'sprites':
      return (
        <Step2Sprites
          project={project}
          onApproved={onApproved}
          invalidated={invalidated}
        />
      )

    case 'levels':
      return (
        <Step3Levels
          project={project}
          onApproved={onApproved}
          invalidated={invalidated}
        />
      )

    case 'code':
      return (
        <Step4Code
          project={project}
          onApproved={onApproved}
          invalidated={invalidated}
        />
      )

    case 'audio':
      return (
        <Step5Audio
          project={project}
          onApproved={onApproved}
          invalidated={invalidated}
        />
      )

    case 'export':
      return <Step6Export project={project} />

    default:
      return <EmptyState message="No content available for this node." />
  }
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-40">
      <p className="text-[#555] text-sm">{message}</p>
    </div>
  )
}
