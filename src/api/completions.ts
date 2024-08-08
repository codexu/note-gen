import axios from 'axios'

axios.defaults.headers.post['Content-Type'] = 'application/json'

const key = import.meta.env.VITE_APP_SK_KEY

axios.defaults.headers.common['Authorization'] = `Bearer ${key}`
axios.defaults.headers.common['Content-Type'] = 'application/json'

export interface Data {
  model: string;
  messages: Message[];
}

interface Message {
  role: string;
  content: string;
}

interface Result {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Choice[];
  usage: Usage;
  system_fingerprint: null;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface Choice {
  index: number;
  message: Message;
  logprobs: null;
  finish_reason: string;
}

interface Message {
  role: string;
  content: string;
}

function getCompletions(data: Data) {
  return axios.post<Result>('https://api.chatanywhere.tech/v1/chat/completions', data)
}

export { getCompletions }