import { validateUserVariableKey, type VariableDefinition, type VariableValue } from '../../shared/workflow'
import { coerceValue } from '../utils'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from 'react-i18next'

export function VariableField({
  variable,
  value,
  disabled = false,
  onChange
}: {
  variable: VariableDefinition
  value: VariableValue | undefined
  disabled?: boolean
  onChange: (value: VariableValue) => void
}) {
  const { t } = useTranslation()
  const error = validateUserVariableKey(variable.key)
  const inputId = `variable-${variable.key}`

  return (
    <Field data-disabled={disabled || undefined} data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={inputId}>{variable.label}</FieldLabel>
      {variable.type === 'number' ? (
        <Input
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          disabled={disabled}
          type="number"
          value={String(value ?? variable.defaultValue ?? '')}
          onChange={(event) => onChange(coerceValue(event.target.value, variable.type))}
        />
      ) : (
        <Textarea
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          disabled={disabled}
          value={String(value ?? variable.defaultValue ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error && <FieldError>{t(error.key, error.params)}</FieldError>}
    </Field>
  )
}
