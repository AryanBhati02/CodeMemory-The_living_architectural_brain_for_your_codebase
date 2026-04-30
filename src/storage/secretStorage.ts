
import * as vscode from 'vscode';

const KEY_PREFIX = 'codememory.apiKey';
const ACTIVE_PROVIDER_KEY = 'codememory.activeProvider';

export class SecretStorageService implements vscode.Disposable {
  private readonly secrets: vscode.SecretStorage;
  private readonly globalState: vscode.Memento;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
    this.globalState = context.globalState;
  }

    async storeKey(providerId: string, apiKey: string): Promise<void> {
    if (!apiKey?.trim()) {
      throw new Error(`Cannot store empty API key for provider: ${providerId}`);
    }
    await this.secrets.store(`${KEY_PREFIX}.${providerId}`, apiKey.trim());
  }

    async getKey(providerId: string): Promise<string | undefined> {
    return this.secrets.get(`${KEY_PREFIX}.${providerId}`);
  }

    async hasKey(providerId: string): Promise<boolean> {
    const key = await this.secrets.get(`${KEY_PREFIX}.${providerId}`);
    return key !== undefined && key.length > 0;
  }

    async deleteKey(providerId: string): Promise<void> {
    await this.secrets.delete(`${KEY_PREFIX}.${providerId}`);
  }

    async storeTursoToken(token: string): Promise<void> {
    await this.secrets.store('codememory.tursoToken', token.trim());
  }

    async getTursoToken(): Promise<string | undefined> {
    return this.secrets.get('codememory.tursoToken');
  }

    async setActiveProvider(providerId: string): Promise<void> {
    await this.globalState.update(ACTIVE_PROVIDER_KEY, providerId);
  }

    getActiveProvider(): string | undefined {
    return this.globalState.get<string>(ACTIVE_PROVIDER_KEY);
  }

    async setSelectedModel(providerId: string, model: string): Promise<void> {
    await this.globalState.update(`codememory.model.${providerId}`, model);
  }

    getSelectedModel(providerId: string): string | undefined {
    return this.globalState.get<string>(`codememory.model.${providerId}`);
  }

    onDidChange(listener: (e: vscode.SecretStorageChangeEvent) => void): vscode.Disposable {
    return this.secrets.onDidChange(listener);
  }

    static maskKey(apiKey: string): string {
    if (apiKey.length <= 8) return '•'.repeat(apiKey.length);
    const visible = apiKey.slice(-4);
    const masked = '•'.repeat(Math.min(apiKey.length - 4, 24));
    return `${masked}${visible}`;
  }

    dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
