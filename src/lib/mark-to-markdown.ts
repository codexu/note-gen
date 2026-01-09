import { Mark } from "@/db/marks";

/**
 * Convert a Mark record to markdown format based on its type
 */
export function markToMarkdown(mark: Mark): string {
  switch (mark.type) {
    case 'text':
      // Text: insert content directly
      return mark.content || '';
    
    case 'image':
      // Image: insert as markdown image with description
      const imageDesc = mark.desc || 'image';
      return `![${imageDesc}](${mark.url})`;
    
    case 'scan':
      // Screenshot: similar to image
      const scanDesc = mark.desc || 'screenshot';
      return `![${scanDesc}](${mark.url})`;
    
    case 'link':
      // Link: insert as markdown link with description
      const linkDesc = mark.desc || mark.url;
      return `[${linkDesc}](${mark.url})`;
    
    case 'file':
      // File: insert file link first, then content (e.g., extracted PDF text)
      const fileName = mark.desc || 'file';
      const fileLink = `[${fileName}](${mark.url})`;
      const fileContent = mark.content || '';
      // 如果有内容，先插入文件链接，然后是内容
      return fileContent ? `${fileLink}\n\n${fileContent}` : fileLink;
    
    case 'recording':
      // Recording: insert content (transcription) with audio link
      const recordingContent = mark.content || '';
      const audioLink = mark.url ? `\n\n[🎵 Audio Recording](${mark.url})` : '';
      return recordingContent + audioLink;
    
    default:
      return mark.content || '';
  }
}
