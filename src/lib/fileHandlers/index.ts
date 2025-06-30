import { FileHandler } from './types';
import { markdownFileHandler } from './markdown.tsx';
import { textFileHandler } from './text.tsx';

const handlers: FileHandler[] = [
  markdownFileHandler,
  textFileHandler,
  // Add more handlers here as needed
];

export function getFileHandler(filePath: string): FileHandler | undefined {
  return handlers.find(handler => handler.canHandle(filePath));
}
