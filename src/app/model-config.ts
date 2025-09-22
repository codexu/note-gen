import { AiConfig } from '@/app/core/setting/config'

export const noteGenDefaultModels: AiConfig[] = [
  {
    "apiKey": "sk-1eaNsBvrfrF4hpwdo6AiQlFzcEtZK7GUpBlOcg03Dm3xunbQ",
    "baseURL": "http://api.notegen.top/v1",
    "key": "note-gen-free",
    "title": "NoteGen Free",
    "models": [
      {
        "id": "note-gen-chat",
        "model": "Qwen/Qwen3-8B",
        "modelType": "chat",
        "temperature": 0.7,
        "topP": 1,
        "enableStream": true
      },
      {
        "id": "note-gen-embedding", 
        "model": "BAAI/bge-m3",
        "modelType": "embedding",
        "temperature": 0.7,
        "topP": 1
      },
      {
        "id": "note-gen-vlm",
        "model": "THUDM/GLM-4.1V-9B-Thinking", 
        "modelType": "chat",
        "temperature": 0.7,
        "topP": 1,
        "enableStream": true
      }
    ]
  }
]

export const noteGenModelKeys = ['note-gen-free', 'note-gen-limited']
