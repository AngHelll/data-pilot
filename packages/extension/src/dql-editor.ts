import * as path from "node:path";
import * as vscode from "vscode";
import { analyzeDql } from "@data-pilot/dql";
import type { ColumnMeta, Diagnostic, InferredType, SavedQuery } from "@data-pilot/contracts";
import { assertOpAllowed } from "@data-pilot/core";
import {
  chooseDatasetPath,
  chooseResultPlacement,
  fileName,
  runOnChoices,
  runTargetActionText,
  type DqlColumnRef,
  type DqlDocumentLink,
} from "./dql-link";
import { DqlResultView } from "./dql-result-view";
import type { ExtensionEngineHost } from "./engine-host";
import { workspaceTrustMode } from "./engine-host";
import { formatCells } from "./format-cell";
import {
  activeDatasetEditorSession,
  openEditorForResult,
  openEditorPaths,
  paintOpenEditorResult,
  type DatasetQuerySurface,
} from "./webview/dataset-panel";
import { savedQueryLink } from "./saved-query-tree";
import { SavedQueryStore } from "./saved-query-store";

const LINK_KEY = "dataPilot.dqlLinks.v1";
const LANGUAGE_ID = "data-pilot-dql";

export function registerDqlEditor(
  context: vscode.ExtensionContext,
  engine: ExtensionEngineHost,
  savedQueries: SavedQueryStore,
): void {
  const lenses = new vscode.EventEmitter<void>();
  const targetHub = { sync: () => undefined as void };
  const links = new DqlLinkStore(context, () => targetHub.sync());
  const targetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  targetItem.command = "dataPilot.runDqlOn";
  targetHub.sync = () => {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document.languageId === LANGUAGE_ID ? editor.document : undefined;
    const datasetPath = document ? links.get(document.uri.toString())?.datasetPath : undefined;
    if (!document) {
      targetItem.hide();
    } else {
      targetItem.text = `$(database) ${runTargetActionText(datasetPath)}`;
      targetItem.tooltip = datasetPath
        ? `${datasetPath}\nClick to run this query on another open dataset.`
        : "Click to choose which open dataset this query runs on.";
      targetItem.show();
    }
    if (document) results.noteActive(datasetPath);
    lenses.fire();
  };
  const diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  const results = new DqlResultView(context.extensionUri);
  let runGeneration = 0;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (document: vscode.TextDocument): void => {
    if (document.languageId !== LANGUAGE_ID) return;
    const link = links.get(document.uri.toString());
    diagnostics.set(document.uri, toVsDiagnostics(document, link));
  };

  const schedule = (document: vscode.TextDocument): void => {
    if (document.languageId !== LANGUAGE_ID) return;
    const key = document.uri.toString();
    const previous = timers.get(key);
    if (previous) clearTimeout(previous);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(document);
      }, 300),
    );
  };

  const runActive = async (choose: boolean): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== LANGUAGE_ID) {
      void vscode.window.showInformationMessage("Open a Data Pilot DQL document first.");
      return;
    }
    const blocked = assertOpAllowed({ trustMode: workspaceTrustMode() }, "executeQuery");
    if (blocked) {
      void vscode.window.showErrorMessage(blocked.message);
      return;
    }
    const dql = editor.document.getText().trim();
    if (!dql) {
      void vscode.window.showInformationMessage("Write a query first.");
      return;
    }
    const docKey = editor.document.uri.toString();
    const openPaths = engine.listOpenSessions().map((session) => session.filePath);
    const current = chooseDatasetPath(links.get(docKey), openPaths);
    let datasetPath = choose ? undefined : current;
    if (!datasetPath) {
      const choices = runOnChoices(openPaths, current);
      if (choices.length === 0) {
        void vscode.window.showInformationMessage("Open a dataset first, then run the query.");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        choices.map((choice) => ({
          label: fileName(choice.path),
          description: choice.current ? `${choice.path} · current` : choice.path,
          path: choice.path,
        })),
        { placeHolder: "Which open dataset should this query run on?" },
      );
      if (!picked) return;
      datasetPath = picked.path;
    }
    const generation = ++runGeneration;
    try {
      const opened = await engine.openDataset(datasetPath);
      if (generation !== runGeneration) return;
      links.remember(docKey, {
        datasetPath,
        columns: opened.handle.columns.map(columnRef),
      });
      refresh(editor.document);
      const result = await engine.executeQuery(opened.handle.datasetId, dql);
      if (generation !== runGeneration) return;
      const payload = {
        datasetPath,
        columns: result.columns,
        rows: formatCells(result.rows),
        rowCountReturned: result.rowCountReturned,
        completion: result.completion,
        diagnostics: result.diagnostics.map((item) => item.message),
      };
      const resolved = path.resolve(datasetPath);
      const placement = chooseResultPlacement({
        besidePanelOpen: results.isOpen(),
        datasetPath: resolved,
        openEditorPaths: openEditorPaths(),
      });
      if (placement === "update-open-panel") {
        const status = results.updateOpen(generation, payload);
        if (status !== "closed") return;
      } else {
        results.noteResult(generation, payload);
      }
      if (paintOpenEditorResult(datasetPath, result)) return;
      await openEditorForResult(datasetPath, result);
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      void vscode.window.showErrorMessage(message);
    }
  };

  context.subscriptions.push(
    diagnostics,
    results,
    lenses,
    targetItem,
    vscode.window.onDidChangeActiveTextEditor(() => targetHub.sync()),
    vscode.languages.registerCodeLensProvider(LANGUAGE_ID, {
      onDidChangeCodeLenses: lenses.event,
      provideCodeLenses(document) {
        const datasetPath = links.get(document.uri.toString())?.datasetPath;
        return [
          new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
            title: runTargetActionText(datasetPath),
            command: "dataPilot.runDqlOn",
          }),
        ];
      },
    }),
    vscode.commands.registerCommand("dataPilot.showDqlTarget", (datasetPath?: string) => {
      const editor = vscode.window.activeTextEditor;
      const linked =
        typeof datasetPath === "string"
          ? datasetPath
          : editor?.document.languageId === LANGUAGE_ID
            ? links.get(editor.document.uri.toString())?.datasetPath
            : undefined;
      if (!linked) {
        void vscode.window.showInformationMessage(
          "This query has no dataset. Run will ask which open dataset to use.",
        );
        return;
      }
      void vscode.window.showInformationMessage(`This query runs on ${linked}`);
    }),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.languages.registerCompletionItemProvider(LANGUAGE_ID, {
      provideCompletionItems(document, position) {
        const link = links.get(document.uri.toString());
        if (!link) return [];
        const word = document.getWordRangeAtPosition(position);
        const prefix = (word ? document.getText(word) : "").toLowerCase();
        return link.columns
          .filter((column) => column.name.toLowerCase().startsWith(prefix))
          .map((column) => {
            const item = new vscode.CompletionItem(column.name, vscode.CompletionItemKind.Field);
            item.detail = column.inferredType;
            return item;
          });
      },
    }),
    vscode.commands.registerCommand("dataPilot.openQueryInEditor", async () => {
      const surface = activeDatasetEditorSession();
      if (!surface) {
        void vscode.window.showInformationMessage(
          "Focus the Data Pilot dataset editor first.",
        );
        return;
      }
      await openSurfaceQuery(surface, links);
    }),
    vscode.commands.registerCommand("dataPilot.runDql", () => runActive(false)),
    vscode.commands.registerCommand("dataPilot.runDqlOn", () => runActive(true)),
    vscode.commands.registerCommand("dataPilot.openDqlResultBeside", () => {
      if (!results.openBeside()) {
        void vscode.window.showInformationMessage("Run a query first, then open the result beside.");
      }
    }),
    vscode.commands.registerCommand("dataPilot.openSavedQuery", (query: SavedQuery | undefined) => {
      if (!query || typeof query.dql !== "string") return;
      return openSavedQuery(query, links);
    }),
    vscode.commands.registerCommand(
      "dataPilot.associateSavedQuery",
      async (query: SavedQuery | undefined) => {
        if (!query || typeof query.dql !== "string" || query.datasetPath) return;
        const sessions = engine.listOpenSessions();
        if (sessions.length === 0) {
          void vscode.window.showInformationMessage("Open a dataset first.");
          return;
        }
        const picked = await vscode.window.showQuickPick(
          sessions.map((session) => ({
            label: fileName(session.filePath),
            description: session.filePath,
            path: session.filePath,
          })),
          { placeHolder: "Associate with open dataset" },
        );
        if (!picked) return;
        savedQueries.associate(query, picked.path);
      },
    ),
  );

  for (const document of vscode.workspace.textDocuments) refresh(document);
  targetHub.sync();
}

