
import * as vscode from 'vscode';
import { DecisionTreeItem } from './DecisionTreeItem';
import type { DecisionNode, DecisionType } from '../graph/types';
import type { DecisionService } from '../decisions/decisionService';

const GROUP_LABELS: Record<DecisionType, string> = {
  pattern:    '$(circuit-board) Patterns',
  constraint: '$(shield) Constraints',
  convention: '$(book) Conventions',
  why:        '$(question) Why Decisions',
};

class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly decisionType: DecisionType,
    public readonly children: DecisionTreeItem[]
  ) {
    super(GROUP_LABELS[decisionType], vscode.TreeItemCollapsibleState.Expanded);
    this.description  = `${children.length}`;
    this.contextValue = 'codememory.group';
  }
}

type TreeNode = GroupTreeItem | DecisionTreeItem;

export class DecisionTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private filterQuery = '';

  constructor(private readonly decisionService: DecisionService) {}

  /** Fire a tree-data-changed event to refresh the entire sidebar view. */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Apply a keyword filter to the tree; clears the filter when query is empty. */
  setFilter(query: string): void {
    this.filterQuery = query.toLowerCase();
    this.refresh();
  }

  /** Return the VS Code TreeItem for a given tree node (required by TreeDataProvider). */
  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  /** Return group nodes at root level, or decision items when expanding a group. */
  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof GroupTreeItem) {
      return element.children;
    }

    // Root: get all decisions, group them
    let decisions = this.decisionService.getDecisions();

    if (this.filterQuery) {
      decisions = decisions.filter(
        (d) =>
          d.payload.title.toLowerCase().includes(this.filterQuery) ||
          d.payload.rationale.toLowerCase().includes(this.filterQuery) ||
          d.payload.tags.some((t) => t.toLowerCase().includes(this.filterQuery))
      );
    }

    if (!decisions.length) return [];

    const grouped = new Map<DecisionType, DecisionNode[]>();
    for (const type of ['pattern', 'constraint', 'convention', 'why'] as DecisionType[]) {
      grouped.set(type, []);
    }
    for (const d of decisions) {
      grouped.get(d.payload.type)?.push(d);
    }

    const result: GroupTreeItem[] = [];
    for (const [type, nodes] of grouped) {
      if (nodes.length > 0) {
        result.push(new GroupTreeItem(type, nodes.map((n) => new DecisionTreeItem(n))));
      }
    }
    return result;
  }
}
