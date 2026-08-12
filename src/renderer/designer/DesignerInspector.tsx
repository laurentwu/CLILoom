import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkflowDefinition, WorkflowNode } from '../../shared/workflow'
import { getNodeTypeLabel } from '../utils'
import { AvailableVariables } from './AvailableVariables'
import { DesignerNodeConfig } from './DesignerNodeConfig'
import { HookEditor } from './HookEditor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

type DesignerNode = WorkflowNode & { x: number; y: number }
type DesignerSelection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

export function DesignerInspector({
  selection,
  nodes,
  edges,
  onUpdateNode,
  onUpdateEdge,
  onDeleteSelection
}: {
  selection: DesignerSelection
  nodes: DesignerNode[]
  edges: WorkflowDefinition['edges']
  onUpdateNode: (nodeId: string, patch: Partial<WorkflowNode>) => void
  onUpdateEdge: (edgeId: string, patch: Partial<WorkflowDefinition['edges'][number]>) => void
  onDeleteSelection: () => void
}) {
  const { t } = useTranslation()
  if (!selection) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>{t('designer:inspector.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('designer:inspector.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (selection.kind === 'edge') {
    const edge = edges.find((item) => item.id === selection.id)
    if (!edge) {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('designer:inspector.edgeMissingTitle')}</EmptyTitle>
            <EmptyDescription>{t('designer:inspector.missingDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-heading text-sm font-medium">{t('designer:inspector.edgeTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('designer:inspector.edgeDescription')}</p>
          </div>
          <Button
            aria-label={t('designer:inspector.deleteEdge')}
            size="icon-sm"
            title={t('designer:inspector.deleteEdge')}
            variant="destructive"
            onClick={onDeleteSelection}
          >
            <Trash2 />
          </Button>
        </div>
        <Separator />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="designer-edge-id">ID</FieldLabel>
            <Textarea id="designer-edge-id" value={edge.id} readOnly />
          </Field>
          <Field>
            <FieldLabel>{t('designer:inspector.from')}</FieldLabel>
            <Select value={edge.from} onValueChange={(value) => onUpdateEdge(edge.id, { from: value })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} title={node.name} value={node.id}>
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t('designer:inspector.to')}</FieldLabel>
            <Select value={edge.to} onValueChange={(value) => onUpdateEdge(edge.id, { to: value })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} title={node.name} value={node.id}>
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="designer-edge-default"
              checked={edge.isDefault ?? false}
              onCheckedChange={(checked) => onUpdateEdge(edge.id, { isDefault: checked === true || undefined })}
            />
            <FieldLabel htmlFor="designer-edge-default">{t('designer:inspector.defaultBranch')}</FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="designer-edge-condition">{t('designer:inspector.conditionExpression')}</FieldLabel>
            <Textarea
              id="designer-edge-condition"
              value={edge.condition ?? ''}
              onChange={(event) => onUpdateEdge(edge.id, { condition: event.target.value || undefined })}
            />
          </Field>
        </FieldGroup>
        <AvailableVariables nodes={nodes} edges={edges} nodeId={edge.from} format="identifier" />
      </div>
    )
  }

  const node = nodes.find((item) => item.id === selection.id)
  if (!node) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('designer:inspector.nodeMissingTitle')}</EmptyTitle>
          <EmptyDescription>{t('designer:inspector.missingDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-sm font-medium">{t(getNodeTypeLabel(node.type))}</h3>
          <p className="text-xs text-muted-foreground">{t('designer:inspector.nodeDescription')}</p>
        </div>
        <Button aria-label={t('designer:inspector.deleteNode')} size="icon-sm" title={t('designer:inspector.deleteNode')} variant="destructive" onClick={onDeleteSelection}>
          <Trash2 />
        </Button>
      </div>
      <Separator />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="designer-node-id">ID</FieldLabel>
          <Textarea id="designer-node-id" value={node.id} readOnly />
        </Field>
        <Field>
          <FieldLabel htmlFor="designer-node-name">{t('designer:inspector.name')}</FieldLabel>
          <Textarea
            id="designer-node-name"
            value={node.name}
            onChange={(event) => onUpdateNode(node.id, { name: event.target.value })}
          />
        </Field>
      </FieldGroup>
      <DesignerNodeConfig node={node} nodes={nodes} edges={edges} onUpdateNode={onUpdateNode} />
      <FieldGroup>
        <HookEditor
          key={`start-${node.id}`}
          kind="start"
          hook={node.startHook}
          nodeId={node.id}
          onChange={(next) => onUpdateNode(node.id, { startHook: next })}
        />
        <HookEditor
          key={`end-${node.id}`}
          kind="end"
          hook={node.endHook}
          nodeId={node.id}
          onChange={(next) => onUpdateNode(node.id, { endHook: next })}
        />
      </FieldGroup>
      <AvailableVariables nodes={nodes} edges={edges} nodeId={node.id} format="interpolation" />
    </div>
  )
}
