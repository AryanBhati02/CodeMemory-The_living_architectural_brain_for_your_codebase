export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
export interface AIRequestOptions {
    systemPrompt: string;
    messages: AIMessage[];
    maxTokens?: number;
    temperature?: number;
    extendedThinking?: boolean;
    thinkingBudget?: number;
    stream?: boolean;
    signal?: AbortSignal;
    model?: string;
}
export interface AIResponse {
  content: string;
    thinking?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
        cacheWriteTokens?: number;
        cacheReadTokens?: number;
  };
  fromCache: boolean;
  providerId: string;
  latencyMs: number;
}
export interface AIStreamChunk {
  delta: string;
  thinking?: string;
  done: boolean;
}
export type AIStreamCallback = (chunk: AIStreamChunk) => void;
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsExtendedThinking: boolean;
  supportsPromptCaching: boolean;
  supportsFunctionCalling: boolean;
  maxContextTokens: number;
  defaultModel: string;
  availableModels: string[];
}
export interface IAIProvider {
    readonly id: string;
    readonly name: string;
    readonly capabilities: ProviderCapabilities;
    readonly accentColor: string;
    readonly description: string;
    readonly apiKeyUrl: string;
    validateKey(apiKey: string): { valid: boolean; reason?: string };
    generateResponse(apiKey: string, options: AIRequestOptions): Promise<AIResponse>;
    streamResponse(
    apiKey: string,
    options: AIRequestOptions,
    onChunk: AIStreamCallback
  ): Promise<AIResponse>;
}
export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'AUTH_ERROR'
      | 'RATE_LIMIT'
      | 'CONTEXT_TOO_LONG'
      | 'NETWORK_ERROR'
      | 'INVALID_RESPONSE'
      | 'PROVIDER_ERROR',
    public readonly providerId: string,
    public readonly retryable: boolean = false,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}
