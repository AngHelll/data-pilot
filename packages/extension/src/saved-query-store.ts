import type { SavedQuery } from "@data-pilot/contracts";
import type * as vscode from "vscode";

const STORAGE_KEY = "dataPilot.savedQueries.v1";
const MAX_SAVED = 50;

/** VS Code–side persistence for SavedQuery DTOs (validated in core via IPC). */
export class SavedQueryStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  list(): SavedQuery[] {
    return this.context.workspaceState.get<SavedQuery[]>(STORAGE_KEY, []);
  }

  append(query: SavedQuery): SavedQuery[] {
    const next = [query, ...this.list()].slice(0, MAX_SAVED);
    void this.context.workspaceState.update(STORAGE_KEY, next);
    return next;
  }
}
