'use client'

import { memo, useState, useEffect, useRef } from 'react'
import { NodeResizer, useReactFlow } from '@xyflow/react'

export interface ForgeGroupNodeData {
  label: string
  color: string
}

function ForgeGroupNode({ id, data, selected }: { id: string; data: ForgeGroupNodeData; selected?: boolean }) {
  const { setNodes } = useReactFlow()
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit(val: string) {
    const label = val.trim() || data.label
    setNodes(ns => ns.map(n =>
      n.id === id ? { ...n, data: { ...n.data, label } } : n
    ))
    setEditing(false)
  }

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        color={data.color}
        lineStyle={{ borderColor: data.color, opacity: 0.6 }}
        handleStyle={{ background: data.color, border: 'none', width: 8, height: 8 }}
      />
      <div
        className="forge-group"
        style={{ '--group-color': data.color, width: '100%', height: '100%' } as React.CSSProperties}
      >
        <div className="group-title" onDoubleClick={() => setEditing(true)}>
          {editing ? (
            <input
              ref={inputRef}
              defaultValue={data.label}
              className="group-title-input"
              onBlur={e => commit(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commit(e.currentTarget.value)
                if (e.key === 'Escape') setEditing(false)
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <>
              {data.label}
              <span className="group-title-hint">double-click to rename</span>
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default memo(ForgeGroupNode)
