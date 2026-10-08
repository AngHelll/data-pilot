import * as path from "node:path";

/** One dataset the host is keeping open. No vscode. */
export interface OpenDatasetSession {
  filePath: string;
  datasetId: string;
}

/** Path → datasetId for datasets kept open in this window. No vscode. */
export class DatasetSessionRegistry {
  private readonly byPath = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  lookup(filePath: string): string | undefined {
    return this.byPath.get(path.resolve(filePath));
  }

  remember(filePath: string, datasetId: string): void {
    this.byPath.set(path.resolve(filePath), datasetId);
    this.emit();
  }

  /** Open sessions for the Activity Bar tree. A second path does not drop the first. */
  entries(): OpenDatasetSession[] {
    return [...this.byPath.entries()].map(([filePath, datasetId]) => ({
      filePath,
      datasetId,
    }));
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Every open id. `stop` closes these; opening another path does not drop one. */
  idsToClose(): string[] {
    return [...new Set(this.byPath.values())];
  }

  clear(): void {
    this.byPath.clear();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
