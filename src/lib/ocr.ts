import { createWorker } from 'tesseract.js';
import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { Store } from '@tauri-apps/plugin-store';

export default async function ocr(path: string): Promise<string> {
  try {
    const stroe = await Store.load('store.json')
    const lang = await stroe.get<string>('tesseractList')
    const langArr = (lang as string)?.split(',') || ['eng']
    
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject('OCR 識別失敗'), 30000)
    })

    const workerPromise = (async () => {
      const image = await readFile(path, { baseDir: BaseDirectory.AppData });
      const blob = new Blob([image])
      const worker = await createWorker(langArr)
      const ret = (await worker.recognize(blob)).data.text;
      await worker.terminate();
      return ret
    })()

    return await Promise.race([workerPromise, timeoutPromise])
  } catch (error) {
    return error as string
  }
}