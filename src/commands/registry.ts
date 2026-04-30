






import * as vscode from 'vscode';
import {
  captureDecisionCommand,
  searchDecisionsCommand,
  askAICommand,
  navigateToDecisionCommand,
  editDecisionCommand,
  deleteDecisionCommand,
  linkDecisionCommand,
  exportDecisionsCommand,
  importDecisionsCommand,
} from './index';
import type { DecisionService }    from '../decisions/decisionService';
import type { AIPipeline }         from '../ai/pipeline/AIPipeline';
import type { DecisionTreeProvider } from '../sidebar/DecisionTreeProvider';
import type { ProviderDrawer }     from '../ui/ProviderDrawer';
import type { TokenDashboardPanel } from '../ui/TokenDashboardPanel';
import type { GraphPanel }          from '../ui/GraphPanel';

export interface CommandDeps {
  context:         vscode.ExtensionContext;
  decisionService: DecisionService;
  pipeline:        AIPipeline;
  treeProvider:    DecisionTreeProvider;
  providerDrawer:  ProviderDrawer;
  getTokenPanel:   () => TokenDashboardPanel | undefined;
  showTokenPanel:  () => void;
  showGraphPanel:      () => void;
  showDecisionDetail:  (nodeId: string) => void;
}


export function registerAllCommands(deps: CommandDeps): void {
  const { context, decisionService, pipeline, treeProvider, providerDrawer } = deps;

  const cmds: Array<[string, (...args: any[]) => any]> = [
    [
      'codememory.captureDecision',
      () => captureDecisionCommand(decisionService, treeProvider, pipeline),
    ],
    [
      'codememory.searchDecisions',
      () => searchDecisionsCommand(decisionService),
    ],
    [
      'codememory.askAI',
      () => askAICommand(pipeline, decisionService),
    ],
    [
      'codememory.selectProvider',
      () => providerDrawer.show(),
    ],
    [
      'codememory.quickSwitchProvider',
      async () => {
        const pm = (await import('../ai/providers/ProviderManager')).ProviderManager.getInstance();
        const items = pm.listProviders().map((p) => ({
          label:       `$(sparkle) ${p.name}`,
          description: p.id === pm.getActiveProviderId() ? '(active)' : '',
          id:          p.id,
        }));
        const picked = await vscode.window.showQuickPick(items, { title: 'Switch AI Provider' });
        if (!picked) return;
        pm.setActiveProvider(picked.id);
        const { SettingsManager } = await import('../settings/SettingsManager');
        await SettingsManager.setActiveProvider(picked.id);
        pipeline.invalidateCache('provider-switch');
        vscode.window.showInformationMessage(`CodeMemory: Switched to ${picked.label}`);
      },
    ],
    [
      'codememory.openTokenDashboard',
      () => deps.showTokenPanel(),
    ],
    [
      'codememory.openGraph',
      () => deps.showGraphPanel(),
    ],
    [
      'codememory.refreshSidebar',
      () => treeProvider.refresh(),
    ],
    [
      'codememory.navigateToDecision',
      (node: any) => {
        if (node?.id) {
          deps.showDecisionDetail(node.id);
        } else {
          navigateToDecisionCommand(node);
        }
      },
    ],
    [
      'codememory.editDecision',
      (node: any) => editDecisionCommand(decisionService, node),
    ],
    [
      'codememory.deleteDecision',
      (node: any) => deleteDecisionCommand(decisionService, node),
    ],
    [
      'codememory.linkDecision',
      (node: any) => linkDecisionCommand(decisionService, node),
    ],
    [
      'codememory.exportDecisions',
      () => exportDecisionsCommand(decisionService),
    ],
    [
      'codememory.importDecisions',
      () => importDecisionsCommand(decisionService),
    ],
  ];

  for (const [id, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
}
