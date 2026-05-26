'use client'

import React, { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { ActionInstance } from '@/lib/types'

export interface ActionStepNodeData extends Record<string, unknown> {
  instance:  ActionInstance
  label:     string
  onOpen:    () => void
  onRun:     () => void
  onRemove:  () => void
}

const ACTION_ICON: Record<string, string> = {
  'docx':          '📄',
  'pptx':          '📊',
  'pdf':           '📑',
  'artefact-html': '🌐',
  'pitch-deck':    '🎯',
  'one-pager':     '📋',
  'social-kit':    '📢',
  'press-release': '📰',
  'spreadsheet':   '🗂️',
  'email-draft':   '✉️',
  'wiki-starter':  '📚',
}

const STATUS_DOT: Record<string, string> = {
  pending: '#6b7280',
  running: '#FBBF24',
  done:    '#2DD4BF',
  error:   '#F87171',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'ready',
  running: 'running…',
  done:    '✓ done',
  error:   '✗ error',
}

const ANIM = `
@keyframes ap { 0%,100%{opacity:1} 50%{opacity:0.4} }
@keyframes ag { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
`

export default function ActionStepNode({ data }: { data: ActionStepNodeData }) {
  const { instance, label, onOpen, onRun, onRemove } = data
  const [hovered, setHovered] = useState(false)

  const statusDot  = STATUS_DOT[instance.status]  ?? '#6b7280'
  const statusText = STATUS_LABEL[instance.status] ?? instance.status
  const icon       = ACTION_ICON[instance.action_type] ?? '⚡'
  const isRunning  = instance.status === 'running'
  const isDone     = instance.status === 'done'

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 162,
        background: hovered
          ? 'color-mix(in oklch, var(--action) 12%, var(--bg-1))'
          : 'color-mix(in oklch, var(--action) 6%, var(--bg-1))',
        border: `1px solid ${hovered ? 'var(--action)' : 'color-mix(in oklch, var(--action) 38%, var(--line-2))'}`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: hovered
          ? '0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px color-mix(in oklch, var(--action) 22%, transparent)'
          : '0 2px 10px rgba(0,0,0,0.18)',
        cursor: 'pointer',
        transition: 'border-color 150ms, box-shadow 150ms, background 150ms',
        position: 'relative',
      }}
    >
      <style>{ANIM}</style>

      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{
          background: 'var(--action)',
          border: '2px solid var(--bg-1)',
          width: 10, height: 10,
        }}
      />

      {/* Franja superior con gradiente ember */}
      <div style={{
        height: 3,
        backgroundImage: isDone
          ? 'linear-gradient(90deg, var(--action), #2DD4BF)'
          : 'linear-gradient(90deg, var(--action), transparent, var(--action-hover, #f06a18), var(--action))',
        backgroundSize: isRunning ? '200% 100%' : '100% 100%',
        animation: isRunning ? 'ag 1.4s linear infinite' : undefined,
        opacity: isRunning ? 1 : 0.85,
      }} />

      {/* Contenido */}
      <div style={{ padding: '9px 10px 8px' }}>

        {/* Badge "ACTION" + icono */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{
            fontSize: 7.5, fontFamily: 'var(--font-mono)', fontWeight: 800,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--action)',
            background: 'color-mix(in oklch, var(--action) 13%, var(--bg-2))',
            padding: '2px 6px', borderRadius: 4,
          }}>
            ACTION
          </span>
          <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
        </div>

        {/* Label principal */}
        <div style={{
          fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
          color: 'var(--text-0)', lineHeight: 1.3, marginBottom: 7,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {label}
        </div>

        {/* Status row + play button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: statusDot, flexShrink: 0,
            animation: isRunning ? 'ap 1.2s ease-in-out infinite' : undefined,
          }} />
          <span style={{
            flex: 1,
            fontSize: 8.5, fontFamily: 'var(--font-mono)',
            color: statusDot,
            animation: isRunning ? 'ap 1.2s ease-in-out infinite' : undefined,
          }}>
            {statusText}
          </span>

          {/* Botón play — oculto cuando ya está done */}
          {!isDone && <button
            onClick={e => { e.stopPropagation(); onRun() }}
            disabled={isRunning}
            title={isRunning ? 'Running…' : 'Run action'}
            style={{
              width: 20, height: 20, borderRadius: '50%',
              border: 'none',
              background: isRunning
                ? 'color-mix(in oklch, var(--action) 20%, var(--bg-2))'
                : 'var(--action)',
              color: isRunning ? 'var(--action)' : 'var(--action-fg)',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, lineHeight: 1, flexShrink: 0,
              transition: 'background 150ms, transform 100ms',
              animation: isRunning ? 'ap 1.2s ease-in-out infinite' : undefined,
              boxShadow: isRunning ? 'none' : '0 1px 6px color-mix(in oklch, var(--action) 40%, transparent)',
            }}
            onMouseEnter={e => { if (!isRunning) e.currentTarget.style.transform = 'scale(1.15)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            {isRunning ? '…' : '▶'}
          </button>}
        </div>
      </div>

      {/* Botón × hover */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          title="Remove action node"
          style={{
            position: 'absolute', top: 6, right: 6,
            width: 16, height: 16, borderRadius: '50%',
            border: '1px solid var(--line-2)',
            background: 'var(--bg-2)', color: 'var(--text-3)',
            cursor: 'pointer', fontSize: 9, fontFamily: 'var(--font-mono)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, lineHeight: 1,
            transition: 'background 120ms, color 120ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#F87171'; e.currentTarget.style.color = '#fff' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text-3)' }}
        >
          ×
        </button>
      )}
    </div>
  )
}
