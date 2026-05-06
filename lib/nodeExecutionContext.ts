import type { Node, Edge } from '@xyflow/react'
import type { Project } from './types'
import type { ForgeNodeData } from '@/components/pipeline/ForgeNode'

export type InputContext = Record<string, unknown>

export function getNodeExecutionContext(
  stepKey: string,
  nodes: Node[],
  edges: Edge[],
  project: Project | null,
): InputContext {
  if (!project) return {}

  const targetNode = nodes.find(n => (n.data as unknown as ForgeNodeData).stepKey === stepKey)
  if (!targetNode) return {}

  const incoming = edges.filter(e => e.target === targetNode.id)
  if (incoming.length === 0) return {}

  const ctx: InputContext = {}

  for (const edge of incoming) {
    const parentNode = nodes.find(n => n.id === edge.source)
    if (!parentNode) continue
    const parentStepKey = (parentNode.data as unknown as ForgeNodeData).stepKey
    if (!parentStepKey) continue

    const pipelineData = (project.concept?.pipeline as Record<string, unknown> | undefined)?.[parentStepKey]
    if (pipelineData !== undefined) {
      ctx[parentStepKey] = pipelineData
    }
  }

  return ctx
}
