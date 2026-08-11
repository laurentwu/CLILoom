import { useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sortVariableDefinitions, type VariableDefinition } from '../../shared/workflow'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

let variableKeyCounter = 0

export function VariableListEditor({
  variables,
  onChange
}: {
  variables: VariableDefinition[]
  onChange: (v: VariableDefinition[]) => void
}) {
  const { t } = useTranslation()
  const idsRef = useRef<number[]>([])
  while (idsRef.current.length < variables.length) idsRef.current.push(variableKeyCounter++)
  if (idsRef.current.length > variables.length) idsRef.current.length = variables.length
  const orderedVariables = sortVariableDefinitions(variables).map((variable) => ({
    variable,
    index: variables.indexOf(variable)
  }))

  function addVariable() {
    idsRef.current.push(variableKeyCounter++)
    onChange([...variables, { key: '', label: '', type: 'text' as const, required: false }])
  }

  function updateVariable(index: number, patch: Partial<VariableDefinition>) {
    onChange(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)))
  }

  function removeVariable(index: number) {
    idsRef.current.splice(index, 1)
    onChange(variables.filter((_, i) => i !== index))
  }

  return (
    <FieldSet>
      <FieldLegend variant="label">{t('designer:variableEditor.title')}</FieldLegend>
      <FieldDescription>{t('designer:variableEditor.orderHint')}</FieldDescription>
      <div className="flex flex-col gap-3">
        {orderedVariables.map(({ variable, index }, displayIndex) => (
          <Card key={idsRef.current[index]} size="sm">
            <CardHeader>
              <CardTitle>{variable.label || t('designer:variableEditor.defaultLabel', { index: displayIndex + 1 })}</CardTitle>
              <CardAction>
                <Button
                  aria-label={t('designer:variableEditor.delete.aria')}
                  size="icon-sm"
                  title={t('designer:variableEditor.delete.tooltip')}
                  variant="ghost"
                  onClick={() => removeVariable(index)}
                >
                  <X />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3">
                <Field>
                  <FieldLabel htmlFor={`designer-variable-key-${idsRef.current[index]}`}>{t('designer:variableEditor.key')}</FieldLabel>
                  <Textarea
                    id={`designer-variable-key-${idsRef.current[index]}`}
                    value={variable.key}
                    onChange={(event) => updateVariable(index, { key: event.target.value })}
                    placeholder={t('designer:variableEditor.keyPlaceholder')}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`designer-variable-label-${idsRef.current[index]}`}>{t('designer:variableEditor.label')}</FieldLabel>
                  <Textarea
                    id={`designer-variable-label-${idsRef.current[index]}`}
                    value={variable.label}
                    onChange={(event) => updateVariable(index, { label: event.target.value })}
                    placeholder={t('designer:variableEditor.labelPlaceholder')}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`designer-variable-order-${idsRef.current[index]}`}>{t('designer:variableEditor.order')}</FieldLabel>
                  <Input
                    id={`designer-variable-order-${idsRef.current[index]}`}
                    min={1}
                    step={1}
                    type="number"
                    value={variable.order ?? ''}
                    onChange={(event) =>
                      updateVariable(index, {
                        order: event.target.value === '' ? undefined : Number(event.target.value)
                      })
                    }
                    placeholder={t('designer:variableEditor.orderUnset')}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('designer:variableEditor.type')}</FieldLabel>
                  <Select
                    value={variable.type}
                    onValueChange={(value) => updateVariable(index, { type: value as VariableDefinition['type'] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="text">{t('designer:variableEditor.typeText')}</SelectItem>
                        <SelectItem value="number">{t('designer:variableEditor.typeNumber')}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`designer-variable-required-${idsRef.current[index]}`}
                    checked={variable.required}
                    onCheckedChange={(checked) => updateVariable(index, { required: checked === true })}
                  />
                  <FieldLabel htmlFor={`designer-variable-required-${idsRef.current[index]}`}>{t('designer:variableEditor.required')}</FieldLabel>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`designer-variable-default-${idsRef.current[index]}`}>{t('designer:variableEditor.defaultValue')}</FieldLabel>
                  {variable.type === 'number' ? (
                    <Input
                      id={`designer-variable-default-${idsRef.current[index]}`}
                      type="number"
                      value={String(variable.defaultValue ?? '')}
                      onChange={(event) => updateVariable(index, { defaultValue: event.target.value || undefined })}
                    />
                  ) : (
                    <Textarea
                      id={`designer-variable-default-${idsRef.current[index]}`}
                      value={String(variable.defaultValue ?? '')}
                      onChange={(event) => updateVariable(index, { defaultValue: event.target.value || undefined })}
                    />
                  )}
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        ))}
      </div>
      <Button className="self-start" size="sm" variant="outline" onClick={addVariable}>
        <Plus data-icon="inline-start" />
        {t('designer:variableEditor.add')}
      </Button>
    </FieldSet>
  )
}
