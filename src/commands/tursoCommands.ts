
import * as vscode from 'vscode';
import { TursoSync } from '../db/TursoSync';
import type { SecretStorageService } from '../storage/secretStorage';
import type { DecisionTreeProvider } from '../sidebar/DecisionTreeProvider';

export async function configureSyncCommand(
  tursoSync: TursoSync | null,
  secrets: SecretStorageService,
  treeProvider: DecisionTreeProvider,
  onConnected: (sync: TursoSync) => void,
): Promise<void> {
  const url = await vscode.window.showInputBox({
    title: 'CodeMemory: Configure Team Sync (1/2)',
    prompt: 'Turso database URL (e.g. libsql://your-db-name-org.turso.io)',
    placeHolder: 'libsql://...',
    value: vscode.workspace.getConfiguration('codememory').get<string>('tursoUrl', ''),
  });
  if (!url?.trim()) return;

  const token = await vscode.window.showInputBox({
    title: 'CodeMemory: Configure Team Sync (2/2)',
    prompt: 'Turso auth token',
    placeHolder: 'Paste your Turso auth token',
    password: true,
  });
  if (!token?.trim()) return;

  await vscode.workspace
    .getConfiguration('codememory')
    .update('tursoUrl', url.trim(), vscode.ConfigurationTarget.Global);
  await secrets.storeTursoToken(token.trim());

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CodeMemory: Setting up team sync',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Connecting to Turso…' });

      if (tursoSync?.isConnected) {
        tursoSync.dispose();
      }

      const sync = tursoSync!;
      try {
        await sync.connect();
      } catch (err) {
        vscode.window.showErrorMessage(
          `CodeMemory: Failed to connect to Turso — ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }

      progress.report({ message: 'Pushing local decisions to remote…', increment: 40 });
      const pushed = await sync.pushAll();

      progress.report({ message: 'Enabling periodic sync…', increment: 40 });
      await vscode.workspace
        .getConfiguration('codememory')
        .update('syncEnabled', true, vscode.ConfigurationTarget.Global);
      sync.startPeriodicSync();
      onConnected(sync);

      progress.report({ increment: 20 });
      vscode.window.showInformationMessage(
        `✓ Team sync configured — pushed ${pushed} items to Turso. Syncing every 30s.`
      );
    },
  );

  treeProvider.refresh();
}

export async function syncNowCommand(
  tursoSync: TursoSync | null,
  treeProvider: DecisionTreeProvider,
): Promise<void> {
  if (!tursoSync?.isConnected) {
    vscode.window.showWarningMessage(
      'CodeMemory: Team sync is not configured. Run "Configure Team Sync" first.'
    );
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CodeMemory: Syncing decisions…' },
    async () => {
      try {
        const result = await tursoSync.sync();
        treeProvider.refresh();
        vscode.window.showInformationMessage(
          `✓ Sync complete — pushed ${result.pushed}, pulled ${result.pulled} changes.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `CodeMemory: Sync failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
  );
}
