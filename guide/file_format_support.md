# Comprehensive File Format Support in NoteGen

## 1. Introduction

This document details the new, centralized file handling architecture within the NoteGen application. This robust system is designed to provide comprehensive support for various file formats, including the recently added `.txt` format, and is built for future extensibility. The primary goal is to enable seamless integration of new file types with minimal changes to the core application logic, ensuring a future-proof and adaptable system.

## 2. Core Concept: FileHandler Interface

To achieve extensibility, a `FileHandler` interface has been introduced. This interface defines a contract that each supported file type must adhere to, centralizing the logic for how each file type is loaded, edited, displayed, and saved.

### `FileHandler` Interface Definition (`src/lib/fileHandlers/types.ts`)

```typescript
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
```

## 3. Implementation Details

This section delves into the practical implementation of the `FileHandler` system, showcasing how individual file types are managed and integrated into the application. The successful integration of `.txt` file support serves as a prime example of this architecture's effectiveness and extensibility.

### 3.1. Individual File Handlers

Each file format will have its own dedicated handler that implements the `FileHandler` interface.

#### Markdown File Handler (`src/lib/fileHandlers/markdown.ts`)

This handler is responsible for managing Markdown files. It uses `vditor` for both editing and displaying Markdown content.

```typescript
import { FileHandler } from './types';
import React from 'react';

// Assuming Vditor is used for Markdown editing and display
// You'll need to replace this with your actual Vditor component or logic
const MockVditorEditor = ({ content, onChange }: { content: string; onChange: (newContent: string) => void }) => {
  // In a real scenario, this would be your Vditor component
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', height: '400px' }}
      placeholder="Markdown Editor (Mock)"
    />
  );
};

const MockVditorDisplay = ({ content }: { content: string }) => {
  // In a real scenario, this would be your Vditor preview or Markdown renderer
  return (
    <div
      dangerouslySetInnerHTML={{ __html: `<p>Markdown Display (Mock):</p><pre>${content}</pre>` }}
      style={{ border: '1px solid #ccc', padding: '10px' }}
    />
  );
};

export const markdownFileHandler: FileHandler = {
  type: 'markdown',
  canHandle: (filePath: string) => filePath.endsWith('.md'),
  load: (rawContent: string) => rawContent,
  save: (data: string) => data,
  getEditorComponent: ({ content, onChange }) => <MockVditorEditor content={content} onChange={onChange} />,
  getDisplayComponent: ({ content }) => <MockVditorDisplay content={content} />,
};
```

#### Plain Text File Handler (`src/lib/fileHandlers/text.ts`)

This handler is designed for plain text files (`.txt`). It configures `vditor` (or a simple `textarea` as a fallback) to provide a basic text editing experience without Markdown rendering.

```typescript
import { FileHandler } from './types';
import React from 'react';

// Assuming Vditor can be configured for plain text, or a simple textarea is used
const PlainTextEditor = ({ content, onChange }: { content: string; onChange: (newContent: string) => void }) => {
  // This would ideally be a Vditor instance configured for plain text
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', height: '400px' }}
      placeholder="Plain Text Editor"
    />
  );
};

const PlainTextDisplay = ({ content }: { content: string }) => {
  return (
    <pre style={{ border: '1px solid #ccc', padding: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
      {content}
    </pre>
  );
};

export const textFileHandler: FileHandler = {
  type: 'text',
  canHandle: (filePath: string) => filePath.endsWith('.txt'),
  load: (rawContent: string) => rawContent,
  save: (data: string) => data,
  getEditorComponent: ({ content, onChange }) => <PlainTextEditor content={content} onChange={onChange} />,
  getDisplayComponent: ({ content }) => <PlainTextDisplay content={content} />,
};
```

### 3.2. Central Dispatcher (`src/lib/fileHandlers/index.ts`)

This module acts as a central registry for all `FileHandler` implementations. When a file is opened, it determines the correct handler based on the file's path.

