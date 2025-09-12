import { AiConfig } from '@/app/core/setting/config'

export const noteGenDefaultModels: AiConfig[] = [
  {
    "apiKey": "sk-1eaNsBvrfrF4hpwdo6AiQlFzcEtZK7GUpBlOcg03Dm3xunbQ",
    "baseURL": "http://api.notegen.top/v1",
    "key": "note-gen-chat",
    "model": "Qwen/Qwen3-8B",
    "modelType": "chat",
    "temperature": 0.7,
    "title": "NoteGen Chat",
    "topP": 1
  },
  {
    "apiKey": "sk-1eaNsBvrfrF4hpwdo6AiQlFzcEtZK7GUpBlOcg03Dm3xunbQ",
    "baseURL": "http://api.notegen.top/v1",
    "key": "note-gen-embedding",
    "model": "BAAI/bge-m3",
    "modelType": "embedding",
    "temperature": 0.7,
    "title": "NoteGen Embedding",
    "topP": 1
  },
  {
    "apiKey": "sk-1eaNsBvrfrF4hpwdo6AiQlFzcEtZK7GUpBlOcg03Dm3xunbQ",
    "baseURL": "http://api.notegen.top/v1",
    "key": "note-gen-vlm",
    "model": "THUDM/GLM-4.1V-9B-Thinking",
    "modelType": "chat",
    "temperature": 0.7,
    "title": "NoteGen VLM",
    "topP": 1
  }
]

export const noteGenModelKeys = ['note-gen-chat', 'note-gen-embedding', 'note-gen-vlm']
