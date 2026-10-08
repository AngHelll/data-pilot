import type { SavedQuery } from "@data-pilot/contracts";
import * as vscode from "vscode";
import { nextSavedQueries } from "./saved-query-tree";

const STORAGE_KEY = "dataPilot.savedQueries.v1";

/** VS Code–side persistence for SavedQuery DTOs (validated in core via IPC). */
export class SavedQueryStore {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChange = this.change.event;
  private queries: SavedQuery[] | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  list(): SavedQuery[] {
    if (!this.queries) {
      this.queries = this.context.workspaceState.get<SavedQuery[]>(STORAGE_KEY, []);
    }
    return this.queries;
  }

  append(query: SavedQuery): SavedQuery[] {
    const next = nextSavedQueries(this.list(), query);
    this.queries = next;
    void this.context.workspaceState.update(STORAGE_KEY, next);
    this.change.fire();
    return next;
  }
}
