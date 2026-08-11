import { useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { FieldLegend, FieldSet } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

let envKeyCounter = 0

export function EnvEditor({
  env,
  onChange
}: {
  env: Record<string, string>
  onChange: (env: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  const entries = Object.entries(env)
  const keyMapRef = useRef<Map<string, number>>(new Map())
  if (keyMapRef.current.size !== entries.length) {
    keyMapRef.current = new Map(
      entries.map(([k]) => {
        return [k, envKeyCounter++]
      })
    )
  }

  function renameKey(oldKey: string, newKey: string) {
    keyMapRef.current = new Map(keyMapRef.current)
    const id = keyMapRef.current.get(oldKey) ?? envKeyCounter++
    keyMapRef.current.delete(oldKey)
    if (!keyMapRef.current.has(newKey)) keyMapRef.current.set(newKey, id)
    const next = { ...env }
    const value = next[oldKey]
    delete next[oldKey]
    next[newKey] = value
    onChange(next)
  }

  function updateValue(key: string, value: string) {
    onChange({ ...env, [key]: value })
  }

  function removeEntry(key: string) {
    keyMapRef.current = new Map(keyMapRef.current)
    keyMapRef.current.delete(key)
    const next = { ...env }
    delete next[key]
    onChange(next)
  }

  function addEntry() {
    keyMapRef.current = new Map(keyMapRef.current)
    keyMapRef.current.set('', envKeyCounter++)
    onChange({ ...env, '': '' })
  }

  return (
    <FieldSet>
      <FieldLegend variant="label">{t('designer:env.title')}</FieldLegend>
      <div className="flex flex-col gap-2">
        {entries.map(([key, value]) => (
          <div
            className="env-editor__row grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
            key={keyMapRef.current.get(key) ?? envKeyCounter++}
          >
            <Textarea
              aria-label={t('designer:env.keyAria')}
              value={key}
              onChange={(event) => renameKey(key, event.target.value)}
              placeholder={t('designer:env.keyPlaceholder')}
            />
            <Textarea
              aria-label={t('designer:env.valueAria')}
              value={value}
              onChange={(event) => updateValue(key, event.target.value)}
              placeholder={t('designer:env.valuePlaceholder')}
            />
            <Button aria-label={t('designer:env.delete.aria')} size="icon" title={t('common:action.delete')} variant="ghost" onClick={() => removeEntry(key)}>
              <X />
            </Button>
          </div>
        ))}
      </div>
      <Button className="self-start" size="sm" variant="outline" onClick={addEntry}>
        <Plus data-icon="inline-start" />
        {t('designer:env.add')}
      </Button>
    </FieldSet>
  )
}
