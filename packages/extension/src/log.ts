import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function dataPilotLog(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Data Pilot");
  }
  return channel;
}

export function logInfo(message: string): void {
  dataPilotLog().appendLine(`[info] ${message}`);
}

export function logError(message: string, detail?: string): void {
  const line = detail ? `${message}\n${detail}` : message;
  dataPilotLog().appendLine(`[error] ${line}`);
}
