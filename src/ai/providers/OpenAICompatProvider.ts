import OpenAI from 'openai';
import {
  IAIProvider, AIRequestOptions, AIResponse,
  AIStreamCallback, AIProviderError, ProviderCapabilities,
} from './IAIProvider';
interface OpenAICompatConfig {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  availableModels?: string[];
  apiKeyUrl?: string;
  description?: string;
    requiresApiKey?: boolean;
}
export class OpenAICompatProvider implements IAIProvider {
  readonly id: string;
  readonly name: string;
  readonly accentColor = '#6B7280';
  readonly description: string;
  readonly apiKeyUrl: string;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;
  private readonly requiresApiKey: boolean;
  constructor(config: OpenAICompatConfig) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.description = config.description ?? `${config.name} — OpenAI-compatible API`;
    this.apiKeyUrl = config.apiKeyUrl ?? '';
    this.requiresApiKey = config.requiresApiKey ?? true;
    this.capabilities = {
      supportsStreaming: true,
      supportsExtendedThinking: false,
      supportsPromptCaching: false,
      supportsFunctionCalling: true,
      maxContextTokens: 128_000,
      defaultModel: config.defaultModel,
      availableModels: config.availableModels ?? [config.defaultModel],
    };
  }
  validateKey(apiKey: string): { valid: boolean; reason?: string } {
    if (!this.requiresApiKey) return { valid: true };
    if (!apiKey || apiKey.length < 20) {
      return { valid: false, reason: 'API key appears too short.' };
    }
    return { valid: true };
  }
  async generateResponse(apiKey: string, options: AIRequestOptions): Promise<AIResponse> {
    const client = this._client(apiKey);
    const t0 = Date.now();
    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: options.systemPrompt },
        ...options.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];
      const completion = await client.chat.completions.create({
        model: options.model ?? this.capabilities.defaultModel,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.3,
        messages,
      });
      const choice = completion.choices[0];
      return {
        content: choice.message.content ?? '',
        usage: {
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
        },
        fromCache: false,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      throw this._normalizeError(err);
    }
  }
  async streamResponse(apiKey: string, options: AIRequestOptions, onChunk: AIStreamCallback): Promise<AIResponse> {
    const client = this._client(apiKey);
    const t0 = Date.now();
    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: options.systemPrompt },
        ...options.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];
      const stream = await client.chat.completions.create({
        model: options.model ?? this.capabilities.defaultModel,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.3,
        messages,
        stream: true,
      });
      let fullContent = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          fullContent += delta;
          onChunk({ delta, done: false });
        }
      }
      onChunk({ delta: '', done: true });
      return {
        content: fullContent,
        usage: { inputTokens: 0, outputTokens: 0 },
        fromCache: false,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      throw this._normalizeError(err);
    }
  }
  private _client(apiKey: string): OpenAI {
    return new OpenAI({ apiKey: apiKey || 'no-key', baseURL: this.baseUrl });
  }
  private _normalizeError(err: any): AIProviderError {
    const status = err.status ?? err.statusCode;
    if (status === 401) return new AIProviderError(`${this.name}: Invalid API key.`, 'AUTH_ERROR', this.id, false, 401);
    if (status === 429) return new AIProviderError(`${this.name}: Rate limit hit.`, 'RATE_LIMIT', this.id, true, 429);
    if (status === 400) return new AIProviderError(err.message, 'CONTEXT_TOO_LONG', this.id, false, 400);
    return new AIProviderError(err.message ?? 'Unknown error', 'PROVIDER_ERROR', this.id, false, status);
  }
}
