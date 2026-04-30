import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import {
  IAIProvider, AIRequestOptions, AIResponse,
  AIStreamCallback, AIProviderError, ProviderCapabilities,
} from './IAIProvider';
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];
export class GeminiProvider implements IAIProvider {
  readonly id = 'gemini';
  readonly name = 'Gemini';
  readonly accentColor = '#4285F4';
  readonly description = 'Google Gemini — 1M context window, multimodal';
  readonly apiKeyUrl = 'https://aistudio.google.com/app/apikey';
  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsExtendedThinking: false,
    supportsPromptCaching: false,
    supportsFunctionCalling: true,
    maxContextTokens: 1_000_000,
    defaultModel: 'gemini-2.5-flash',
    availableModels: [
      'gemini-3.1-pro-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
  };
    validateKey(apiKey: string): { valid: boolean; reason?: string } {
    if (!apiKey || apiKey.length < 20) {
      return { valid: false, reason: 'Gemini API key appears invalid.' };
    }
    return { valid: true };
  }
    async generateResponse(apiKey: string, options: AIRequestOptions): Promise<AIResponse> {
    const t0 = Date.now();
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const requestModel = options.model ?? this.capabilities.defaultModel;
      const model = genAI.getGenerativeModel({
        model: requestModel,
        systemInstruction: options.systemPrompt,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          maxOutputTokens: options.maxTokens ?? 2048,
          temperature: options.temperature ?? 0.3,
        },
      });
      const history = options.messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const lastMessage = options.messages[options.messages.length - 1];
      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage?.content ?? '');
      const response = result.response;
      return {
        content: response.text(),
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
        fromCache: false,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: unknown) {
      throw this._normalizeError(err);
    }
  }
  /** Send a streaming request and call onChunk for each text delta from Gemini. */
  async streamResponse(apiKey: string, options: AIRequestOptions, onChunk: AIStreamCallback): Promise<AIResponse> {
    const t0 = Date.now();
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const requestModel = options.model ?? this.capabilities.defaultModel;
      const model = genAI.getGenerativeModel({
        model: requestModel,
        systemInstruction: options.systemPrompt,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: { maxOutputTokens: options.maxTokens ?? 2048, temperature: options.temperature ?? 0.3 },
      });
      const history = options.messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const lastMessage = options.messages[options.messages.length - 1];
      const chat = model.startChat({ history });
      const streamResult = await chat.sendMessageStream(lastMessage?.content ?? '');
      let fullContent = '';
      for await (const chunk of streamResult.stream) {
        const delta = chunk.text();
        if (delta) {
          fullContent += delta;
          onChunk({ delta, done: false });
        }
      }
      onChunk({ delta: '', done: true });
      const finalResponse = await streamResult.response;
      return {
        content: fullContent,
        usage: {
          inputTokens: finalResponse.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: finalResponse.usageMetadata?.candidatesTokenCount ?? 0,
        },
        fromCache: false,
        providerId: this.id,
        latencyMs: Date.now() - t0,
      };
    } catch (err: unknown) {
      throw this._normalizeError(err);
    }
  }
  private _normalizeError(err: unknown): AIProviderError {
    const msg = (err as { message?: string }).message ?? 'Unknown error';
    if (msg.includes('API_KEY') || msg.includes('401')) return new AIProviderError('Invalid Gemini API key.', 'AUTH_ERROR', this.id, false, 401);
    if (msg.includes('429') || msg.includes('quota')) return new AIProviderError('Gemini quota exceeded.', 'RATE_LIMIT', this.id, true, 429);
    return new AIProviderError(msg, 'PROVIDER_ERROR', this.id, false);
  }
}
