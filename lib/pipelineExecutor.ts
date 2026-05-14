import type { Node, Edge } from '@xyflow/react'
import type { SpritePreview, CodeGenerationResult, Project } from './types'
import type { ForgeNodeData } from '@/components/pipeline/ForgeNode'
import {
  generateSprites, approveStep2,
  generateLevels, approveStep3,
  generateCode, approveStep4,
  generateAudio, approveStep5,
  generateVisualGuide, generateBackgrounds, generateSfx, generateConceptArt,
  generateUIUX, generateIcons, generateHUD, generateArtDirectionIntake,
  generateSplashArt, generateMarketing,
  generateModelingCharacters, generateModelingEnvironments, generateModelingProps,
  generateEnvironments, generateProps,
  generateCharaters, generateVfx, generateTexturing,
  generateRigging, generateLighting, generateAnimation, generateCinematics, generateVoice,
  approveNode, startImageReference,
  type InputContext,
} from './api'
import { getNodeExecutionContext } from './nodeExecutionContext'

export class PendingReviewSignal extends Error {
  constructor(public readonly stepKey: string) {
    super(`${stepKey} requires user review before continuing`)
    this.name = 'PendingReviewSignal'
  }
}

/* ─── Node execution registry ─── */

type NodeExecConfig = {
  title: string
  run: (project_id: string, input_context?: InputContext) => Promise<void>
}

function genericNode(
  title: string,
  generateFn: (id: string, ctx?: InputContext) => Promise<unknown>,
  stepKey: string,
): NodeExecConfig {
  return {
    title,
    run: async (project_id, input_context) => {
      const result = await generateFn(project_id, input_context)
      await approveNode(project_id, stepKey, result)
    },
  }
}

export const NODE_EXECUTOR: Record<string, NodeExecConfig> = {
  sprites: {
    title: 'Sprites',
    run: async (id, ctx) => {
      const sprites = await generateSprites(id, ctx)
      await approveStep2(id, sprites as SpritePreview[])
    },
  },
  levels: {
    title: 'Levels',
    run: async (id, ctx) => {
      const levels = await generateLevels(id, ctx)
      await approveStep3(id, levels as unknown[])
    },
  },
  code: {
    title: 'Code',
    run: async (id, ctx) => {
      const result = await generateCode(id, ctx)
      await approveStep4(id, result as CodeGenerationResult)
    },
  },
  audio: {
    title: 'Audio',
    run: async (id, ctx) => {
      const audio = await generateAudio(id, ctx)
      await approveStep5(id, audio)
    },
  },
  image_reference: {
    title: 'Image Reference',
    run: async (project_id) => {
      await startImageReference(project_id)
      throw new PendingReviewSignal('image_reference')
    },
  },
  visual_guide:         genericNode('Visual Guide',   generateVisualGuide,        'visual_guide'),
  art_direction_intake: genericNode('Art Direction',  generateArtDirectionIntake, 'art_direction_intake'),
  concept_art:          genericNode('Concept Art',    generateConceptArt,         'concept_art'),
  sfx:                  genericNode('SFX',            generateSfx,                'sfx'),
  backgrounds:          genericNode('Backgrounds',    generateBackgrounds,        'backgrounds'),
  uiux:                 genericNode('UI/UX',          generateUIUX,               'uiux'),
  icons:                genericNode('Icons',          generateIcons,              'icons'),
  hud:                  genericNode('HUD',            generateHUD,                'hud'),
  splash_art:           genericNode('Splash Art',     generateSplashArt,          'splash_art'),
  marketing:            genericNode('Marketing',      generateMarketing,          'marketing'),
  modeling_characters:   genericNode('Modeling (Characters)',    generateModelingCharacters,   'modeling_characters'),
  modeling_environments: genericNode('Modeling (Environments)', generateModelingEnvironments, 'modeling_environments'),
  modeling_props:        genericNode('Modeling (Props)',         generateModelingProps,        'modeling_props'),
  environments:          genericNode('Environments',             generateEnvironments,         'environments'),
  props:                 genericNode('Props',                    generateProps,                'props'),
  charaters:             genericNode('Characters',               generateCharaters,            'charaters'),
  vfx:                  genericNode('VFX',            generateVfx,                'vfx'),
  texturing:            genericNode('Texturing',      generateTexturing,          'texturing'),
  rigging:              genericNode('Rigging',        generateRigging,            'rigging'),
  lighting:             genericNode('Lighting',       generateLighting,           'lighting'),
  animation:            genericNode('Animation',      generateAnimation,          'animation'),
  cinematics:           genericNode('Cinematics',     generateCinematics,         'cinematics'),
  voice:                genericNode('Voice',          generateVoice,              'voice'),
}

/* ─── Topological sort of canvas nodes ─── */

function nodeStepKey(n: Node): string {
  return (n.data as unknown as ForgeNodeData).stepKey ?? n.id
}

export function topoSort(nodes: Node[], edges: Edge[]): string[] {
  const execNodes = nodes.filter(n => {
    if (n.type === 'forgeGroup') return false
    return nodeStepKey(n) in NODE_EXECUTOR
  })

  const idSet = new Set(execNodes.map(n => n.id))
  const children = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const n of execNodes) {
    children.set(n.id, [])
    inDegree.set(n.id, 0)
  }

  for (const e of edges) {
    const src = e.source as string
    const tgt = e.target as string
    if (idSet.has(src) && idSet.has(tgt)) {
      children.get(src)!.push(tgt)
      inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1)
    }
  }

  const queue = execNodes
    .filter(n => (inDegree.get(n.id) ?? 0) === 0)
    .map(n => n.id)

  const result: string[] = []
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    const n = execNodes.find(x => x.id === nodeId)!
    result.push(nodeStepKey(n))
    for (const child of children.get(nodeId) ?? []) {
      const deg = (inDegree.get(child) ?? 0) - 1
      inDegree.set(child, deg)
      if (deg === 0) queue.push(child)
    }
  }

  return result
}

/* ─── Pipeline execution ─── */

export type PipelineCallbacks = {
  onNodeStart:         (stepKey: string) => void
  onNodeDone:          (stepKey: string) => void
  onNodeError:         (stepKey: string, error: string) => void
  onNodePendingReview?: (stepKey: string) => void
  onDone:              () => void
}

export async function executePipeline(
  project_id: string,
  nodes: Node[],
  edges: Edge[],
  callbacks: PipelineCallbacks,
  project?: Project | null,
): Promise<void> {
  const order = topoSort(nodes, edges)

  const idleStepKeys = order.filter(sk => {
    const node = nodes.find(n => nodeStepKey(n) === sk)
    if (!node) return false
    const status = (node.data as unknown as ForgeNodeData).status
    return status === 'idle'
  })

  for (const stepKey of idleStepKeys) {
    const ctx = project ? getNodeExecutionContext(stepKey, nodes, edges, project) : undefined
    callbacks.onNodeStart(stepKey)
    try {
      await NODE_EXECUTOR[stepKey].run(project_id, ctx)
      callbacks.onNodeDone(stepKey)
    } catch (e) {
      if (e instanceof PendingReviewSignal) {
        callbacks.onNodePendingReview?.(stepKey)
        return
      }
      const msg = e instanceof Error ? e.message : 'Unknown error'
      callbacks.onNodeError(stepKey, msg)
      return
    }
  }

  callbacks.onDone()
}
