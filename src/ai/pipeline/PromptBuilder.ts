import { DecisionNode } from '../../graph/types';

export interface PromptBuildOptions {
  decisions: DecisionNode[];
  maxDecisions?: number;
  activeFilePath?: string;
  codeContext?: string;
}

const ROLE_DEFINITION = `You are CodeMemory, an AI assistant with deep knowledge of this specific codebase's architectural decisions, patterns, and constraints.

Your purpose:
- Answer questions about WHY the code is structured the way it is
- Identify when new code would violate an existing architectural decision
- Suggest patterns consistent with the codebase's established conventions
- Explain trade-offs that led to past decisions

Behavioral rules:
1. Ground EVERY answer in the decisions provided. Never hallucinate architecture.
2. If a decision directly answers the question, cite it explicitly.
3. If no decision covers the topic, say so clearly — don't invent constraints.
4. Be concise and direct. Developers value precision over prose.
5. When identifying a violation, name the specific decision being violated.`;

export class PromptBuilder {
  static build(options: PromptBuildOptions): string {
    const { decisions, maxDecisions = 20, activeFilePath, codeContext } = options;
    const sliced = decisions.slice(0, maxDecisions);

    const sections: string[] = [ROLE_DEFINITION];

    if (sliced.length > 0) {
      sections.push(PromptBuilder._buildDecisionGraph(sliced));
    } else {
      sections.push('## Decision Graph\n\n_No architectural decisions have been captured yet._');
    }

    if (activeFilePath) {
      sections.push(`## Active File\n\n\`${activeFilePath}\``);
    }

    if (codeContext) {
      sections.push(`## Selected Code\n\n\`\`\`\n${codeContext.slice(0, 2000)}\n\`\`\``);
    }

    return sections.join('\n\n---\n\n');
  }

  private static _buildDecisionGraph(decisions: DecisionNode[]): string {
    const lines = ['## Decision Graph', '', `Total decisions: ${decisions.length}`, ''];

    for (const node of decisions) {
      const p = node.payload;
      lines.push(`### [${p.type.toUpperCase()}] ${p.title}`);
      lines.push(`- **Status:** ${p.status}`);
      lines.push(`- **Rationale:** ${p.rationale}`);
      if (p.filePaths.length > 0) {
        lines.push(`- **Applies to:** ${p.filePaths.join(', ')}`);
      }
      if (p.tags.length > 0) {
        lines.push(`- **Tags:** ${p.tags.join(', ')}`);
      }
      if (p.codeContext) {
        lines.push(`- **Code context:** \`${p.codeContext.slice(0, 200)}\``);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
