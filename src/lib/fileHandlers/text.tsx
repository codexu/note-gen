import { FileHandler } from './types';
import React from 'react';

const PlainTextEditor = ({ content, onChange }: { content: string; onChange: (newContent: string) => void }) => {
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', height: '100%', border: 'none', outline: 'none', resize: 'none', padding: '10px', fontFamily: 'monospace' }}
      placeholder="Plain Text Editor"
    />
  );
};



export const textFileHandler: FileHandler = {
  type: 'text',
  canHandle: (filePath: string) => filePath.endsWith('.txt'),
  load: (rawContent: string) => rawContent,
  save: (data: string) => data,
  getEditorComponent: ({ content, onChange }) => <PlainTextEditor content={content} onChange={onChange} />,
  getDisplayComponent: ({ content }) => {
    return <div>Plain Text Display: {content}</div>;
  },
};
