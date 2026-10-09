(function () {
  const vscode = acquireVsCodeApi();
  let sawInit = false;
  try {
    let canExecuteQuery = false;
    let canEdit = false;
    let canExport = false;
    let canCompare = false;
    let comparePeers = [];
    let savedQueries = [];
    let columnTypes = [];
    let selected = null;
    let selectedPos = null;
    let planTimer = null;
    let inspectRaw = "";
    let lastGrid = null;
    let lastResult = null;
    let editorTab = "data";
    let hasResult = false;
    let queryOk = false;
    let queryRunning = false;
    const hiddenColumns = new Set();
    const columnWidths = new Map();

    const els = {
      loading: document.getElementById("loading"),
      meta: document.getElementById("meta"),
      trust: document.getElementById("trust"),
      staleRow: document.getElementById("stale-row"),
      staleBanner: document.getElementById("stale-banner"),
      reopen: document.getElementById("reopen"),
      describeMeta: document.getElementById("describe-meta"),
      schemaBody: document.querySelector("#schema tbody"),
      ingestDiagnostics: document.getElementById("ingest-diagnostics"),
      ingestEmpty: document.getElementById("ingest-empty"),
      dqlDiagnostics: document.getElementById("dql-diagnostics"),
      dqlFormatted: document.getElementById("dql-formatted"),
      dql: document.getElementById("dql"),
      plan: document.getElementById("plan"),
      run: document.getElementById("run"),
      saveQuery: document.getElementById("save-query"),
      exportQuery: document.getElementById("export-query"),
      savedQueries: document.getElementById("saved-queries"),
      cancel: document.getElementById("cancel"),
      cost: document.getElementById("cost"),
      gridLabel: document.getElementById("grid-label"),
      grid: document.getElementById("grid"),
      inspectDetail: document.getElementById("inspect-detail"),
      editValue: document.getElementById("edit-value"),
      previewEdit: document.getElementById("preview-edit"),
      applyEdit: document.getElementById("apply-edit"),
      editDiff: document.getElementById("edit-diff"),
      result: document.getElementById("result"),
      resultGrid: document.getElementById("result-grid"),
      resultFooter: document.getElementById("result-footer"),
      resultEmpty: document.getElementById("result-empty"),
      tabData: document.getElementById("tab-data"),
      tabResult: document.getElementById("tab-result"),
      tabCompare: document.getElementById("tab-compare"),
      tabProfile: document.getElementById("tab-profile"),
      tabChanges: document.getElementById("tab-changes"),
      panelData: document.getElementById("panel-data"),
      panelResult: document.getElementById("panel-result"),
      panelCompare: document.getElementById("panel-compare"),
      panelProfile: document.getElementById("panel-profile"),
      panelChanges: document.getElementById("panel-changes"),
      profileBody: document.querySelector("#profile-table tbody"),
      compareEmpty: document.getElementById("compare-empty"),
      compareControls: document.getElementById("compare-controls"),
      comparePeer: document.getElementById("compare-peer"),
      compareColumn: document.getElementById("compare-column"),
      compareRun: document.getElementById("compare-run"),
      compareDiagnostics: document.getElementById("compare-diagnostics"),
      compareLists: document.getElementById("compare-lists"),
      compareOnlyLeft: document.getElementById("compare-only-left"),
      compareOnlyRight: document.getElementById("compare-only-right"),
      compareChanged: document.getElementById("compare-changed"),
    };

    function text(el, value) {
      el.textContent = value ?? "";
    }

    function renderDescribe(desc) {
      const mtime = new Date(desc.mtimeMs).toLocaleString();
      text(
        els.describeMeta,
        desc.format.toUpperCase() + " · " +
          (desc.sizeBytes / 1024).toFixed(1) + " KiB · modified " + mtime +
          " · revision " + desc.revisionId.slice(0, 8),
      );
      els.schemaBody.replaceChildren();
      for (const col of desc.columns) {
        const tr = document.createElement("tr");
        for (const cell of [
          col.name,
          col.inferredType,
          col.nullCountSample != null ? String(col.nullCountSample) : "—",
          col.missingCountSample != null ? String(col.missingCountSample) : "—",
        ]) {
          const td = document.createElement("td");
          text(td, cell);
          tr.appendChild(td);
        }
        els.schemaBody.appendChild(tr);
      }
      columnTypes = desc.columns;
      fillCompareColumns();
      renderProfile(desc.columns);
    }

    function renderProfile(columns) {
      if (!els.profileBody) return;
      els.profileBody.replaceChildren();
      for (const col of columns) {
        const tr = document.createElement("tr");
        const cells = [
          col.name,
          col.inferredType,
          col.sampleSize != null ? String(col.sampleSize) : "",
          col.nullCountSample != null ? String(col.nullCountSample) : "",
          col.missingCountSample != null ? String(col.missingCountSample) : "",
          col.distinctCountSample != null ? String(col.distinctCountSample) : "",
          col.minSample ?? "",
          col.maxSample ?? "",
        ];
        for (const cell of cells) {
          const td = document.createElement("td");
          text(td, cell);
          tr.appendChild(td);
        }
        els.profileBody.appendChild(tr);
      }
    }

    function fillKeyList(list, keys) {
      if (!list) return;
      list.replaceChildren();
      if (!keys.length) {
        const li = document.createElement("li");
        li.textContent = "None";
        list.appendChild(li);
        return;
      }
      for (const key of keys) {
        const li = document.createElement("li");
        li.textContent = key;
        list.appendChild(li);
      }
    }

    function sharedColumns(peer) {
      const mine = new Set(columnTypes.map((column) => column.name));
      return peer.columns.filter((name) => mine.has(name));
    }

    function fillCompareColumns() {
      const select = els.compareColumn;
      if (!select) return;
      const peer = comparePeers.find((item) => item.datasetId === els.comparePeer.value);
      const previous = select.value;
      select.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Key column";
      select.appendChild(placeholder);
      if (!peer) return;
      for (const name of sharedColumns(peer)) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      }
      if ([...select.options].some((option) => option.value === previous)) {
        select.value = previous;
      }
    }

    function renderComparePeers(peers) {
      if (!els.compareEmpty || !els.compareControls || !els.comparePeer) return;
      comparePeers = peers;
      els.compareEmpty.hidden = peers.length > 0;
      els.compareControls.hidden = peers.length === 0;
      const previous = els.comparePeer.value;
      els.comparePeer.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose dataset";
      els.comparePeer.appendChild(placeholder);
      for (const peer of peers) {
        const option = document.createElement("option");
        option.value = peer.datasetId;
        option.textContent = peer.label;
        els.comparePeer.appendChild(option);
      }
      if (peers.some((peer) => peer.datasetId === previous)) els.comparePeer.value = previous;
      fillCompareColumns();
      if (els.compareRun) els.compareRun.disabled = !canCompare;
      syncSurfaceTabs();
    }

    function renderCompareResult(msg) {
      if (!els.compareDiagnostics || !els.compareLists) return;
      els.compareDiagnostics.replaceChildren();
      for (const item of msg.diagnostics || []) {
        const li = document.createElement("li");
        li.className = item.severity === "error" ? "err" : "warn";
        li.textContent = item.message;
        els.compareDiagnostics.appendChild(li);
      }
      if (msg.completion !== "complete") {
        els.compareLists.hidden = true;
        return;
      }
      els.compareLists.hidden = false;
      fillKeyList(els.compareOnlyLeft, msg.onlyLeft || []);
      fillKeyList(els.compareOnlyRight, msg.onlyRight || []);
      if (!els.compareChanged) return;
      els.compareChanged.replaceChildren();
      for (const row of msg.changed || []) {
        const li = document.createElement("li");
        const columns = row.columns && row.columns.length ? " · " + row.columns.join(", ") : "";
        li.textContent = row.key + columns;
        els.compareChanged.appendChild(li);
      }
    }

    function highlightDqlRange(range) {
      if (!range || typeof range.start !== "number" || typeof range.end !== "number") return;
      els.dql.focus();
      els.dql.setSelectionRange(range.start, range.end);
    }

    function renderDiagnosticList(listEl, emptyEl, items, clickable) {
      listEl.replaceChildren();
      const rows = items || [];
      if (emptyEl) emptyEl.hidden = rows.length > 0;
      for (const d of rows) {
        const li = document.createElement("li");
        li.className = d.severity === "error" ? "err" : d.severity === "warning" ? "warn" : "";
        const suffix = d.range ? " [chars " + d.range.start + "–" + d.range.end + "]" : "";
        text(li, (d.severity + ": " + d.message + suffix).trim());
        if (clickable && d.range) {
          li.classList.add("clickable");
          li.addEventListener("click", () => highlightDqlRange(d.range));
        }
        listEl.appendChild(li);
      }
    }

    function renderIngestDiagnostics(items) {
      renderDiagnosticList(els.ingestDiagnostics, els.ingestEmpty, items, false);
      const details = document.getElementById("ingest-details");
      if (details) details.hidden = !(items && items.length);
    }

    function syncSurfaceTabs() {
      if (document.body.dataset.layout !== "editor") return;
      if (els.tabResult) els.tabResult.hidden = !hasResult;
      if (els.tabCompare) els.tabCompare.hidden = comparePeers.length === 0;
      const pending = document.getElementById("changes-diff");
      const changesOn = !!(pending && !pending.hidden && pending.textContent.trim());
      if (els.tabChanges) els.tabChanges.hidden = !changesOn;
      const current = { result: els.tabResult, compare: els.tabCompare, changes: els.tabChanges }[editorTab];
      if (current && current.hidden) showEditorTab("data");
    }

    function renderDqlDiagnostics(items) {
      renderDiagnosticList(els.dqlDiagnostics, null, items, true);
      const hasError = (items || []).some((d) => d.severity === "error");
      els.dql.classList.toggle("dql-error", hasError);
      els.dql.classList.toggle("dql-ok", !hasError && (items || []).length > 0);
    }

    function schedulePlan() {
      if (!canExecuteQuery) return;
      clearTimeout(planTimer);
      planTimer = setTimeout(() => {
        const dql = els.dql.value.trim();
        if (!dql) {
          queryOk = false;
          renderDqlDiagnostics([]);
          text(els.dqlFormatted, "");
          syncQueryActionButtons();
          return;
        }
        vscode.postMessage({ type: "planDql", dql });
      }, 450);
    }

    function visibleNames(columns) {
      const shown = columns.filter((name) => name && !hiddenColumns.has(name));
      return shown.length > 0 ? shown : columns.slice(0, 1);
    }

    function syncFilterColumns(columns) {
      const sel = document.getElementById("filter-column");
      if (!sel) return;
      const current = sel.value;
      sel.replaceChildren();
      const blank = document.createElement("option");
      blank.value = "";
      text(blank, "Column");
      sel.appendChild(blank);
      for (const name of columns) {
        const opt = document.createElement("option");
        opt.value = name;
        text(opt, name);
        sel.appendChild(opt);
      }
      if (columns.indexOf(current) >= 0) sel.value = current;
    }

    function syncColumnPicker(columns) {
      const body = document.getElementById("column-picker-body");
      if (!body) return;
      body.replaceChildren();
      for (const name of columns) {
        const label = document.createElement("label");
        label.className = "col-check";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !hiddenColumns.has(name);
        input.addEventListener("change", () => {
          if (!input.checked) {
            const remaining = columns.filter((n) => n !== name && !hiddenColumns.has(n));
            if (remaining.length === 0) {
              input.checked = true;
              return;
            }
            hiddenColumns.add(name);
          } else {
            hiddenColumns.delete(name);
          }
          if (lastGrid) renderGrid(lastGrid);
        });
        label.appendChild(input);
        label.appendChild(document.createTextNode(" " + name));
        body.appendChild(label);
      }
    }

    function showEditorTab(name) {
      const panels = {
        data: els.panelData,
        result: els.panelResult,
        compare: els.panelCompare,
        profile: els.panelProfile,
        changes: els.panelChanges,
      };
      const tabs = {
        data: els.tabData,
        result: els.tabResult,
        compare: els.tabCompare,
        profile: els.tabProfile,
        changes: els.tabChanges,
      };
      if (!panels[name]) return;
      editorTab = name;
      for (const key of Object.keys(panels)) {
        if (panels[key]) panels[key].hidden = key !== name;
        if (tabs[key]) tabs[key].setAttribute("aria-selected", key === name ? "true" : "false");
      }
      syncInspector();
      syncEditorFooter();
    }

    function syncInspector() {
      const inspector = document.getElementById("inspector");
      if (!inspector) return;
      inspector.hidden = editorTab !== "data" || !selectedPos;
    }

    function syncEditorFooter() {
      const footer = document.getElementById("editor-footer");
      if (!footer) return;
      if (editorTab === "data" && lastGrid) {
        text(footer, previewFooter(lastGrid));
        return;
      }
      if (editorTab === "result" && lastResult) {
        text(footer, resultLine(lastResult));
        return;
      }
      text(footer, "");
    }

    function shownRange(grid) {
      const shown = grid.rows ? grid.rows.length : grid.rowCountReturned;
      if (!shown) return "showing 0";
      if (grid.totalCount !== undefined) return "showing 1–" + shown + " of " + grid.totalCount;
      if (grid.completion === "complete") return "showing 1–" + shown + " of " + shown;
      return "showing " + shown;
    }

    function rowsReturned(n) {
      return n + (n === 1 ? " row returned" : " rows returned");
    }

    function previewFooter(grid) {
      return ["Preview", rowsReturned(grid.rowCountReturned), grid.completion, shownRange(grid)].join(" · ");
    }

    function resultLine(grid) {
      return ["Result", rowsReturned(grid.rowCountReturned), grid.completion, shownRange(grid)].join(" · ");
    }

    function clearResult() {
      lastResult = null;
      hasResult = false;
      syncResultIdentity();
      if (els.resultEmpty) els.resultEmpty.hidden = false;
      if (!els.result) return;
      els.result.hidden = true;
      if (els.resultFooter) text(els.resultFooter, "");
      const thead = els.resultGrid && els.resultGrid.querySelector("thead");
      const tbody = els.resultGrid && els.resultGrid.querySelector("tbody");
      if (thead) thead.replaceChildren();
      if (tbody) tbody.replaceChildren();
      syncQueryActionButtons();
      syncSurfaceTabs();
      syncEditorFooter();
    }

    function renderResult(grid) {
      lastResult = grid;
      if (!els.result || !els.resultGrid) return;
      if (els.resultEmpty) els.resultEmpty.hidden = true;
      els.result.hidden = false;
      const thead = els.resultGrid.querySelector("thead");
      const tbody = els.resultGrid.querySelector("tbody");
      thead.replaceChildren();
      tbody.replaceChildren();
      const hr = document.createElement("tr");
      const thIdx = document.createElement("th");
      text(thIdx, "#");
      hr.appendChild(thIdx);
      for (const col of grid.columns) {
        const th = document.createElement("th");
        text(th, col);
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      grid.rows.forEach((row, ri) => {
        const tr = document.createElement("tr");
        const index = document.createElement("td");
        index.className = "num";
        text(index, String(ri));
        tr.appendChild(index);
        row.forEach((cell, ci) => {
          const col = grid.columns[ci] || "";
          const td = document.createElement("td");
          paintCell(td, cell, col);
          td.dataset.row = String(ri);
          td.dataset.col = col;
          const source = grid.sourceRowIndexes && Number.isInteger(grid.sourceRowIndexes[ri])
            ? grid.sourceRowIndexes[ri]
            : null;
          if (source != null) td.dataset.sourceRow = String(source);
          td.addEventListener("click", () => selectCell(ri, col, cell, td, source));
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      if (els.resultFooter) text(els.resultFooter, resultLine(grid));
      hasResult = true;
      syncResultIdentity();
      syncQueryActionButtons();
      syncSurfaceTabs();
      syncEditorFooter();
    }

    function queryLine() {
      if (!els.dql) return "";
      const single = els.dql.value.replace(/\s+/g, " ").trim();
      return single.length > 80 ? single.slice(0, 79) + "…" : single;
    }

    function syncResultIdentity() {
      const label = document.getElementById("result-label");
      if (!label) return;
      const line = queryLine();
      const titleEl = document.getElementById("title");
      const file = titleEl ? titleEl.textContent.trim() : "";
      if (!hasResult || !line) {
        text(label, "Result");
        return;
      }
      text(label, file ? line + " — " + file : line);
    }

    function showChangesDiff(value) {
      const empty = document.getElementById("changes-empty");
      const pre = document.getElementById("changes-diff");
      if (!empty || !pre) return;
      if (!value) {
        empty.hidden = false;
        pre.hidden = true;
        text(pre, "");
        text(empty, "No pending change.");
        syncSurfaceTabs();
        return;
      }
      empty.hidden = true;
      pre.hidden = false;
      text(pre, value);
      syncSurfaceTabs();
    }

    function renderGrid(grid) {
      lastGrid = grid;
      if (els.gridLabel) text(els.gridLabel, "Preview sample");
      const thead = els.grid.querySelector("thead");
      const tbody = els.grid.querySelector("tbody");
      thead.replaceChildren();
      tbody.replaceChildren();
      const names = visibleNames(grid.columns);
      const shown = new Set(names);
      const hr = document.createElement("tr");
      const thIdx = document.createElement("th");
      text(thIdx, "#");
      hr.appendChild(thIdx);
      columnTypes = grid.columnTypes || [];
      for (let ci = 0; ci < grid.columns.length; ci++) {
        const col = grid.columns[ci];
        if (!shown.has(col)) continue;
        const th = document.createElement("th");
        const inferred = columnTypes[ci] && columnTypes[ci].inferredType;
        const label = document.createElement("span");
        text(label, inferred ? col + " (" + inferred + ")" : col);
        th.appendChild(label);
        const grip = document.createElement("span");
        grip.className = "col-resize";
        grip.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const startX = event.clientX;
          const startW = th.getBoundingClientRect().width;
          const move = (ev) => {
            const next = Math.max(72, startW + ev.clientX - startX);
            columnWidths.set(col, next);
            th.style.width = next + "px";
          };
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        });
        th.appendChild(grip);
        const width = columnWidths.get(col);
        if (typeof width === "number") th.style.width = width + "px";
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      grid.rows.forEach((row, ri) => {
        const tr = document.createElement("tr");
        row.forEach((cell, ci) => {
          const col = grid.columns[ci] || "";
          if (!shown.has(col)) return;
          const td = document.createElement("td");
          paintCell(td, cell, col);
          td.dataset.row = String(ri);
          td.dataset.col = col;
          td.dataset.sourceRow = String(ri);
          td.addEventListener("click", () => selectCell(ri, col, cell, td, ri));
          tr.appendChild(td);
        });
        tr.insertBefore((() => {
          const td = document.createElement("td");
          td.className = "num";
          text(td, String(ri));
          return td;
        })(), tr.firstChild);
        tbody.appendChild(tr);
      });
      if (selectedPos) {
        const keep = tbody.querySelector(
          'td.cell[data-row="' + selectedPos.row + '"][data-col="' + CSS.escape(selectedPos.column) + '"]',
        );
        if (keep) keep.classList.add("selected");
        else selectedPos = null;
      }
      syncFilterColumns(grid.columns);
      syncColumnPicker(grid.columns);
      const parts = [
        "Preview",
        grid.rowCountReturned + " rows shown",
        "completion: " + grid.completion,
        "scope: " + grid.scope,
      ];
      if (grid.totalCount !== undefined) parts.push("total: " + grid.totalCount);
      if (grid.scannedBytes !== undefined) parts.push("scanned ~" + grid.scannedBytes + " B");
      text(els.cost, parts.join(" · "));
      syncInspector();
      syncEditorFooter();
    }

    function formatBytes(n) {
      if (typeof n !== "number") return "";
      if (n < 1024) return n + " B";
      return (n / 1024).toFixed(1) + " KiB";
    }

    function editorFileCount(preview) {
      if (!preview) return "sample · total unknown";
      if (preview.totalCount !== undefined) return preview.totalCount + " rows";
      if (preview.completion === "complete") return preview.rowCountReturned + " rows";
      return "sample · total unknown";
    }

    function applyDatasetColor(token) {
      const dot = document.getElementById("dataset-color");
      const known = token === "charts.blue" || token === "charts.green" || token === "charts.orange" || token === "charts.purple" || token === "charts.red" || token === "charts.yellow";
      if (!known) {
        document.body.style.removeProperty("--dataset-color");
        if (dot) dot.hidden = true;
        return;
      }
      document.body.style.setProperty("--dataset-color", "var(--vscode-" + token.replace(".", "-") + ")");
      if (dot) dot.hidden = false;
    }

    function renderEditorSummary(handle, preview) {
      const formatEl = document.getElementById("editor-format");
      if (!formatEl || !handle) return;
      const size = handle.revision ? formatBytes(handle.revision.sizeBytes) : "";
      const columns = preview && preview.columns ? preview.columns.length + " columns" : "";
      text(formatEl, [handle.format, size, editorFileCount(preview), columns].filter(Boolean).join(" · "));
    }

    let cellEditor = null;
    let pendingConfirm = null;
    let inspectReady = false;

    function inferredOf(name) {
      const found = columnTypes.find((col) => col && col.name === name);
      return found ? found.inferredType : "";
    }

    function paintCell(td, display, name) {
      td.className = "cell";
      if (display === "null") td.classList.add("cell-null");
      else if (display === "·") td.classList.add("cell-missing");
      else {
        const kind = inferredOf(name);
        if (
          kind === "string" || kind === "integer" || kind === "decimal" ||
          kind === "boolean" || kind === "date" || kind === "datetime"
        ) {
          td.classList.add("cell-type-" + kind);
        }
      }
      text(td, display);
    }

    function closeCellEditor() {
      if (!cellEditor) return;
      const td = cellEditor.parentElement;
      const display = selected ? selected.display : "";
      const name = selected ? selected.column : "";
      cellEditor = null;
      if (td) {
        paintCell(td, display, name);
        td.classList.add("selected");
      }
    }

    function beginCellEdit() {
      if (!canEdit || !selected || selected.rowIndex == null) return;
      const td = document.querySelector("td.cell.selected");
      if (!td || cellEditor) return;
      const input = document.createElement("input");
      input.className = "cell-editor";
      input.value = selected.display === "null" || selected.display === "·" ? "" : selected.display;
      td.replaceChildren(input);
      cellEditor = input;
      input.focus();
      input.select();
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeCellEditor();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          const next = input.value;
          const previous = selected.display === "null" || selected.display === "·" ? "" : selected.display;
          closeCellEditor();
          if (next === previous) return;
          pendingConfirm = { rowIndex: selected.rowIndex, column: selected.column, newRaw: next };
          vscode.postMessage({
            type: "proposeEdit",
            rowIndex: selected.rowIndex,
            column: selected.column,
            newRaw: next,
          });
        }
      });
    }

    function confirmPendingEdit() {
      if (!pendingConfirm || !canEdit) return;
      const edit = pendingConfirm;
      pendingConfirm = null;
      vscode.postMessage({
        type: "applyEdit",
        rowIndex: edit.rowIndex,
        column: edit.column,
        newRaw: edit.newRaw,
      });
    }

    function copyActive(rowMode) {
      const grid = editorTab === "result" && lastResult ? lastResult : lastGrid;
      if (!selectedPos || !grid || !selected) return;
      if (rowMode) {
        const names = visibleNames(grid.columns);
        const row = grid.rows[selectedPos.row] || [];
        const line = names.map((name) => {
          const ci = grid.columns.indexOf(name);
          return row[ci] == null ? "" : String(row[ci]);
        }).join("\t");
        vscode.postMessage({ type: "copyText", text: line });
        return;
      }
      const raw = inspectReady ? inspectRaw : (selected.display === "·" ? "" : selected.display);
      vscode.postMessage({ type: "copyText", text: raw });
    }

    function paintInspector(column, type, raw, pending) {
      const colEl = document.getElementById("inspect-column");
      const typeEl = document.getElementById("inspect-type");
      const rawEl = document.getElementById("inspect-raw");
      if (colEl) text(colEl, column || "—");
      if (typeEl) {
        const label = !type || pending ? "…" : type.charAt(0).toUpperCase() + type.slice(1);
        text(typeEl, label);
      }
      if (rawEl) text(rawEl, pending ? "…" : String(raw));
    }

    function selectCell(viewRow, column, display, td, sourceRow) {
      closeCellEditor();
      pendingConfirm = null;
      inspectReady = false;
      inspectRaw = "";
      for (const el of document.querySelectorAll("td.cell.selected")) {
        el.classList.remove("selected");
      }
      td.classList.add("selected");
      selected = { rowIndex: sourceRow, column, display };
      selectedPos = { row: viewRow, column, sourceRow };
      els.editValue.value = display === "null" || display === "·" ? "" : display;
      text(els.editDiff, "");
      if (sourceRow == null) {
        if (document.getElementById("inspect-column")) paintInspector(column, "", "", true);
        text(els.inspectDetail, "This result does not point at a file row.");
        setEditEnabled(false);
        syncInspector();
        return;
      }
      setEditEnabled(canEdit);
      if (document.getElementById("inspect-column")) {
        paintInspector(column, "", "", true);
        text(els.inspectDetail, "");
      } else {
        text(els.inspectDetail, "Loading…");
      }
      syncInspector();
      vscode.postMessage({ type: "inspectCell", rowIndex: sourceRow, column });
    }

    function setEditEnabled(on) {
      els.editValue.disabled = !on;
      els.previewEdit.disabled = !on;
      els.applyEdit.disabled = !on;
    }

    function syncQuerySummary() {
      const summary = document.getElementById("query-summary");
      if (!summary || !els.dql) return;
      const single = els.dql.value.replace(/\s+/g, " ").trim();
      const line = single.length > 80 ? single.slice(0, 79) + "…" : single;
      text(summary, line || "Query");
      syncResultIdentity();
    }

    function syncQueryActionButtons() {
      const editor = document.body.dataset.layout === "editor";
      const textOk = !!(els.dql && els.dql.value.trim() && queryOk);
      if (editor) {
        const saveOn = canExecuteQuery && textOk && !queryRunning;
        if (els.saveQuery) {
          els.saveQuery.hidden = !saveOn;
          els.saveQuery.disabled = !saveOn;
        }
        const actions = document.getElementById("query-actions");
        if (actions) actions.hidden = !saveOn;
        if (els.cancel) {
          els.cancel.hidden = !queryRunning;
          els.cancel.disabled = !queryRunning;
        }
        if (els.exportQuery) {
          const exportOn = canExport && hasResult && !queryRunning;
          els.exportQuery.hidden = !exportOn;
          els.exportQuery.disabled = !exportOn;
        }
        return;
      }
      if (els.saveQuery) els.saveQuery.disabled = !canExecuteQuery || queryRunning;
      if (els.exportQuery) els.exportQuery.disabled = !canExport || queryRunning;
      if (els.cancel) els.cancel.disabled = !queryRunning;
      if (els.savedQueries) els.savedQueries.disabled = !canExecuteQuery;
    }

    function renderSavedQueries(queries) {
      savedQueries = queries || [];
      if (!els.savedQueries) return;
      els.savedQueries.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      text(placeholder, "— load saved query —");
      els.savedQueries.appendChild(placeholder);
      for (const q of savedQueries) {
        const opt = document.createElement("option");
        opt.value = String(q.savedAtMs);
        const label = q.dql.length > 48 ? q.dql.slice(0, 45) + "…" : q.dql;
        text(opt, label);
        els.savedQueries.appendChild(opt);
      }
    }

    els.grid.addEventListener("keydown", (event) => {
      if (!lastGrid) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      const names = visibleNames(lastGrid.columns);
      if (!names.length || !lastGrid.rows.length) return;
      event.preventDefault();
      let ri = selectedPos ? selectedPos.row : 0;
      let ci = selectedPos ? names.indexOf(selectedPos.column) : 0;
      if (ci < 0) ci = 0;
      if (event.key === "ArrowUp") ri = Math.max(0, ri - 1);
      if (event.key === "ArrowDown") ri = Math.min(lastGrid.rows.length - 1, ri + 1);
      if (event.key === "ArrowLeft") ci = Math.max(0, ci - 1);
      if (event.key === "ArrowRight") ci = Math.min(names.length - 1, ci + 1);
      const name = names[ci];
      const sourceIndex = lastGrid.columns.indexOf(name);
      const td = els.grid.querySelector(
        'td.cell[data-row="' + ri + '"][data-col="' + CSS.escape(name) + '"]',
      );
      if (!td || sourceIndex < 0) return;
      selectCell(ri, name, lastGrid.rows[ri][sourceIndex], td, ri);
      td.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

    document.addEventListener("keydown", (event) => {
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && !typing && selectedPos) {
        event.preventDefault();
        copyActive(event.shiftKey);
        return;
      }
      const active = document.activeElement;
      const inGrid = !active || active === document.body ||
        (els.grid && (active === els.grid || els.grid.contains(active))) ||
        (els.resultGrid && (active === els.resultGrid || els.resultGrid.contains(active)));
      if (event.key !== "Enter" || typing || !inGrid || !selectedPos) return;
      event.preventDefault();
      if (pendingConfirm) confirmPendingEdit();
      else beginCellEdit();
    });

    const applyFilter = document.getElementById("apply-filter");
    const filterOp = document.getElementById("filter-op");
    const filterValue = document.getElementById("filter-value");
    if (filterOp && filterValue) {
      filterOp.addEventListener("change", () => {
        const nullOp = filterOp.value === "is null" || filterOp.value === "is not null";
        filterValue.disabled = nullOp;
      });
    }
    function postFilter(project) {
      const columnEl = document.getElementById("filter-column");
      const column = columnEl ? columnEl.value : "";
      const op = filterOp ? filterOp.value : "";
      const value = filterValue ? filterValue.value : "";
      const searchEl = document.getElementById("filter-search");
      const search = searchEl ? searchEl.value.trim() : "";
      const columns = lastGrid ? visibleNames(lastGrid.columns) : [];
      if (!project && !search && !(column && op)) return;
      if (project && columns.length === 0) return;
      const message = { type: "applyFilter", columns };
      if (column) message.column = column;
      if (op) message.op = op;
      if (value) message.value = value;
      if (search) message.search = search;
      if (project) message.project = true;
      vscode.postMessage(message);
    }
    if (applyFilter) applyFilter.addEventListener("click", () => postFilter(false));
    const columnPicker = document.getElementById("column-picker");
    if (columnPicker) {
      let columnSnapshot = null;
      columnPicker.addEventListener("toggle", () => {
        if (columnPicker.open) {
          columnSnapshot = [...hiddenColumns].sort().join("\0");
          return;
        }
        const now = [...hiddenColumns].sort().join("\0");
        if (columnSnapshot !== null && now !== columnSnapshot) postFilter(true);
      });
    }

    els.dql.addEventListener("input", () => {
      queryOk = false;
      syncQuerySummary();
      syncQueryActionButtons();
      schedulePlan();
    });

    if (els.plan) {
      els.plan.addEventListener("click", () => {
        if (!canExecuteQuery) return;
        const dql = els.dql.value.trim();
        if (!dql) return;
        clearTimeout(planTimer);
        vscode.postMessage({ type: "planDql", dql });
      });
    }

    els.run.addEventListener("click", () => {
      if (!canExecuteQuery) return;
      const dql = els.dql.value.trim();
      if (!dql) return;
      vscode.postMessage({ type: "runQuery", dql });
    });

    els.saveQuery.addEventListener("click", () => {
      if (!canExecuteQuery) return;
      const dql = els.dql.value.trim();
      if (!dql) return;
      vscode.postMessage({ type: "saveQuery", dql });
    });

    els.exportQuery.addEventListener("click", () => {
      if (!canExport) return;
      const dql = els.dql.value.trim();
      if (!dql) return;
      vscode.postMessage({ type: "exportQuery", dql, format: "same-as-source" });
    });

    if (els.savedQueries) {
      els.savedQueries.addEventListener("change", () => {
        const v = els.savedQueries.value;
        if (!v) return;
        vscode.postMessage({ type: "loadSavedQuery", savedAtMs: Number(v) });
        els.savedQueries.value = "";
      });
    }

    const inspectorToggle = document.getElementById("inspector-toggle");
    if (inspectorToggle) {
      inspectorToggle.addEventListener("click", () => {
        const collapsed = document.body.classList.toggle("inspector-collapsed");
        text(inspectorToggle, collapsed ? "Show inspector" : "Hide inspector");
      });
    }
    const copyCell = document.getElementById("copy-cell");
    if (copyCell) {
      copyCell.addEventListener("click", () => {
        if (!inspectRaw) return;
        vscode.postMessage({ type: "copyText", text: inspectRaw });
      });
    }

    els.cancel.addEventListener("click", () => {
      vscode.postMessage({ type: "cancelQuery" });
    });

    els.reopen.addEventListener("click", () => {
      vscode.postMessage({ type: "reopenDataset" });
    });
    const revertEdit = document.getElementById("revert-edit");
    if (revertEdit) {
      revertEdit.addEventListener("click", () => {
        vscode.postMessage({ type: "revertLastEdit" });
      });
    }
    const clearResultButton = document.getElementById("clear-result");
    if (clearResultButton) {
      clearResultButton.addEventListener("click", () => {
        clearResult();
        showEditorTab("data");
      });
    }

    function showStale(message) {
      text(els.staleBanner, message);
      els.staleRow.hidden = false;
    }

    function clearStale() {
      els.staleRow.hidden = true;
      text(els.staleBanner, "");
    }

    els.previewEdit.addEventListener("click", () => {
      if (!canEdit || !selected) return;
      vscode.postMessage({
        type: "proposeEdit",
        rowIndex: selected.rowIndex,
        column: selected.column,
        newRaw: els.editValue.value,
      });
    });

    if (els.tabData) els.tabData.addEventListener("click", () => showEditorTab("data"));
    if (els.tabResult) els.tabResult.addEventListener("click", () => showEditorTab("result"));
    if (els.tabCompare) els.tabCompare.addEventListener("click", () => showEditorTab("compare"));
    if (els.tabProfile) els.tabProfile.addEventListener("click", () => showEditorTab("profile"));
    if (els.tabChanges) els.tabChanges.addEventListener("click", () => showEditorTab("changes"));

    if (els.comparePeer) {
      els.comparePeer.addEventListener("change", () => fillCompareColumns());
    }
    if (els.compareRun) {
      els.compareRun.addEventListener("click", () => {
        if (!canCompare || !els.comparePeer.value || !els.compareColumn.value) return;
        vscode.postMessage({
          type: "compareDatasets",
          rightDatasetId: els.comparePeer.value,
          column: els.compareColumn.value,
        });
      });
    }

    els.applyEdit.addEventListener("click", () => {
      if (!canEdit || !selected) return;
      vscode.postMessage({
        type: "applyEdit",
        rowIndex: selected.rowIndex,
        column: selected.column,
        newRaw: els.editValue.value,
      });
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "requestDql") {
        vscode.postMessage({
          type: "reportDql",
          requestId: msg.requestId,
          dql: els.dql ? els.dql.value : "",
        });
        return;
      }
      if (msg.type === "init") {
        sawInit = true;
        canExecuteQuery = !!msg.canExecuteQuery;
        canEdit = !!msg.canEdit;
        canExport = !!msg.canExport;
        canCompare = msg.trustMode !== "untrusted-limited";
        if (els.compareRun) els.compareRun.disabled = !canCompare;
        els.run.disabled = !canExecuteQuery;
        if (els.plan) els.plan.disabled = !canExecuteQuery;
        els.dql.disabled = !canExecuteQuery;
        setEditEnabled(canEdit);
        syncQueryActionButtons();
        renderSavedQueries(msg.savedQueries);
        if (msg.trustMode === "untrusted-limited") {
          text(els.trust, "Untrusted workspace — preview only. Trust the folder to run DQL or edit.");
        } else if (!canEdit) {
          text(els.trust, "Edit disabled by setting dataPilot.allowEdit.");
        } else {
          text(els.trust, "");
        }
        return;
      }
      if (msg.type === "idle") {
        if (els.loading) {
          els.loading.hidden = false;
          text(els.loading, msg.message);
        }
        return;
      }
      if (msg.type === "queryState") {
        queryRunning = !!msg.running;
        els.run.disabled = queryRunning || !canExecuteQuery;
        if (els.plan) els.plan.disabled = queryRunning || !canExecuteQuery;
        syncQueryActionButtons();
        return;
      }
      if (msg.type === "savedQueries") {
        renderSavedQueries(msg.queries);
        return;
      }
      if (msg.type === "comparePeers") {
        renderComparePeers(msg.peers || []);
        return;
      }
      if (msg.type === "compareResult") {
        renderCompareResult(msg);
        return;
      }
      if (msg.type === "queryLoaded") {
        els.dql.value = msg.dql;
        queryOk = false;
        syncQuerySummary();
        syncQueryActionButtons();
        schedulePlan();
        return;
      }
      if (msg.type === "exportDone") {
        text(els.dqlFormatted, "Exported " + msg.rowCount + " rows → " + msg.path);
        return;
      }
      if (msg.type === "inspectResult") {
        inspectRaw = typeof msg.raw === "string" ? msg.raw : JSON.stringify(msg.raw);
        inspectReady = true;
        if (document.getElementById("inspect-column")) {
          paintInspector(msg.column, msg.inferredType || "", inspectRaw, false);
          text(els.inspectDetail, "");
        } else {
          text(
            els.inspectDetail,
            "#" + msg.rowIndex + " · " + msg.column + " · " + msg.inferredType +
              " · raw: " + JSON.stringify(msg.raw),
          );
        }
        return;
      }
      if (msg.type === "editPreview") {
        const diff = msg.preview.unifiedDiff || "(no changes)";
        text(els.editDiff, diff);
        showChangesDiff(diff);
        return;
      }
      if (msg.type === "editApplied") {
        text(els.editDiff, "");
        showChangesDiff("");
        selected = null;
        renderDescribe(msg.describe);
        renderIngestDiagnostics(msg.ingestDiagnostics);
        renderGrid(msg.preview);
        clearResult();
        showEditorTab("data");
        return;
      }
      if (msg.type === "dqlPlan") {
        queryOk = !!msg.ok;
        renderDqlDiagnostics(msg.diagnostics);
        text(
          els.dqlFormatted,
          msg.formatted && msg.ok ? "Formatted: " + msg.formatted : "",
        );
        syncQueryActionButtons();
        return;
      }
      if (msg.type === "staleSource") {
        showStale(msg.message);
        clearResult();
        showEditorTab("data");
        return;
      }
      if (msg.type === "revertState") {
        const row = document.getElementById("revert-row");
        if (row) row.hidden = !msg.available;
        return;
      }
      if (msg.type === "session") {
        try {
          if (els.loading) els.loading.hidden = true;
          clearStale();
          const h = msg.handle;
          const titleEl = document.getElementById("title");
          const head = document.getElementById("editor-head");
          if (titleEl && h.revision && h.revision.path) {
            text(titleEl, h.revision.path.split(/[/\\]/).pop() || "Dataset");
          }
          if (head && h.revision && h.revision.path) head.title = h.revision.path;
          const schemaPath = document.getElementById("schema-path");
          const filePath = h.revision && h.revision.path ? h.revision.path : "";
          if (els.meta) text(els.meta, filePath);
          if (schemaPath) schemaPath.hidden = filePath.length === 0;
          applyDatasetColor(msg.datasetColor);
          renderDescribe(msg.describe);
          renderIngestDiagnostics(msg.ingestDiagnostics);
          renderDqlDiagnostics([]);
          text(els.dqlFormatted, "");
          text(els.editDiff, "");
          showChangesDiff("");
          selected = null;
          selectedPos = null;
          inspectRaw = "";
          renderEditorSummary(h, msg.preview);
          renderGrid(msg.preview);
          clearResult();
          showEditorTab("data");
        } catch (err) {
          if (els.loading) els.loading.hidden = false;
          text(els.loading, "UI error: " + (err && err.message ? err.message : String(err)));
        }
        return;
      }
      if (msg.type === "queryResult") {
        renderDqlDiagnostics(msg.diagnostics);
        queryOk = !(msg.diagnostics || []).some((d) => d.severity === "error");
        renderResult(msg.result);
        syncQueryActionButtons();
        showEditorTab("result");
        return;
      }
      if (msg.type === "error") {
        if (els.loading) els.loading.hidden = true;
        queryOk = false;
        renderDqlDiagnostics([{ severity: "error", message: msg.message }]);
        syncQueryActionButtons();
      }
    });
  } catch (err) {
    const loadingEl = document.getElementById("loading");
    if (loadingEl) {
      loadingEl.hidden = false;
      loadingEl.textContent = "UI boot error: " + (err && err.message ? err.message : String(err));
    }
  }

  function announceReady() {
    vscode.postMessage({ type: "webviewReady" });
  }
  announceReady();
  queueMicrotask(() => {
    if (!sawInit) announceReady();
  });
})();
