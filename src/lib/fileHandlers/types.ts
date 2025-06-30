import React from 'react';

export interface FileHandler {
  /** Unique identifier for the file type (e.g., 'markdown', 'text', 'json') */
  type: string;
  /** Checks if this handler can process a given file path/extension. */
  canHandle: (filePath: string) => boolean;
  /** Parses raw file content into a structured data representation. */
  load: (rawContent: string) => any;
  /** Serializes structured data back into raw content for saving. */
  save: (data: any) => string;
  /** Returns the React component used for editing this file type. */
  getEditorComponent: (props: { content: any; onChange: (newContent: any) => void }) => React.ReactNode;
  /** Returns the React component used for displaying/previewing this file type. */
  getDisplayComponent: (props: { content: any }) => React.ReactNode;
}
