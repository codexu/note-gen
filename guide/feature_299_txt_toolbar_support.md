# Feature #299: Centralized File Handling and Enhanced .txt Support

This pull request introduces a new centralized file handling mechanism and significantly enhances support for plain text (`.txt`) files, addressing feature request #299.

## Description of Change

This update refactors how different file types are handled within the editor. A new centralized file handler system has been implemented, allowing the application to dynamically select the appropriate editor component based on the file's extension.

Specifically for `.txt` files, dedicated support has been added:
1.  **Dedicated File Handler:** A new file handler (`src/lib/fileHandlers/text.tsx`) is introduced to specifically manage `.txt` files.
2.  **Unified Editor Experience:** The editor for `.txt` files now utilizes the same `VditorEditorWrapper` component used for Markdown files. Crucially, the previous filtering logic that removed certain toolbar options for `.txt` files has been eliminated. This ensures that `.txt` files now display the full set of editor toolbar options, identical to those available for `.md` files, providing a consistent and rich editing experience.

## Implementation Details

*   **`src/app/core/article/md-editor.tsx`:** Modified to use a `getFileHandler` function to dynamically load the correct editor component based on the `activeFilePath`. This establishes the centralized file handling.
*   **`src/lib/fileHandlers/text.tsx`:** New file handler specifically for `.txt` files, defining how they are loaded, saved, and which editor component (`VditorEditorWrapper` in `text` mode) should be used.
*   **`src/lib/fileHandlers/markdown.tsx`:** Updated to align with the new file handler structure.
*   **`src/components/VditorEditorWrapper.tsx`:** The conditional logic that previously filtered toolbar items for `mode='text'` was removed, ensuring a unified toolbar for both `.md` and `.txt` files.
*   **`src/stores/article.ts`:** Minor adjustments to support the new file handling flow.

No new UI visuals or styles were altered. The modifications are primarily functional, enhancing the application's architecture and user experience.

## Impact

*   **Improved Architecture:** The introduction of a centralized file handler makes the system more modular and extensible for future file types.
*   **Enhanced .txt Support:** Users will now have a comprehensive and consistent editing experience for `.txt` files, including a full-featured toolbar.
*   **Unified User Experience:** Provides a seamless editing environment across different text-based file formats.
*   **No Visual Changes:** The aesthetic and layout of the editor and toolbar remain unchanged.
*   **Robustness:** The changes are targeted and designed to integrate smoothly with existing components.

## Testing Notes

This feature has been verified by testing both `.md` and `.txt` files in the application. The following was confirmed:
1.  Both file types open correctly within the editor.
2.  Their respective editor toolbars display the same set of options.
3.  All toolbar functions (e.g., bold, italic, headings, lists) work as expected on `.txt` files, applying the correct formatting.
4.  Saving and reopening `.txt` files persists changes correctly.