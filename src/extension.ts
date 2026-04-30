import * as vscode from 'vscode';
import { logger }                 from './utils/logger';
import { SecretStorageService }   from './storage/secretStorage';
import { SettingsManager }        from './settings/SettingsManager';
import { ProviderManager }        from './ai/providers/ProviderManager';
import { AIPipeline }             from './ai/pipeline/AIPipeline';
import { DatabaseManager }        from './db/factory';
import { EmbeddingQueue }         from './workers/embeddingQueue';
import { DecisionService }        from './decisions/decisionService';
import { EventBus }               from './events/eventBus';
import { DecisionTreeProvider }   from './sidebar/DecisionTreeProvider';
import { DecorationEngine }       from './decorations/DecorationEngine';
import { ProviderDrawer }         from './ui/ProviderDrawer';
import { TokenDashboardPanel }    from './ui/TokenDashboardPanel';
import { registerAllCommands }    from './commands/registry';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info('Extension', 'Activating — all phases unified');

  const secrets = new SecretStorageService(context);

  const config = SettingsManager.get();

  const providerManager = ProviderManager.getInstance();
  const savedProvider = secrets.getActiveProvider() ?? config.activeProviderId;
  try { providerManager.setActiveProvider(savedProvider); } catch { /* use default */ }

  const eventBus = new EventBus();

  const dbManager = new DatabaseManager(context);
  const db = dbManager.getDatabase();

  const embeddingQueue = new EmbeddingQueue(db, context.extensionPath);
  embeddingQueue.start().catch((err) => {
    logger.warn('Extension', `Embedding worker failed to start: ${String(err)}`);
  });

  const decisionService = new DecisionService(db, embeddingQueue);

  const aiPipeline = new AIPipeline(providerManager, secrets);

  const treeProvider = new DecisionTreeProvider(decisionService);
  const treeView = vscode.window.createTreeView('codememory.decisionsTree', {
    treeDataProvider: treeProvider,
    showCollapseAll:  true,
  });

  const decorationEngine = new DecorationEngine(context.extensionUri);
  decorationEngine.updateDecisions(decisionService.getDecisions());

  const providerDrawer = new ProviderDrawer(providerManager, secrets, context.extensionUri);

  let tokenPanel: TokenDashboardPanel | undefined;
  registerAllCommands({
    context,
    decisionService,
    pipeline:       aiPipeline,
    treeProvider,
    providerDrawer,
    getTokenPanel:  () => tokenPanel,
    showTokenPanel: () => {
      tokenPanel = TokenDashboardPanel.createOrShow(context.extensionUri, aiPipeline);
    },
  });

  const statusBar = createStatusBar();
  updateStatusBar(statusBar, providerManager);
  context.subscriptions.push(statusBar);

  decisionService.onGraphChange((e) => {
    eventBus.fireGraphChange(e);
    aiPipeline.invalidateCache(`graph-${e.kind}:${e.nodeId}`);
    treeProvider.refresh();
    decorationEngine.updateDecisions(decisionService.getDecisions());
  });

  embeddingQueue.onEmbeddingComplete(() => treeProvider.refresh());

  providerDrawer.onProviderChanged((newId) => {
    eventBus.fireProviderChange({ previousProviderId: providerManager.getActiveProviderId(), newProviderId: newId });
    aiPipeline.invalidateCache('provider-switch');
    updateStatusBar(statusBar, providerManager);
  });

  context.subscriptions.push(
    SettingsManager.onDidChange(() => {
      const cfg = SettingsManager.get();
      try { providerManager.setActiveProvider(cfg.activeProviderId); } catch {}
      updateStatusBar(statusBar, providerManager);
    })
  );

  context.subscriptions.push(
    secrets, dbManager, embeddingQueue, decisionService,
    eventBus, treeView, decorationEngine, providerDrawer,
  );

  logger.info('Extension', 'Activation complete');
}

function createStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem('codememory.status', vscode.StatusBarAlignment.Right, 100);
  item.command = 'codememory.selectProvider';
  item.tooltip  = 'CodeMemory — Click to configure AI provider';
  item.show();
  return item;
}

function updateStatusBar(item: vscode.StatusBarItem, pm: ProviderManager): void {
  const provider = pm.getActiveProvider();
  item.text    = `$(sparkle) ${provider.name}`;
  item.tooltip = `CodeMemory: ${provider.name} active — click to change`;
}

export function deactivate(): void {
  ProviderManager.resetInstance();
}
