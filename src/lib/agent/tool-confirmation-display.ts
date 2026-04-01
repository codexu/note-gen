export interface ToolConfirmationDisplayConfig {
  titleKey: string
  descriptionKey: string
  summaryFields?: string[]
  contentFields?: string[]
  parameterLabels?: Record<string, string>
}

export interface ConfirmationPreviewField {
  name: string
  labelKey: string
  value: unknown
  displayType: 'text' | 'content' | 'json'
}

export interface ConfirmationPreview {
  titleKey: string
  descriptionKey: string
  fields: ConfirmationPreviewField[]
}

const TOOL_CONFIRMATION_DISPLAY: Record<string, ToolConfirmationDisplayConfig> = {
  create_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.create_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.create_file.description',
    summaryFields: ['filePath', 'content'],
    contentFields: ['content'],
  },
  create_files_batch: {
    titleKey: 'record.chat.input.agent.confirmation.tools.create_files_batch.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.create_files_batch.description',
    summaryFields: ['files'],
    contentFields: ['files'],
  },
  rename_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.rename_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.rename_file.description',
    summaryFields: ['filePath', 'newName'],
  },
  move_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.move_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.move_file.description',
    summaryFields: ['sourcePath', 'targetPath'],
  },
  copy_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.copy_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.copy_file.description',
    summaryFields: ['sourcePath', 'targetPath'],
  },
  replace_editor_content: {
    titleKey: 'record.chat.input.agent.confirmation.tools.replace_editor_content.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.replace_editor_content.description',
    summaryFields: ['content'],
    contentFields: ['content'],
  },
  insert_at_cursor: {
    titleKey: 'record.chat.input.agent.confirmation.tools.insert_at_cursor.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.insert_at_cursor.description',
    summaryFields: ['content'],
    contentFields: ['content'],
  },
  delete_markdown_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.delete_markdown_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.delete_markdown_file.description',
    summaryFields: ['filePath'],
  },
  delete_markdown_files_batch: {
    titleKey: 'record.chat.input.agent.confirmation.tools.delete_markdown_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.delete_markdown_file.description',
    summaryFields: ['count', 'filesPreview'],
    contentFields: ['filesPreview'],
  },
  delete_folder: {
    titleKey: 'record.chat.input.agent.confirmation.fallback.title',
    descriptionKey: 'record.chat.input.agent.confirmation.fallback.description',
    summaryFields: ['folderPath', 'fileCount', 'filesPreview'],
    contentFields: ['filesPreview'],
  },
  delete_folders_batch: {
    titleKey: 'record.chat.input.agent.confirmation.fallback.title',
    descriptionKey: 'record.chat.input.agent.confirmation.fallback.description',
    summaryFields: ['count', 'fileCount', 'foldersPreview', 'filesPreview'],
    contentFields: ['foldersPreview', 'filesPreview'],
  },
  execute_skill_script: {
    titleKey: 'record.chat.input.agent.confirmation.tools.execute_skill_script.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.execute_skill_script.description',
    summaryFields: ['scriptName', 'command'],
  },
}

export function getToolConfirmationDisplay(toolName: string): ToolConfirmationDisplayConfig | undefined {
  return TOOL_CONFIRMATION_DISPLAY[toolName]
}

export function formatConfirmationPreview(
  toolName: string,
  params: Record<string, unknown>
): ConfirmationPreview {
  const config = getToolConfirmationDisplay(toolName)
  const orderedNames = config?.summaryFields?.filter((field) => field in params) ?? []
  const remainingNames = Object.keys(params).filter((name) => !orderedNames.includes(name))
  const fieldNames = [...orderedNames, ...remainingNames]
  const contentFields = new Set(config?.contentFields ?? [])

  return {
    titleKey: config?.titleKey ?? 'record.chat.input.agent.confirmation.fallback.title',
    descriptionKey:
      config?.descriptionKey ?? 'record.chat.input.agent.confirmation.fallback.description',
    fields: fieldNames.map((name) => ({
      name,
      labelKey: `record.chat.input.agent.confirmation.params.${name}`,
      value: params[name],
      displayType: contentFields.has(name)
        ? 'content'
        : typeof params[name] === 'object' && params[name] !== null
          ? 'json'
          : 'text',
    })),
  }
}
