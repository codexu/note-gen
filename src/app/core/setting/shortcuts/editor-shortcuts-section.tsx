'use client'

import { useTranslations } from 'next-intl'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'
import {
  editorShortcutDefinitions,
  type EditorShortcutGroup,
} from '@/config/editor-shortcuts'
import useEditorShortcutStore from '@/stores/editor-shortcut'
import { EditorShortcutInput } from './editor-shortcut-input'
import { SettingSection } from '../components/setting-base'

const editorShortcutGroups: EditorShortcutGroup[] = [
  'basic',
  'format',
  'ai',
  'table',
  'insert',
]

export function EditorShortcutsSection() {
  const t = useTranslations('settings.shortcuts')
  const shortcuts = useEditorShortcutStore((state) => state.shortcuts)

  return (
    <SettingSection title={t('editorShortcuts.title')} desc={t('editorShortcuts.desc')}>
      {editorShortcutGroups.map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            {t(`editorShortcuts.groups.${group}`)}
          </h4>
          <ItemGroup className="gap-2">
            {editorShortcutDefinitions
              .filter((definition) => definition.group === group)
              .map((definition) => {
                const shortcut = shortcuts.find((item) => item.id === definition.id)
                const suggestedShortcutValue = 'suggestedShortcut' in definition ? definition.suggestedShortcut : ''
                const suggestedShortcut = suggestedShortcutValue && !shortcut?.value
                  ? t('editorShortcuts.suggested', { shortcut: suggestedShortcutValue })
                  : ''

                return (
                  <Item key={definition.id} variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>{t(`editorShortcuts.commands.${definition.id}.title`)}</ItemTitle>
                      <ItemDescription>
                        {t(`editorShortcuts.commands.${definition.id}.desc`)}
                        {suggestedShortcut ? ` ${suggestedShortcut}` : ''}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <EditorShortcutInput id={definition.id} />
                    </ItemActions>
                  </Item>
                )
              })}
          </ItemGroup>
        </div>
      ))}
    </SettingSection>
  )
}

export default EditorShortcutsSection