```typescript
import { FileHandler } from './types';
import { markdownFileHandler } from './markdown';
import { textFileHandler } from './text';

const handlers: FileHandler[] = [
  markdownFileHandler,
  textFileHandler,
  // Add more handlers here as needed
];

export function getFileHandler(filePath: string): FileHandler | undefined {
  return handlers.find(handler => handler.canHandle(filePath));
}
```

### 3.3. Integration with Application Logic

#### `src/stores/article.ts` Modifications

The `readArticle` and `saveCurrentArticle` functions in the `article` Zustand store have been updated to leverage the `FileHandler` system. Instead of directly reading/writing file content, they now use the appropriate `FileHandler` to `load` and `save` the content, ensuring proper parsing and serialization for each file type.

**`readArticle` (Excerpt):**

```typescript
  readArticle: async (path: string, sha?: string, isLocale = true) => {
    get().setLoading(true)
    const handler = getFileHandler(path)
    if (!handler) {
      console.error(`No file handler found for path: ${path}`)
      get().setLoading(false)
      return
    }

    if (isLocale) {
      try {
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        let content = ''
        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        set({ currentArticle: handler.load(content) })
      // ... (rest of the function)
    }
  },
```

**`saveCurrentArticle` (Excerpt):**

```typescript
  saveCurrentArticle: async (content: string) => {
    if (content) {
      const path = get().activeFilePath
      const workspace = await getWorkspacePath()
      const handler = getFileHandler(path)
      if (!handler) {
        console.error(`No file handler found for path: ${path}`)
        return
      }

      // ... (directory existence checks)
      
      // 保存文件内容
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, handler.save(content))
      } else {
        await writeTextFile(pathOptions.path, handler.save(content), { baseDir: pathOptions.baseDir })
      }
      
      // ... (rest of the function)
    }
  },
```

#### `src/app/core/article/md-editor.tsx` Modifications

The `MdEditor` component has been refactored to dynamically render the appropriate editor component based on the detected file type. It now uses the `fileHandler.getEditorComponent()` method to render the editor, passing the `currentArticle` content and a `handleContentChange` callback.

**Conditional Rendering (Excerpt):**

```typescript
  return <div className='flex-1 w-full h-full lg:h-screen flex flex-col overflow-hidden dark:bg-zinc-950'>
    <CustomToolbar editor={editor} />
    {fileHandler && fileHandler.getEditorComponent({
      content: currentArticle,
      onChange: handleContentChange,
    })}
    <CustomFooter editor={editor} />
  </div>
```

Additionally, `useEffect` hooks within `MdEditor` that are specific to Vditor (e.g., `init()`, `setContent()`, `handleLocalImage()`, `setTheme()`, and toolbar event listeners) have been updated to only execute when the `fileHandler.type` is `'markdown'`, ensuring that Vditor-specific logic is not applied to other file types.

## 4. Adding New File Formats (e.g., `.json`)

To add support for a new file format like `.json`, follow these steps:

1.  **Create a new handler file:** Create `src/lib/fileHandlers/json.ts`.
2.  **Implement `FileHandler`:** Implement the `FileHandler` interface within `json.ts`.
    *   `canHandle`: Check for `.json` extension.
    *   `load`: Use `JSON.parse()` to convert the raw string content into a JavaScript object.
    *   `save`: Use `JSON.stringify(data, null, 2)` to convert the JavaScript object back into a pretty-printed JSON string.
    *   `getEditorComponent`: Provide a React component for editing JSON. This could be a simple `<textarea>` or a more advanced JSON editor library.
    *   `getDisplayComponent`: Provide a React component for displaying JSON, potentially with syntax highlighting.
3.  **Register the new handler:** Import and add the `jsonFileHandler` to the `handlers` array in `src/lib/fileHandlers/index.ts`.

This modular approach ensures that adding new file formats is a straightforward process, requiring changes only to the new handler file and the central dispatcher, without impacting existing file type logic or core application components.