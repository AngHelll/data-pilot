/** Dataset linked to a `.dql` document. Stored outside the query text. No vscode. */

export interface DqlColumnRef {
  name: string;
  inferredType: string;
}

export interface DqlDocumentLink {
  datasetPath: string;
  columns: DqlColumnRef[];
}

/**
 * A named link wins. With no link, the caller must ask.
 * Open sessions are not a fallback: the first one is not chosen.
 */
export function fileName(datasetPath: string): string {
  const name = datasetPath.split(/[/\\]/).pop();
  return name && name.length > 0 ? name : datasetPath;
}

/** What the open query will run on. */
export function runTargetText(datasetPath: string | undefined): string {
  if (!datasetPath) return "No dataset — Run will ask which one";
  return `Runs on ${fileName(datasetPath)}`;
}

/** Same target, with the hint that a click can change it. */
export function runTargetActionText(datasetPath: string | undefined): string {
  if (!datasetPath) return "No dataset — click to choose";
  return `Runs on ${fileName(datasetPath)} · click to change`;
}

/** Rows already shown, plus the query that is in front now. */
export function resultTargetText(
  shownPath: string | undefined,
  nextPath: string | undefined,
): string {
  const next = nextPath
    ? `The query in front runs on ${fileName(nextPath)}.`
    : "The query in front has no dataset. Run will ask which one.";
  if (!shownPath) return next;
  if (shownPath === nextPath) return `Rows from ${fileName(shownPath)}.`;
  return `Rows from ${fileName(shownPath)}. ${next}`;
}

/** Current link first, then the other open sessions. Cancel leaves this list unused. */
export function runOnChoices(
  openPaths: readonly string[],
  currentPath: string | undefined,
): { path: string; current: boolean }[] {
  const seen = new Set<string>();
  const out: { path: string; current: boolean }[] = [];
  const add = (path: string): void => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push({ path, current: path === currentPath });
  };
  if (currentPath) add(currentPath);
  for (const path of openPaths) add(path);
  return out;
}

export function chooseDatasetPath(
  link: DqlDocumentLink | undefined,
  _openPaths: readonly string[],
): string | undefined {
  if (link?.datasetPath) return link.datasetPath;
  return undefined;
}
