
import Anthropic from '@anthropic-ai/sdk';
import {
  IAIProvider, AIRequestOptions, AIResponse,
  AIStreamCallback, AIProviderError, ProviderCapabilities,
} from './IAIProvider';


interface ExtendedThinkingParams {
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number };
  output_config?: { effort: 'high' };
}
type ExtendedMessageParams = Anthropic.MessageCreateParamsNonStreaming & ExtendedThinkingParams;
type ExtendedStreamParams  = Anthropic.MessageStreamParams & ExtendedThinkingParams;


interface ThinkingBlock { type: 'thinking'; thinking: string }
type ResponseBlock = Anthropic.ContentBlock | ThinkingBlock;


interface AnthropicUsageWithCaching {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

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
    maxContextTokens: 1_000_000,
    defaultModel: 'claude-sonnet-4-6',
    availableModels: [
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ],
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
    const requestModel = options.model ?? this.capabilities.defaultModel;

    try {
      const systemContent: Anthropic.TextBlockParam = {
        type: 'text',
        text: options.systemPrompt,
        cache_control: { type: 'ephemeral' }, 
      };

      const body: ExtendedMessageParams = {
        model: requestModel,
        max_tokens: options.maxTokens ?? 2048,
        system: [systemContent],
        messages: options.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      };

      if (!this._isOpus47(requestModel)) {
        body.temperature = options.temperature ?? 0.3;
      }

      if (options.extendedThinking) {
        if (this._isOpus47(requestModel)) {
          body.thinking    = { type: 'adaptive' } as any;
          body.output_config = { effort: 'high' };
        } else {
          body.thinking = { type: 'enabled', budget_tokens: options.thinkingBudget ?? 4096 };
        }
      }

      const msg = await client.messages.create(body);

      let content = '';
      let thinking = '';
      for (const block of msg.content as ResponseBlock[]) {
        if (block.type === 'text')     content  += block.text;
        if (block.type === 'thinking') thinking += block.thinking ?? '';
      }

      const usage = msg.usage as AnthropicUsageWithCaching;
      return {
        content,
        thinking: thinking || undefined,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens:  usage.cache_read_input_tokens  ?? 0,
        },
        fromCache: (usage.cache_read_input_tokens ?? 0) > 0,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: unknown) {
      throw this._normalizeError(err);
    }
  }

  /** Send a streaming request and call onChunk for each text delta. */
  async streamResponse(apiKey: string, options: AIRequestOptions, onChunk: AIStreamCallback): Promise<AIResponse> {
    const client = new Anthropic({ apiKey });
    const t0 = Date.now();
    const requestModel = options.model ?? this.capabilities.defaultModel;

    try {
      const systemContent: Anthropic.TextBlockParam = {
        type: 'text',
        text: options.systemPrompt,
        cache_control: { type: 'ephemeral' },
      };

      const params: ExtendedStreamParams = {
        model: requestModel,
        max_tokens: options.maxTokens ?? 2048,
        system: [systemContent],
        messages: options.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      };

      if (!this._isOpus47(requestModel)) {
        params.temperature = options.temperature ?? 0.3;
      }

      if (options.extendedThinking) {
        if (this._isOpus47(requestModel)) {
          params.thinking      = { type: 'adaptive' } as any;
          params.output_config = { effort: 'high' };
        } else {
          params.thinking = { type: 'enabled', budget_tokens: options.thinkingBudget ?? 4096 };
        }
      }

      const stream = client.messages.stream(params);

      let fullContent = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const delta = event.delta.text;
          fullContent += delta;
          onChunk({ delta, done: false });
        }
      }
      onChunk({ delta: '', done: true });

      const msg   = await (stream as any).getFinalMessage();
      const usage = msg.usage as AnthropicUsageWithCaching;
      return {
        content: fullContent,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens:  usage.cache_read_input_tokens  ?? 0,
        },
        fromCache: (usage.cache_read_input_tokens ?? 0) > 0,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: unknown) {
      throw this._normalizeError(err);
    }
  }

  private _isOpus47(model: string): boolean {
    return model.includes('opus-4-7');
  }

  private _normalizeError(err: unknown): AIProviderError {
    const e = err as { status?: number; statusCode?: number; message?: string };
    const status = e.status ?? e.statusCode;
    if (status === 401) return new AIProviderError('Invalid Anthropic API key.', 'AUTH_ERROR', this.id, false, 401);
    if (status === 429) return new AIProviderError('Anthropic rate limit hit.', 'RATE_LIMIT', this.id, true, 429);
    if (status === 400 && e.message?.includes('context')) return new AIProviderError('Context too long.', 'CONTEXT_TOO_LONG', this.id, false, 400);
    return new AIProviderError(e.message ?? 'Unknown error', 'PROVIDER_ERROR', this.id, false, status);
  }
}
