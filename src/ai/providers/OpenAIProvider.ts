
import OpenAI from 'openai';
import {
  IAIProvider, AIRequestOptions, AIResponse,
  AIStreamCallback, AIProviderError, ProviderCapabilities,
} from './IAIProvider';

export class OpenAIProvider implements IAIProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  readonly accentColor = '#10A37F';
  readonly description = 'OpenAI GPT-4.1 — fast, capable, broad availability';
  readonly apiKeyUrl = 'https://platform.openai.com/api-keys';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsExtendedThinking: false,
    supportsPromptCaching: false,
    supportsFunctionCalling: true,
    maxContextTokens: 128_000,
    defaultModel: 'gpt-4.1',
    availableModels: ['gpt-5.4', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4-turbo'],
  };

  validateKey(apiKey: string): { valid: boolean; reason?: string } {
    if (!apiKey?.startsWith('sk-')) {
      return { valid: false, reason: 'OpenAI keys begin with "sk-".' };
    }
    if (apiKey.length < 40) {
      return { valid: false, reason: 'Key appears too short.' };
    }
    return { valid: true };
  }

  async generateResponse(apiKey: string, options: AIRequestOptions): Promise<AIResponse> {
    const client = new OpenAI({ apiKey });
    const t0 = Date.now();

    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: options.systemPrompt },
        ...options.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      const completion = await client.chat.completions.create({
        model: this.capabilities.defaultModel,
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
    const client = new OpenAI({ apiKey });
    const t0 = Date.now();

    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: options.systemPrompt },
        ...options.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      const stream = await client.chat.completions.create({
        model: this.capabilities.defaultModel,
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
        usage: { inputTokens: 0, outputTokens: 0 }, // stream doesn't return usage in all versions
        fromCache: false,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      throw this._normalizeError(err);
    }
  }

  private _normalizeError(err: any): AIProviderError {
    const status = err.status ?? err.statusCode;
    if (status === 401) return new AIProviderError('Invalid OpenAI API key.', 'AUTH_ERROR', this.id, false, 401);
    if (status === 429) return new AIProviderError('OpenAI rate limit hit.', 'RATE_LIMIT', this.id, true, 429);
    if (status === 400) return new AIProviderError(err.message, 'CONTEXT_TOO_LONG', this.id, false, 400);
    return new AIProviderError(err.message ?? 'Unknown error', 'PROVIDER_ERROR', this.id, false, status);
  }
}
