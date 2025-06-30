import { FileHandler } from './types';
import React from 'react';

import { VditorEditorWrapper } from '@/components/VditorEditorWrapper';



export const markdownFileHandler: FileHandler = {
  type: 'markdown',
  canHandle: (filePath: string) => filePath.endsWith('.md'),
  load: (rawContent: string) => rawContent,
  save: (data: string) => data,
  getEditorComponent: ({ content, onChange }) => <VditorEditorWrapper content={content} onChange={onChange} />,
  getDisplayComponent: ({ content }) => {
    return <div>Markdown Display: {content}</div>;
  },
};
