export interface OpenAIResult {
  id: string;
  choices: OpenAIChoice[];
  created: number;
  model: string;
  object: string;
  usage: Usage;
  system_fingerprint: string;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIChoice {
  index: number;
  message: Message;
  logprobs: null;
  finish_reason: string;
}

interface Message {
  role: string;
  content: string;
}

export interface AiModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface GeminiResult {
  candidates: GeminiCandidate[];
  promptFeedback: PromptFeedback;
}

interface GeminiCandidate {
  content: {
    parts: {
      text: string;
    }[];
    role: string;
  };
  finishReason: string;
  index: number;
  safetyRatings: SafetyRating[];
}

interface SafetyRating {
  category: string;
  probability: string;
}

interface PromptFeedback {
  safetyRatings: SafetyRating[];
}