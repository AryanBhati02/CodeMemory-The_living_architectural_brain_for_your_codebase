
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import type { DecisionService } from '../decisions/decisionService';
import type { AIPipeline } from '../ai/pipeline/AIPipeline';
import type { DecisionTreeProvider } from '../sidebar/DecisionTreeProvider';
import type { DecisionType } from '../graph/types';

interface GitCommit { hash: string; subject: string; body: string }
interface ExtractedDecision { title: string; rationale: string; type: DecisionType }
interface CandidatePickItem extends vscode.QuickPickItem { decision: ExtractedDecision }

const ARCH_KEYWORDS = [
  'because', 'instead of', 'avoid', 'decided', 'refactor',
  'we chose', 'switched to', 'moved to', 'replaced', 'why',
];

const MAX_CANDIDATES = 20;
const CONCURRENCY = 3;

const EXTRACTION_PROMPT = (subject: string, body: string) =>
  `Extract an architectural decision from this git commit if one exists.\n` +
  `Return ONLY valid JSON, no markdown, no explanation:\n` +
  `{ "title": string (max 80 chars), "rationale": string, "type": "pattern"|"constraint"|"convention"|"why" }\n` +
  `Or return: { "skip": true } if no architectural decision is present.\n\n` +
  `Commit: ${subject}\n${body}`;

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function parseGitLog(cwd: string): GitCommit[] {
  let raw: string;
  try {
    raw = execSync(
      'git log --oneline -200 --pretty=format:"%H|||%s|||%b~~~END~~~"',
      { encoding: 'utf-8', cwd, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 },
    );
  } catch {
    return [];
  }

  return raw
    .split('~~~END~~~')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const [hash = '', subject = '', ...bodyParts] = entry.split('|||');
      return {
        hash: hash.replace(/^"/, '').trim(),
        subject: subject.trim(),
        body: bodyParts.join('|||').trim(),
      };
    })
    .filter(c => c.hash && c.subject);
}

function isArchitecturalCommit(commit: GitCommit): boolean {
  const text = `${commit.subject} ${commit.body}`.toLowerCase();
  return ARCH_KEYWORDS.some(kw => text.includes(kw));
}

async function extractDecision(
  pipeline: AIPipeline,
  commit: GitCommit,
): Promise<ExtractedDecision | null> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 15_000),
    );
    const request = pipeline.query({
      query: EXTRACTION_PROMPT(commit.subject, commit.body),
      decisions: [],
    });
    const result = await Promise.race([request, timeout]);

    let text = result.response.content.trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const parsed = JSON.parse(text);
    if (parsed.skip) return null;

    const validTypes = ['pattern', 'constraint', 'convention', 'why'];
    if (!parsed.title || !parsed.rationale || !validTypes.includes(parsed.type)) return null;

    return {
      title: String(parsed.title).slice(0, 80),
      rationale: String(parsed.rationale),
      type: parsed.type as DecisionType,
    };
  } catch {
    return null;
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function discoverFromGitCommand(
  decisionService: DecisionService,
  treeProvider: DecisionTreeProvider,
  pipeline: AIPipeline,
): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage('CodeMemory: No workspace folder open.');
    return;
  }

  const allCommits = parseGitLog(root);
  if (!allCommits.length) {
    vscode.window.showWarningMessage('CodeMemory: Could not read git log. Is this a git repository?');
    return;
  }

  const filtered = allCommits.filter(isArchitecturalCommit).slice(0, MAX_CANDIDATES);
  if (!filtered.length) {
    vscode.window.showInformationMessage(
      `CodeMemory: Scanned ${allCommits.length} commits — none contained architectural keywords.`,
    );
    return;
  }

  const candidates: ExtractedDecision[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CodeMemory: Discovering decisions from git history',
      cancellable: true,
    },
    async (progress, token) => {
      const cancelled = { value: false };
      token.onCancellationRequested(() => { cancelled.value = true; });

      let completed = 0;
      const total = filtered.length;

      await runWithConcurrency(filtered, CONCURRENCY, async (commit, _i) => {
        if (cancelled.value) return;
        progress.report({
          message: `Analysing commit ${completed + 1} of ${total}…`,
          increment: 100 / total,
        });

        const decision = await extractDecision(pipeline, commit);
        if (decision) candidates.push(decision);
        completed++;
      });
    },
  );

  if (!candidates.length) {
    vscode.window.showInformationMessage(
      `CodeMemory: Analysed ${filtered.length} commits — no architectural decisions extracted.`,
    );
    return;
  }

  const picks: CandidatePickItem[] = candidates.map(d => ({
    label: `$(${d.type === 'constraint' ? 'shield' : d.type === 'pattern' ? 'circuit-board' : d.type === 'convention' ? 'book' : 'question'}) ${d.title}`,
    description: d.type,
    detail: d.rationale.slice(0, 100),
    picked: true,
    decision: d,
  }));

  const selected = await vscode.window.showQuickPick(picks, {
    title: `CodeMemory: Discovered ${candidates.length} decisions from git history (select to import)`,
    canPickMany: true,
    placeHolder: `Deselect any you don\u2019t want to import`,
  });

  if (!selected?.length) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CodeMemory: Importing decisions…' },
    async () => {
      for (const item of selected) {
        await decisionService.createDecision({
          title: item.decision.title,
          rationale: item.decision.rationale,
          type: item.decision.type,
          tags: ['git-imported'],
        });
      }
    },
  );

  treeProvider.refresh();
  vscode.window.showInformationMessage(
    `✓ Imported ${selected.length} decision${selected.length > 1 ? 's' : ''} from git history.`,
  );
}
