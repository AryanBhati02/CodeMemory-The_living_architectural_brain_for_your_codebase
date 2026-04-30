import * as vscode from 'vscode';
export interface CodeMemoryConfig {
  activeProviderId: string;
  maxDecisionsPerQuery: number;
  cacheTtlSeconds: number;
  stuckDetectorEnabled: boolean;
  driftDetectorEnabled: boolean;
}
export class SettingsManager {
  private static readonly SECTION = 'codememory';
  static get(): CodeMemoryConfig {
    const cfg = vscode.workspace.getConfiguration(SettingsManager.SECTION);
    return {
      activeProviderId:     cfg.get<string>('activeProviderId',    'claude'),
      maxDecisionsPerQuery: cfg.get<number>('maxDecisionsPerQuery', 10),
      cacheTtlSeconds:      cfg.get<number>('cacheTtlSeconds',      300),
      stuckDetectorEnabled: cfg.get<boolean>('stuckDetectorEnabled', true),
      driftDetectorEnabled: cfg.get<boolean>('driftDetectorEnabled', true),
    };
  }
  static onDidChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SettingsManager.SECTION)) {
        listener();
      }
    });
  }
  static async setActiveProvider(providerId: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(SettingsManager.SECTION)
      .update('activeProviderId', providerId, vscode.ConfigurationTarget.Global);
  }
}
