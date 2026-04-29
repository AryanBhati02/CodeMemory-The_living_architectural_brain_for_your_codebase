
import { IAIProvider, AIProviderError } from './IAIProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';

export class ProviderManager {
  private static instance: ProviderManager | undefined;

  private readonly providers = new Map<string, IAIProvider>();
  private activeProviderId = 'claude';

  static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
      ProviderManager.instance._registerDefaults();
    }
    return ProviderManager.instance;
  }

  static resetInstance(): void {
    ProviderManager.instance = undefined;
  }

  register(provider: IAIProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(providerId: string): void {
    if (providerId === this.activeProviderId) {
      throw new Error(`[ProviderManager] Cannot unregister active provider "${providerId}". Switch first.`);
    }
    this.providers.delete(providerId);
  }

  setActiveProvider(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(
        `[ProviderManager] Provider "${providerId}" not registered. Available: ${[...this.providers.keys()].join(', ')}`
      );
    }
    this.activeProviderId = providerId;
  }

  getActiveProviderId(): string {
    return this.activeProviderId;
  }

  getActiveProvider(): IAIProvider {
    const provider = this.providers.get(this.activeProviderId);
    if (!provider) {
      throw new AIProviderError(
        `Active provider "${this.activeProviderId}" not found in registry.`,
        'PROVIDER_ERROR',
        this.activeProviderId,
        false
      );
    }
    return provider;
  }

  getProvider(providerId: string): IAIProvider | undefined {
    return this.providers.get(providerId);
  }

  listProviders(): IAIProvider[] {
    return [...this.providers.values()];
  }

  validateKey(providerId: string, apiKey: string): { valid: boolean; reason?: string } {
    const provider = this.providers.get(providerId);
    if (!provider) return { valid: false, reason: `Unknown provider "${providerId}".` };
    return provider.validateKey(apiKey);
  }

  private _registerDefaults(): void {
    this.register(new ClaudeProvider());
    this.register(new OpenAIProvider());
    this.register(new GeminiProvider());
  }
}
