import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  InteractiveTerminalConfig,
  NonInteractiveTerminalConfig,
  ParallelGatewayConfig,
  StartNodeConfig,
  WorkflowDefinition,
  WorkflowNode
} from '../../shared/workflow'
import { VariableListEditor } from './VariableListEditor'
import { EnvEditor } from './EnvEditor'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type DesignerNode = WorkflowNode & { x: number; y: number }

function ConfigSection({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{title}</FieldLegend>
      {description && <FieldDescription>{description}</FieldDescription>}
      {children}
    </FieldSet>
  )
}

export function DesignerNodeConfig({
  node,
  nodes = [],
  edges = [],
  onUpdateNode
}: {
  node: DesignerNode
  nodes?: DesignerNode[]
  edges?: WorkflowDefinition['edges']
  onUpdateNode: (nodeId: string, patch: Partial<WorkflowNode>) => void
}) {
  const { t } = useTranslation()
  const set = (patch: Record<string, unknown>) =>
    onUpdateNode(node.id, { config: { ...node.config, ...patch } as WorkflowNode['config'] })
  const [interactiveEnv, setInteractiveEnv] = useState<Record<string, string>>({})
  const [nonInteractiveEnv, setNonInteractiveEnv] = useState<Record<string, string>>({})
  useEffect(() => {
    setInteractiveEnv({})
    setNonInteractiveEnv({})
  }, [node.id])

  if (node.type === 'start' || node.type === 'input') {
    const config = node.config as StartNodeConfig
    return <VariableListEditor variables={config.variables} onChange={(variables) => set({ variables })} />
  }

  if (node.type === 'interactive-terminal') {
    const config = node.config as InteractiveTerminalConfig
    const env = Object.keys(interactiveEnv).length === 0 ? (config.env ?? {}) : interactiveEnv

    return (
      <>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`designer-command-${node.id}`}>{t('designer:nodeConfig.commandLabel')}</FieldLabel>
            <Textarea
              id={`designer-command-${node.id}`}
              value={config.command}
              onChange={(event) => set({ command: event.target.value })}
              placeholder={t('designer:nodeConfig.commandPlaceholder')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`designer-cwd-${node.id}`}>{t('designer:nodeConfig.workingDir')}</FieldLabel>
            <Textarea
              id={`designer-cwd-${node.id}`}
              value={config.cwd}
              onChange={(event) => set({ cwd: event.target.value })}
              placeholder="${sys_project_dir}"
            />
          </Field>
        </FieldGroup>
        <ConfigSection
          title={t('designer:nodeConfig.interactiveMode')}
          description={t('designer:nodeConfig.interactiveModeDescription')}
        />
        <EnvEditor
          env={env}
          onChange={(e) => {
            setInteractiveEnv(e)
            set({ env: Object.keys(e).length > 0 ? e : undefined })
          }}
        />
      </>
    )
  }

  if (node.type === 'non-interactive-terminal') {
    const config = node.config as NonInteractiveTerminalConfig
    const env = Object.keys(nonInteractiveEnv).length === 0 ? (config.env ?? {}) : nonInteractiveEnv

    return (
      <>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`designer-command-${node.id}`}>{t('designer:nodeConfig.commandLabel')}</FieldLabel>
            <Textarea
              id={`designer-command-${node.id}`}
              value={config.command}
              onChange={(event) => set({ command: event.target.value })}
              placeholder={t('designer:nodeConfig.commandPlaceholder')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`designer-cwd-${node.id}`}>{t('designer:nodeConfig.workingDir')}</FieldLabel>
            <Textarea
              id={`designer-cwd-${node.id}`}
              value={config.cwd}
              onChange={(event) => set({ cwd: event.target.value })}
              placeholder="${sys_project_dir}"
            />
          </Field>
        </FieldGroup>
        <ConfigSection title={t('designer:nodeConfig.options')}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`designer-exit-codes-${node.id}`}>{t('designer:nodeConfig.successExitCodes')}</FieldLabel>
              <Textarea
                id={`designer-exit-codes-${node.id}`}
                value={config.successExitCodes.join(',')}
                onChange={(event) => {
                  const successExitCodes = event.target.value
                    .split(/[\s,]+/)
                    .filter(Boolean)
                    .map(Number)
                    .filter((number) => !Number.isNaN(number))
                  set({ successExitCodes: successExitCodes.length > 0 ? successExitCodes : [0] })
                }}
                placeholder="0"
              />
              <FieldDescription>{t('designer:nodeConfig.exitCodesHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`designer-timeout-${node.id}`}>{t('designer:nodeConfig.timeoutMs')}</FieldLabel>
              <Input
                id={`designer-timeout-${node.id}`}
                type="number"
                value={config.timeoutMs ?? ''}
                onChange={(event) => set({ timeoutMs: event.target.value ? Number(event.target.value) : undefined })}
                placeholder={t('designer:nodeConfig.unlimited')}
              />
            </Field>
          </FieldGroup>
        </ConfigSection>
        <EnvEditor
          env={env}
          onChange={(e) => {
            setNonInteractiveEnv(e)
            set({ env: Object.keys(e).length > 0 ? e : undefined })
          }}
        />
      </>
    )
  }

  if (node.type === 'parallel-gateway') {
    const config = node.config as ParallelGatewayConfig
    const incomingEdges = edges.filter((edge) => edge.to === node.id)
    const selectedIncomingEdgeIds = config.joinIncomingEdgeIds ?? []
    const toggleJoinIncomingEdge = (edgeId: string, checked: boolean) => {
      const next = checked
        ? [...selectedIncomingEdgeIds, edgeId]
        : selectedIncomingEdgeIds.filter((id) => id !== edgeId)
      set({ joinIncomingEdgeIds: next.length > 0 ? next : undefined })
    }

    return (
      <>
        <ConfigSection title={t('designer:nodeConfig.mode')}>
          <Field>
            <Select value={config.mode} onValueChange={(value) => set({ mode: value as 'split' | 'join' })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="split">{t('designer:nodeConfig.modeSplit')}</SelectItem>
                  <SelectItem value="join">{t('designer:nodeConfig.modeJoin')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </ConfigSection>

        {config.mode === 'join' && (
          <ConfigSection title={t('designer:nodeConfig.joinIncoming')}>
            {incomingEdges.length === 0 ? (
              <FieldDescription>{t('designer:nodeConfig.joinIncomingDescription')}</FieldDescription>
            ) : (
              <FieldGroup>
                {incomingEdges.map((edge) => {
                  const sourceNode = nodes.find((item) => item.id === edge.from)
                  const checkboxId = `join-edge-${node.id}-${edge.id}`
                  return (
                    <Field orientation="horizontal" key={edge.id}>
                      <Checkbox
                        id={checkboxId}
                        checked={selectedIncomingEdgeIds.includes(edge.id)}
                        onCheckedChange={(checked) => toggleJoinIncomingEdge(edge.id, checked === true)}
                      />
                      <FieldLabel htmlFor={checkboxId}>
                        {edge.id} · {sourceNode?.name ?? edge.from}
                      </FieldLabel>
                    </Field>
                  )
                })}
              </FieldGroup>
            )}
          </ConfigSection>
        )}
      </>
    )
  }

  return null
}
