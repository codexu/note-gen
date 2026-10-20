export interface ToolConfirmationDisplayConfig {
  titleKey: string
  descriptionKey: string
  summaryFields?: string[]
  contentFields?: string[]
  parameterLabels?: Record<string, string>
  hiddenFields?: string[]
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
  memory_create: {
    titleKey: 'record.chat.input.agent.confirmation.tools.create_memory.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.create_memory.description',
    summaryFields: ['content'],
    contentFields: ['content'],
    parameterLabels: {
      content: 'record.chat.input.agent.confirmation.tools.create_memory.content',
    },
    hiddenFields: ['category', 'scope', 'conflict_key'],
  },
  note_create_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.create_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.create_file.description',
    summaryFields: ['filePath', 'fileName', 'folderPath', 'content'],
    contentFields: ['content'],
  },
  create_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.create_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.create_file.description',
    summaryFields: ['filePath', 'content'],
    contentFields: ['content'],
  },
  note_update_file: {
    titleKey: 'record.chat.input.agent.confirmation.fallback.title',
    descriptionKey: 'record.chat.input.agent.confirmation.fallback.description',
    summaryFields: ['filePath', 'content'],
    contentFields: ['content'],
  },
  editor_apply_transaction: {
    titleKey: 'record.chat.input.agent.confirmation.tools.replace_editor_content.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.replace_editor_content.description',
    summaryFields: ['filePath', 'operations'],
    contentFields: ['operations'],
  },
  editor_replace_range: {
    titleKey: 'record.chat.input.agent.confirmation.tools.replace_editor_content.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.replace_editor_content.description',
    summaryFields: ['content'],
    contentFields: ['content'],
  },
  editor_replace_lines: {
    titleKey: 'record.chat.input.agent.confirmation.tools.replace_editor_content.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.replace_editor_content.description',
    summaryFields: ['startLine', 'endLine', 'replaceContent'],
    contentFields: ['replaceContent'],
  },
  editor_insert_at_cursor: {
    titleKey: 'record.chat.input.agent.confirmation.tools.insert_at_cursor.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.insert_at_cursor.description',
    summaryFields: ['content'],
    contentFields: ['content'],
  },
  canvas_apply_operations: {
    titleKey: 'record.chat.input.agent.confirmation.tools.canvas_apply_operations.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.canvas_apply_operations.description',
    summaryFields: ['operations'],
    contentFields: ['operations'],
  },
  canvas_create_diagram: {
    titleKey: 'record.chat.input.agent.confirmation.tools.canvas_apply_operations.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.canvas_apply_operations.description',
    summaryFields: ['replaceExisting', 'nodes', 'edges'],
    contentFields: ['nodes', 'edges'],
  },
  note_delete_file: {
    titleKey: 'record.chat.input.agent.confirmation.tools.delete_markdown_file.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.delete_markdown_file.description',
    summaryFields: ['filePath'],
  },
  folder_delete: {
    titleKey: 'record.chat.input.agent.confirmation.fallback.title',
    descriptionKey: 'record.chat.input.agent.confirmation.fallback.description',
    summaryFields: ['folderPath'],
  },
  skill_execute_script: {
    titleKey: 'record.chat.input.agent.confirmation.tools.execute_skill_script.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.execute_skill_script.description',
    summaryFields: ['skill_id', 'script_id', 'args'],
  },
  skill_install_python_dependencies: {
    titleKey: 'record.chat.input.agent.confirmation.tools.install_skill_python_dependencies.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.install_skill_python_dependencies.description',
    summaryFields: ['skill_id', 'packages'],
  },
  skill_install_package: {
    titleKey: 'record.chat.input.agent.confirmation.fallback.title',
    descriptionKey: 'record.chat.input.agent.confirmation.fallback.description',
    summaryFields: ['name', 'scope', 'description', 'replaceExisting', 'removeFiles', 'files', 'instructions'],
    contentFields: ['files', 'instructions'],
  },
  skill_install_source: {
    titleKey: 'record.chat.input.agent.confirmation.tools.install_remote_skill.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.install_remote_skill.description',
    summaryFields: ['name', 'source', 'revision', 'scope', 'warnings', 'replaceExisting'],
  },
  skill_uninstall: {
    titleKey: 'record.chat.input.agent.confirmation.tools.uninstall_skill.title',
    descriptionKey: 'record.chat.input.agent.confirmation.tools.uninstall_skill.description',
    summaryFields: ['skill_id', 'scope'],
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
  const hiddenFields = new Set(config?.hiddenFields ?? [])
  const orderedNames = config?.summaryFields?.filter(
    (field) => field in params && !hiddenFields.has(field)
  ) ?? []
  const remainingNames = Object.keys(params).filter(
    (name) => !orderedNames.includes(name) && !hiddenFields.has(name)
  )
  const fieldNames = [...orderedNames, ...remainingNames]
  const contentFields = new Set(config?.contentFields ?? [])

  return {
    titleKey: config?.titleKey ?? 'record.chat.input.agent.confirmation.fallback.title',
    descriptionKey:
      config?.descriptionKey ?? 'record.chat.input.agent.confirmation.fallback.description',
    fields: fieldNames.map((name) => ({
      name,
      labelKey: config?.parameterLabels?.[name]
        ?? `record.chat.input.agent.confirmation.params.${name}`,
      value: params[name],
      displayType: contentFields.has(name)
        ? 'content'
        : typeof params[name] === 'object' && params[name] !== null
          ? 'json'
          : 'text',
    })),
  }
}