export async function openSurfaceQuery(
  surface: DatasetQuerySurface,
  links: DqlLinkStore,
): Promise<void> {
  const datasetPath = surface.datasetPath();
  if (!datasetPath) {
    void vscode.window.showInformationMessage("Open a dataset in this view first.");
    return;
  }
  let dql = "";
  try {
    dql = await surface.requestDqlText();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(message);
    return;
  }
  const document = await vscode.workspace.openTextDocument({
    language: LANGUAGE_ID,
    content: dql,
  });
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
  });
  links.remember(editor.document.uri.toString(), {
    datasetPath,
    columns: surface.columnSnapshot(),
  });
}

export async function openSavedQuery(query: SavedQuery, links: DqlLinkStore): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: LANGUAGE_ID,
    content: query.dql,
  });
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
  });
  const link = savedQueryLink(query);
  if (!link) return;
  links.remember(editor.document.uri.toString(), link);
}

export class DqlLinkStore {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onChange?: () => void,
  ) {}

  get(docKey: string): DqlDocumentLink | undefined {
    const link = this.read()[docKey];
    if (!link?.datasetPath) return undefined;
    return link;
  }

  remember(docKey: string, link: DqlDocumentLink): void {
    const next = { ...this.read(), [docKey]: link };
    void this.context.workspaceState.update(LINK_KEY, next);
    this.onChange?.();
  }

  private read(): Record<string, DqlDocumentLink> {
    const raw = this.context.workspaceState.get<unknown>(LINK_KEY, {});
    if (typeof raw !== "object" || raw === null) return {};
    const out: Record<string, DqlDocumentLink> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object") continue;
      const row = value as { datasetPath?: unknown; columns?: unknown };
      if (typeof row.datasetPath !== "string" || !row.datasetPath) continue;
      const columns = Array.isArray(row.columns)
        ? row.columns.flatMap((column) => {
            if (!column || typeof column !== "object") return [];
            const name = (column as { name?: unknown }).name;
            const inferredType = (column as { inferredType?: unknown }).inferredType;
            if (typeof name !== "string" || typeof inferredType !== "string") return [];
            return [{ name, inferredType }];
          })
        : [];
      out[key] = { datasetPath: row.datasetPath, columns };
    }
    return out;
  }
}

