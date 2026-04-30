
import {
  IAIProvider, AIRequestOptions, AIResponse,
  AIStreamCallback, AIProviderError, ProviderCapabilities,
} from './IAIProvider';

const FALLBACK_MODELS = ['llama3.3', 'mistral', 'qwen2.5', 'deepseek-r1', 'phi4'];

export class OllamaProvider implements IAIProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';
  readonly accentColor = '#6B7280';
  readonly description = 'Local LLMs — zero cost, fully private';
  readonly apiKeyUrl = 'https://ollama.ai';

  private readonly baseUrl: string;

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsExtendedThinking: false,
    supportsPromptCaching: false,
    supportsFunctionCalling: false,
    maxContextTokens: 128_000,
    defaultModel: 'llama3.3',
    availableModels: [...FALLBACK_MODELS],
  };

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  validateKey(_apiKey: string): { valid: boolean; reason?: string } {
    return { valid: true };
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return FALLBACK_MODELS;
      const data = await res.json() as { models: { name: string }[] };
      const names = data.models?.map((m) => m.name) ?? [];
      if (names.length > 0) {
        this.capabilities.availableModels = names;
      }
      return names.length > 0 ? names : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  async generateResponse(_apiKey: string, options: AIRequestOptions): Promise<AIResponse> {
    const t0 = Date.now();

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model ?? this.capabilities.defaultModel,
          messages: [
            { role: 'system', content: options.systemPrompt },
            ...options.messages,
          ],
          stream: false,
        }),
        signal: options.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new AIProviderError(
          `Ollama error ${res.status}: ${body}`,
          'PROVIDER_ERROR',
          this.id,
          false,
          res.status,
        );
      }

      const data = await res.json() as {
        message: { content: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      return {
        content: data.message.content,
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
        },
        fromCache: false,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      if (err instanceof AIProviderError) throw err;
      throw this._normalizeError(err);
    }
  }

  async streamResponse(_apiKey: string, options: AIRequestOptions, onChunk: AIStreamCallback): Promise<AIResponse> {
    const t0 = Date.now();

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model ?? this.capabilities.defaultModel,
          messages: [
            { role: 'system', content: options.systemPrompt },
            ...options.messages,
          ],
          stream: true,
        }),
        signal: options.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new AIProviderError(
          `Ollama error ${res.status}: ${body}`,
          'PROVIDER_ERROR',
          this.id,
          false,
          res.status,
        );
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          this._processStreamLine(line, (delta, isDone) => {
            if (!isDone) fullContent += delta;
            onChunk({ delta, done: isDone });
          });
        }
      }

      // Flush any remaining buffered bytes after the stream closes
      if (buffer.trim()) {
        this._processStreamLine(buffer, (delta, isDone) => {
          if (!isDone) fullContent += delta;
          onChunk({ delta, done: isDone });
        });
      }

      return {
        content: fullContent,
        usage: { inputTokens: 0, outputTokens: 0 },
        fromCache: false,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      if (err instanceof AIProviderError) throw err;
      throw this._normalizeError(err);
    }
  }

  private _processStreamLine(line: string, emit: (delta: string, done: boolean) => void): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: { message: { content: string }; done: boolean };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return; // skip malformed lines (e.g. Ollama error text before JSON)
    }
    if (parsed.done) {
      emit('', true);
    } else if (parsed.message?.content) {
      emit(parsed.message.content, false);
    }
  }

  private _normalizeError(err: any): AIProviderError {
    const isConnRefused =
      err?.cause?.code === 'ECONNREFUSED' ||
      err?.message?.includes('ECONNREFUSED') ||
      err?.message?.includes('fetch failed');
    if (isConnRefused) {
      return new AIProviderError(
        'Ollama is not running. Start it with: ollama serve',
        'PROVIDER_ERROR',
        this.id,
        true,
      );
    }
    return new AIProviderError(err.message ?? 'Unknown Ollama error', 'PROVIDER_ERROR', this.id, false);
  }
}
