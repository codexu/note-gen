import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import { fetch } from '@tauri-apps/plugin-http'
import { _t } from '@/locales/index';

const chatURL = '/chat/completions'

async function createAi(text: string) {
  const store = await Store.load('store.json')
  const apiKey = await store.get('apiKey')
  const model = await store.get('model')

  const headers = new Headers();
  headers.append("Authorization", `Bearer ${apiKey}`);
  headers.append("Content-Type", "application/json");

  const body = JSON.stringify({
    model,
    messages: [
      {
        role: 'user',
        content: text
      }
    ],
    stream: false
  });

  const requestOptions = {
    method: 'POST',
    headers,
    body,
  };

  return requestOptions;
}

export async function fetchAi(text: string): Promise<string> {
  const requestOptions = await createAi(text)
  const store = await Store.load('store.json')
  const baseURL = await store.get<string>('baseURL')
  const aiType = await store.get<string>('aiType')
  const url = baseURL + `${aiType === 'ollama' ? '/api/chat' : chatURL}`
  if (!url) {
    toast({
      title: _t('ai_error'),
      description: _t('please_set_ai_address'),
      variant: 'destructive',
    })
  } else {
    const res = await (await fetch(url, requestOptions)).json()
    if (res.error) {
      toast({
        title: _t('ai_error'),
        description: res.error.message,
        variant: 'destructive',
      })
      return res.error.message
    } else {
      if (aiType === 'ollama') {
        return res.message.content
      } else {
        return res.choices[0].message.content
      }
    }
  }
  return ''
}

export async function fetchAiDesc(text: string) {
  const store = await Store.load('store.json')
  const baseURL = await store.get<string>('baseURL')
  const aiType = await store.get<string>('aiType')
  const url = baseURL + `${aiType === 'ollama' ? '/api/chat' : chatURL}`
  if (!url) return;
  const descContent = `
    根据内容：${text}，返回一段关于截图的描述，不要超过50字，不要包含特殊字符。
  `
  const requestOptions = await createAi(descContent)
  const res = await (await fetch(url, requestOptions)).json()
  if (res.error) {
    toast({
      title: _t('ai_error'),
      description: res.error.message,
      variant: 'destructive',
    })
    return null
  } else {
    if (aiType === 'ollama') {
      return res.message.content
    } else {
      return res.choices[0].message.content
    }
  }
}
