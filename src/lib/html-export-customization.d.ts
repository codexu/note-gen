export interface HtmlExportConfig {
  css: string
  javascript: string
}

export function customizeHtmlExport(html: string, config: HtmlExportConfig): string
