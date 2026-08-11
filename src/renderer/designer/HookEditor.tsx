import { useTranslation } from 'react-i18next'
import type { HookConfig } from '../../shared/workflow'
import { EnvEditor } from './EnvEditor'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type HookKind = 'start' | 'end'

function createDefaultHook(): HookConfig {
  return { enabled: true, command: '', failPolicy: 'continue' }
}

export function HookEditor({
  kind,
  hook,
  nodeId,
  onChange
}: {
  kind: HookKind
  hook?: HookConfig
  nodeId: string
  onChange: (hook: HookConfig | undefined) => void
}) {
  const { t } = useTranslation()
  const enabled = hook !== undefined && hook.enabled
  const toggleId = `designer-${kind}-hook-enabled-${nodeId}`

  function toggle(nextEnabled: boolean) {
    if (nextEnabled) {
      onChange(hook ? { ...hook, enabled: true } : createDefaultHook())
    } else {
      onChange(hook ? { ...hook, enabled: false } : undefined)
    }
  }

  function patch(p: Partial<HookConfig>) {
    onChange({ ...(hook ?? createDefaultHook()), ...p })
  }

  return (
    <FieldSet>
      <FieldLegend variant="label">
        {kind === 'start' ? t('designer:hooks.startHookTitle') : t('designer:hooks.endHookTitle')}
      </FieldLegend>
      <FieldDescription>
        {kind === 'start' ? t('designer:hooks.startHookDescription') : t('designer:hooks.endHookDescription')}
      </FieldDescription>
      <Field orientation="horizontal">
        <Checkbox id={toggleId} checked={enabled} onCheckedChange={(checked) => toggle(checked === true)} />
        <FieldLabel htmlFor={toggleId}>{t('designer:hooks.enable')}</FieldLabel>
      </Field>
      {enabled && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`designer-${kind}-hook-command-${nodeId}`}>
              {t('designer:hooks.commandLabel')}
            </FieldLabel>
            <Textarea
              id={`designer-${kind}-hook-command-${nodeId}`}
              value={hook?.command ?? ''}
              onChange={(event) => patch({ command: event.target.value })}
              placeholder={t('designer:hooks.commandPlaceholder')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`designer-${kind}-hook-cwd-${nodeId}`}>{t('designer:hooks.workingDir')}</FieldLabel>
            <Input
              id={`designer-${kind}-hook-cwd-${nodeId}`}
              value={hook?.cwd ?? ''}
              onChange={(event) => patch({ cwd: event.target.value || undefined })}
              placeholder="${sys_project_dir}"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`designer-${kind}-hook-policy-${nodeId}`}>{t('designer:hooks.failPolicy')}</FieldLabel>
            <Select
              value={hook?.failPolicy ?? 'continue'}
              onValueChange={(value) => patch({ failPolicy: value as 'continue' | 'fail-node' })}
            >
              <SelectTrigger id={`designer-${kind}-hook-policy-${nodeId}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="continue">{t('designer:hooks.failPolicyContinue')}</SelectItem>
                  <SelectItem value="fail-node">{t('designer:hooks.failPolicyFailNode')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>{t('designer:hooks.failPolicyHint')}</FieldDescription>
          </Field>
          <EnvEditor
            env={hook?.env ?? {}}
            onChange={(e) => patch({ env: Object.keys(e).length > 0 ? e : undefined })}
          />
        </FieldGroup>
      )}
    </FieldSet>
  )
}
