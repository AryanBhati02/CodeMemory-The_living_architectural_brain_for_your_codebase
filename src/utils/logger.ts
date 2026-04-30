import * as vscode from 'vscode';
const channel = vscode.window.createOutputChannel('CodeMemory');
function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}
export const logger = {
  info:  (module: string, msg: string) => channel.appendLine(`[${timestamp()}] INFO  [${module}] ${msg}`),
  warn:  (module: string, msg: string) => channel.appendLine(`[${timestamp()}] WARN  [${module}] ${msg}`),
  error: (module: string, msg: string, err?: unknown) => {
    channel.appendLine(`[${timestamp()}] ERROR [${module}] ${msg}${err ? ': ' + String(err) : ''}`);
  },
  debug: (module: string, msg: string) => channel.appendLine(`[${timestamp()}] DEBUG [${module}] ${msg}`),
  dispose: () => channel.dispose(),
};
