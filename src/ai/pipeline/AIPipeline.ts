
import { ProviderManager } from '../providers/ProviderManager';
import { CacheEngine, computeGraphHash } from '../cache/CacheEngine';
import { PromptBuilder } from './PromptBuilder';
import { SecretStorageService } from '../../storage/secretStorage';
import { SettingsManager } from '../../settings/SettingsManager';
import { DecisionNode } from '../../graph/types';
import { AIResponse, AIStreamCallback, AIProviderError, AIMessage } from '../providers/IAIProvider';



export interface QueryOptions {
  query: string;
  decisions: DecisionNode[];
  activeFilePath?: string;
  codeContext?: string;
  history?: AIMessage[];
  stream?: boolean;
  onChunk?: AIStreamCallback;
  signal?: AbortSignal;
}

export interface PipelineResult {
  response: AIResponse;
  cacheHit: boolean;
  providerId: string;
  graphDecisionsInjected: number;
}

export interface SessionStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalRequests: number;
  estimatedCostUsd: number;
  estimatedSavingsUsd: number;
  cacheStats: ReturnType<CacheEngine['getStats']>;
  activeProviderId: string;
}


const COST_PER_M: Record<string, { input: number; output: number; cacheRead: number }> = {
  claude:  { input: 3.00,  output: 15.00, cacheRead: 0.30  },
  openai:  { input: 2.50,  output: 10.00, cacheRead: 2.50  },
  gemini:  { input: 3.50,  output: 10.50, cacheRead: 3.50  },
};



export class AIPipeline {
  private readonly cache: CacheEngine;
  private readonly providerManager: ProviderManager;
  private readonly secrets: SecretStorageService;

  
  private stats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalRequests: 0,
    estimatedCostUsd: 0,
    estimatedSavingsUsd: 0,
  };

  constructor(providerManager: ProviderManager, secrets: SecretStorageService) {
    this.providerManager = providerManager;
    this.secrets = secrets;
    const config = SettingsManager.get();
    this.cache = new CacheEngine(config.cacheTtlSeconds);
  }

  

    async query(options: QueryOptions): Promise<PipelineResult> {
    const { query, decisions, activeFilePath, codeContext, history = [], stream, onChunk, signal } = options;
    const config = SettingsManager.get();

    
    const providerId = this.providerManager.getActiveProviderId();
    const graphHash = computeGraphHash(decisions);
    let systemPrompt = this.cache.get(graphHash, providerId);
    let cacheHit = systemPrompt !== null;

    if (!systemPrompt) {
      systemPrompt = PromptBuilder.build({
        decisions,
        maxDecisions: config.maxDecisionsPerQuery,
        activeFilePath,
        codeContext,
      });
      this.cache.set(graphHash, providerId, systemPrompt);
    }

    
    const apiKey = await this.secrets.getKey(providerId);
    if (!apiKey) {
      throw new Error(
        `No API key configured for "${providerId}". Use the Select AI Provider command to add one.`
      );
    }

    
    const provider = this.providerManager.getActiveProvider();
    const selectedModel = this.secrets.getSelectedModel(providerId) ?? provider.capabilities.defaultModel;

    
    const messages: AIMessage[] = [
      ...history,
      { role: 'user', content: query },
    ];

    const requestOptions = {
      systemPrompt,
      messages,
      maxTokens: 2048,
      temperature: 0.3,
      stream,
      signal,
      model: selectedModel,
    };

    
    let response: AIResponse;
    if (stream && onChunk) {
      response = await this._dispatchWithRetry(() =>
        provider.streamResponse(apiKey, requestOptions, onChunk)
      );
    } else {
      response = await this._dispatchWithRetry(() =>
        provider.generateResponse(apiKey, requestOptions)
      );
    }

    
    this._accumulateStats(response);

    return {
      response,
      cacheHit,
      providerId,
      graphDecisionsInjected: Math.min(decisions.length, config.maxDecisionsPerQuery),
    };
  }

  

    invalidateCache(reason: string): void {
    this.cache.invalidate(reason);
  }

  

    getSessionStats(): SessionStats {
    return {
      ...this.stats,
      cacheStats: this.cache.getStats(),
      activeProviderId: this.providerManager.getActiveProviderId(),
    };
  }

    resetStats(): void {
    this.stats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalRequests: 0,
      estimatedCostUsd: 0,
      estimatedSavingsUsd: 0,
    };
  }

  

  private async _dispatchWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof AIProviderError && err.retryable && attempt < maxRetries) {
          lastError = err;
          await this._sleep(1000 * Math.pow(2, attempt)); 
          continue;
        }
        throw err;
      }
    }
    throw lastError!;
  }

  private _accumulateStats(response: AIResponse): void {
    const pid = response.providerId;
    const costs = COST_PER_M[pid] ?? COST_PER_M['claude'];

    const inputTokens     = response.usage.inputTokens;
    const outputTokens    = response.usage.outputTokens;
    const cacheRead       = response.usage.cacheReadTokens ?? 0;
    const cacheWrite      = response.usage.cacheWriteTokens ?? 0;

    const actualCost  = (inputTokens * costs.input + outputTokens * costs.output + cacheRead * costs.cacheRead) / 1_000_000;
    const fullCost    = ((inputTokens + cacheRead) * costs.input + outputTokens * costs.output) / 1_000_000;

    this.stats.totalInputTokens      += inputTokens;
    this.stats.totalOutputTokens     += outputTokens;
    this.stats.totalCacheReadTokens  += cacheRead;
    this.stats.totalCacheWriteTokens += cacheWrite;
    this.stats.totalRequests         += 1;
    this.stats.estimatedCostUsd      += actualCost;
    this.stats.estimatedSavingsUsd   += Math.max(0, fullCost - actualCost);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
