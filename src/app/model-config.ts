import { AiConfig } from '@/app/core/setting/config'
import bundledPolicy from '../../config/notegen-model-policy.json'

export const noteGenDefaultModels: AiConfig[] = [
  {
    "apiKey": "sk-1eaNsBvrfrF4hpwdo6AiQlFzcEtZK7GUpBlOcg03Dm3xunbQ",
    "baseURL": "https://api.notegen.top/v1",
    "key": "note-gen-free",
    "title": bundledPolicy.title,
    "models": [
      {
        "id": "note-gen-chat",
        "model": "Limited",
        "modelType": "chat",
        "temperature": 0.7,
        "topP": 1,
        "enableStream": true
      },
      {
        "id": "note-gen-free-chat",
        "model": "free",
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
        "id": "note-gen-stt",
        "model": "FunAudioLLM/SenseVoiceSmall",
        "modelType": "stt"
      }
    ]
  }
]

export const noteGenModelKeys = ['note-gen-free', 'note-gen-limited', 'note-gen-chat', 'note-gen-free-chat', 'note-gen-embedding', 'note-gen-vlm', 'note-gen-stt']