function columnRef(column: ColumnMeta): DqlColumnRef {
  return { name: column.name, inferredType: column.inferredType };
}

function toVsDiagnostics(
  document: vscode.TextDocument,
  link: DqlDocumentLink | undefined,
): vscode.Diagnostic[] {
  const source = document.getText();
  if (!source.trim()) return [];
  const columns: ColumnMeta[] = link
    ? link.columns.map((column) => ({
        name: column.name,
        inferredType: column.inferredType as InferredType,
      }))
    : [];
  const analyzed = analyzeDql(source, columns);
  const items = link ? analyzed.diagnostics : analyzed.query ? [] : analyzed.diagnostics;
  return items.map((item) => toVsDiagnostic(document, item));
}

function toVsDiagnostic(document: vscode.TextDocument, item: Diagnostic): vscode.Diagnostic {
  const start = item.range ? document.positionAt(item.range.start) : new vscode.Position(0, 0);
  const end = item.range ? document.positionAt(item.range.end) : document.lineAt(0).range.end;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(start, end),
    item.message,
    item.severity === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : item.severity === "info"
        ? vscode.DiagnosticSeverity.Information
        : item.severity === "hint"
          ? vscode.DiagnosticSeverity.Hint
          : vscode.DiagnosticSeverity.Error,
  );
  diagnostic.source = "Data Pilot";
  diagnostic.code = item.code;
  return diagnostic;
}
