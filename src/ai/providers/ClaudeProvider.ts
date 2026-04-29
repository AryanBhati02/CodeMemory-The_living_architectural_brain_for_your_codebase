
import Anthropic from '@anthropic-ai/sdk';
import {
  IAIProvider, AIRequestOptions, AIResponse,
  AIStreamCallback, AIProviderError, ProviderCapabilities,
} from './IAIProvider';

export class ClaudeProvider implements IAIProvider {
  readonly id = 'claude';
  readonly name = 'Claude';
  readonly accentColor = '#D4A574';
  readonly description = 'Anthropic Claude — best reasoning, extended thinking, prompt caching';
  readonly apiKeyUrl = 'https://console.anthropic.com/settings/keys';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsExtendedThinking: true,
    supportsPromptCaching: true,
    supportsFunctionCalling: true,
    maxContextTokens: 200_000,
    defaultModel: 'claude-sonnet-4-5',
    availableModels: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001'],
  };

  validateKey(apiKey: string): { valid: boolean; reason?: string } {
    if (!apiKey?.startsWith('sk-ant-')) {
      return { valid: false, reason: 'Anthropic keys begin with "sk-ant-".' };
    }
    if (apiKey.length < 40) {
      return { valid: false, reason: 'Key appears too short.' };
    }
    return { valid: true };
  }

  async generateResponse(apiKey: string, options: AIRequestOptions): Promise<AIResponse> {
    const client = new Anthropic({ apiKey });
    const t0 = Date.now();

    try {
      const systemContent: Anthropic.TextBlockParam & { cache_control?: { type: 'ephemeral' } } = {
        type: 'text',
        text: options.systemPrompt,
        cache_control: { type: 'ephemeral' }, 
      };

      const body: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.capabilities.defaultModel,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.extendedThinking ? 1 : (options.temperature ?? 0.3),
        system: [systemContent as any],
        messages: options.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      };

      if (options.extendedThinking) {
        (body as any).thinking = {
          type: 'enabled',
          budget_tokens: options.thinkingBudget ?? 4096,
        };
      }

      const msg = await client.messages.create(body);

      let content = '';
      let thinking = '';
      for (const block of msg.content) {
        if (block.type === 'text') content += block.text;
        if ((block as any).type === 'thinking') thinking += (block as any).thinking ?? '';
      }

      const usage = msg.usage as any;
      return {
        content,
        thinking: thinking || undefined,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        },
        fromCache: (usage.cache_read_input_tokens ?? 0) > 0,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      throw this._normalizeError(err);
    }
  }

  async streamResponse(apiKey: string, options: AIRequestOptions, onChunk: AIStreamCallback): Promise<AIResponse> {
    const client = new Anthropic({ apiKey });
    const t0 = Date.now();

    try {
      const systemContent = { type: 'text', text: options.systemPrompt, cache_control: { type: 'ephemeral' } };

      const stream = client.messages.stream({
        model: this.capabilities.defaultModel,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.3,
        system: [systemContent as any],
        messages: options.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      });

      let fullContent = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && (event.delta as any).type === 'text_delta') {
          const delta = (event.delta as any).text ?? '';
          fullContent += delta;
          onChunk({ delta, done: false });
        }
      }
      onChunk({ delta: '', done: true });

      const msg = await stream.getFinalMessage();
      const usage = msg.usage as any;
      return {
        content: fullContent,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        },
        fromCache: (usage.cache_read_input_tokens ?? 0) > 0,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      throw this._normalizeError(err);
    }
  }

  private _normalizeError(err: any): AIProviderError {
    const status = err.status ?? err.statusCode;
    if (status === 401) return new AIProviderError('Invalid Anthropic API key.', 'AUTH_ERROR', this.id, false, 401);
    if (status === 429) return new AIProviderError('Anthropic rate limit hit.', 'RATE_LIMIT', this.id, true, 429);
    if (status === 400 && err.message?.includes('context')) return new AIProviderError('Context too long.', 'CONTEXT_TOO_LONG', this.id, false, 400);
    return new AIProviderError(err.message ?? 'Unknown error', 'PROVIDER_ERROR', this.id, false, status);
  }
}
