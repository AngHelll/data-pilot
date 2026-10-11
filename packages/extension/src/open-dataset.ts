import * as path from "node:path";
import * as vscode from "vscode";
import { assertOpAllowed } from "@data-pilot/core";
import type { ExtensionEngineHost } from "./engine-host";
import { workspaceTrustMode } from "./engine-host";
import { isDatasetUri } from "./dataset-uri";
import type { SavedQueryStore } from "./saved-query-store";
import { DATA_PILOT_VIEW_TYPE } from "./dataset-custom-editor";
import {
  datasetOpenPlan,
  type DatasetOpenTab,
  type DatasetTabKind,
} from "./dataset-open-plan";

export async function openDatasetUri(
  _engine: ExtensionEngineHost,
  _context: vscode.ExtensionContext,
  _savedQueries: SavedQueryStore,
  uri: vscode.Uri,
): Promise<boolean> {
  const blocked = assertOpAllowed({ trustMode: workspaceTrustMode() }, "openDataset");
  if (blocked) {
    void vscode.window.showErrorMessage(blocked.message);
    return false;
  }
  if (!isDatasetUri(uri)) {
    void vscode.window.showErrorMessage("Data Pilot supports local CSV and JSONL files only.");
    return false;
  }

  await openDatasetTab(uri);
  return true;
}

async function openDatasetTab(uri: vscode.Uri): Promise<void> {
  const plan = datasetOpenPlan(collectOpenTabs(uri));
  if (plan.action === "focus") {
    await vscode.commands.executeCommand("vscode.openWith", uri, DATA_PILOT_VIEW_TYPE, {
      viewColumn: viewColumnAt(plan.groupIndex),
      preview: false,
    });
    return;
  }
  if (plan.action === "replace-text") {
    const column = viewColumnAt(plan.groupIndex);
    const closing = plan.close
      .map((ref) => vscode.window.tabGroups.all[ref.groupIndex]?.tabs[ref.tabIndex])
      .filter((tab): tab is vscode.Tab => tab !== undefined);
    if (closing.length > 0) await vscode.window.tabGroups.close(closing);
    await vscode.commands.executeCommand("vscode.openWith", uri, DATA_PILOT_VIEW_TYPE, {
      viewColumn: column,
      preview: false,
    });
    return;
  }
  await vscode.commands.executeCommand("vscode.openWith", uri, DATA_PILOT_VIEW_TYPE, {
    preview: false,
  });
}

function viewColumnAt(groupIndex: number): vscode.ViewColumn {
  return vscode.window.tabGroups.all[groupIndex]?.viewColumn ?? vscode.ViewColumn.Active;
}

function collectOpenTabs(uri: vscode.Uri): DatasetOpenTab[] {
  const target = path.resolve(uri.fsPath);
  const active = vscode.window.tabGroups.activeTabGroup.activeTab;
  const tabs: DatasetOpenTab[] = [];
  vscode.window.tabGroups.all.forEach((group, groupIndex) => {
    group.tabs.forEach((tab, tabIndex) => {
      const classified = classifyTab(tab, target);
      if (!classified) return;
      tabs.push({
        ...classified,
        active: tab === active,
        groupIndex,
        tabIndex,
      });
    });
  });
  return tabs;
}

function classifyTab(
  tab: vscode.Tab,
  target: string,
): { kind: DatasetTabKind; matchesFile: boolean } | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) {
    return { kind: "text", matchesFile: path.resolve(input.uri.fsPath) === target };
  }
  if (input instanceof vscode.TabInputCustom) {
    const matchesFile = path.resolve(input.uri.fsPath) === target;
    const kind: DatasetTabKind = input.viewType === DATA_PILOT_VIEW_TYPE ? "data-pilot" : "other";
    return { kind, matchesFile };
  }
  return undefined;
}
