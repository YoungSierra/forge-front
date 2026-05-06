import type { ForgeNodeCategory } from '@/components/pipeline/ForgeNode'

export interface TemplateCatalogNode {
  id: string
  label: string
  category: ForgeNodeCategory
  icon: string
  stepKey: string
  comingSoon: boolean
  x: number
  y: number
  description?: string
  inputLabel?: string
  outputLabel?: string
}

export interface TemplateCatalogEdge {
  id: string
  source: string
  target: string
}

export interface Template {
  id: string
  name: string
  description: string
  nodes: TemplateCatalogNode[]
  edges: TemplateCatalogEdge[]
}

import template2dRaw  from './template_2d.json'
import template3dRaw  from './template_3d.json'
import template2dtRaw from './template_2d_t.json'

export const TEMPLATES: Template[] = [
  template2dRaw  as Template,
  template3dRaw  as Template,
  template2dtRaw as Template,
]

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find(t => t.id === id)
}

export const CATALOG_ALL: TemplateCatalogNode[] = Array.from(
  new Map(
    [
      ...(template2dRaw  as Template).nodes,
      ...(template3dRaw  as Template).nodes,
      ...(template2dtRaw as Template).nodes,
    ].map(n => [n.id, n as TemplateCatalogNode])
  ).values()
)
