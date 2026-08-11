import { Check, Circle, Plus, SquareTerminal, X } from 'lucide-react'
import type { WorkflowNode } from '../../shared/workflow'

export function NodeIcon({ node }: { node: WorkflowNode }) {
  if (node.type.includes('terminal')) return <SquareTerminal />
  if (node.type === 'parallel-gateway') return <Plus />
  if (node.type === 'exclusive-gateway') return <X />
  if (node.type === 'start' || node.type === 'end') return <Circle />
  return <Check />
}
