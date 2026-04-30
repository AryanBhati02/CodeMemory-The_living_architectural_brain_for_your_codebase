import * as vscode from 'vscode';
import type { DecisionNode } from '../graph/types';
const TYPE_ICONS: Record<string, string> = {
  pattern:    'circuit-board',
  constraint: 'shield',
  convention: 'book',
  why:        'question',
};
const STATUS_DESCRIPTIONS: Record<string, string> = {
  proposed:   '⬡ proposed',
  accepted:   '✔ accepted',
  deprecated: '⚠ deprecated',
  superseded: '↑ superseded',
};
export class DecisionTreeItem extends vscode.TreeItem {
  constructor(public readonly node: DecisionNode) {
    super(node.payload.title, vscode.TreeItemCollapsibleState.None);
    this.description  = STATUS_DESCRIPTIONS[node.payload.status] ?? node.payload.status;
    this.tooltip      = new vscode.MarkdownString(
      `**${node.payload.title}**\n\n${node.payload.rationale}`
    );
    this.iconPath     = new vscode.ThemeIcon(TYPE_ICONS[node.payload.type] ?? 'circle-outline');
    this.contextValue = 'codememory.decision';
    this.command      = {
      command:   'codememory.navigateToDecision',
      title:     'Open Decision',
      arguments: [node],
    };
  }
}
