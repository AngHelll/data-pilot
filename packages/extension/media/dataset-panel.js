(function () {
  const vscode = acquireVsCodeApi();
  let sawInit = false;
  try {
    let canExecuteQuery = false;
    let canEdit = false;
    let canExport = false;
    let savedQueries = [];
    let columnTypes = [];
    let selected = null;
    let planTimer = null;

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
          renderDqlDiagnostics([]);
          text(els.dqlFormatted, "");
          return;
        }
        vscode.postMessage({ type: "planDql", dql });
      }, 450);
    }

    function renderGrid(grid) {
      text(els.gridLabel, grid.mode === "query" ? "Query result" : "Preview sample");
      const thead = els.grid.querySelector("thead");
      const tbody = els.grid.querySelector("tbody");
      thead.replaceChildren();
      tbody.replaceChildren();
      const hr = document.createElement("tr");
      const thIdx = document.createElement("th");
      text(thIdx, "#");
      hr.appendChild(thIdx);
      columnTypes = grid.columnTypes || [];
      for (let ci = 0; ci < grid.columns.length; ci++) {
        const col = grid.columns[ci];
        const th = document.createElement("th");
        const inferred = columnTypes[ci] && columnTypes[ci].inferredType;
        text(th, inferred ? col + " (" + inferred + ")" : col);
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      grid.rows.forEach((row, ri) => {
        const tr = document.createElement("tr");
        row.forEach((cell, ci) => {
          const td = document.createElement("td");
          td.className = "cell";
          text(td, cell);
          td.dataset.row = String(ri);
          td.dataset.col = grid.columns[ci] || "";
          td.addEventListener("click", () => selectCell(ri, grid.columns[ci] || "", cell, td));
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
      const parts = [
        grid.rowCountReturned + " rows shown",
        "completion: " + grid.completion,
        "scope: " + grid.scope,
      ];
      if (grid.totalCount !== undefined) parts.push("total: " + grid.totalCount);
      if (grid.scannedBytes !== undefined) parts.push("scanned ~" + grid.scannedBytes + " B");
      text(els.cost, parts.join(" · "));
    }

    function selectCell(rowIndex, column, display, td) {
      for (const el of els.grid.querySelectorAll("td.cell.selected")) {
        el.classList.remove("selected");
      }
      td.classList.add("selected");
      selected = { rowIndex, column, display };
      els.editValue.value = display === "null" || display === "·" ? "" : display;
      text(els.inspectDetail, "Loading…");
      text(els.editDiff, "");
      vscode.postMessage({ type: "inspectCell", rowIndex, column });
    }

    function setEditEnabled(on) {
      els.editValue.disabled = !on;
      els.previewEdit.disabled = !on;
      els.applyEdit.disabled = !on;
    }

    function syncQueryActionButtons() {
      els.saveQuery.disabled = !canExecuteQuery;
      els.exportQuery.disabled = !canExport;
      els.savedQueries.disabled = !canExecuteQuery;
    }

    function renderSavedQueries(queries) {
      savedQueries = queries || [];
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

    els.dql.addEventListener("input", () => schedulePlan());

    els.plan.addEventListener("click", () => {
      if (!canExecuteQuery) return;
      const dql = els.dql.value.trim();
      if (!dql) return;
      clearTimeout(planTimer);
      vscode.postMessage({ type: "planDql", dql });
    });

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

    els.savedQueries.addEventListener("change", () => {
      const v = els.savedQueries.value;
      if (!v) return;
      vscode.postMessage({ type: "loadSavedQuery", savedAtMs: Number(v) });
      els.savedQueries.value = "";
    });

    els.cancel.addEventListener("click", () => {
      vscode.postMessage({ type: "cancelQuery" });
    });

    els.reopen.addEventListener("click", () => {
      vscode.postMessage({ type: "reopenDataset" });
    });

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
      if (msg.type === "init") {
        sawInit = true;
        canExecuteQuery = !!msg.canExecuteQuery;
        canEdit = !!msg.canEdit;
        canExport = !!msg.canExport;
        els.run.disabled = !canExecuteQuery;
        els.plan.disabled = !canExecuteQuery;
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
        els.run.disabled = msg.running || !canExecuteQuery;
        els.plan.disabled = msg.running || !canExecuteQuery;
        if (!msg.running) syncQueryActionButtons();
        else {
          els.saveQuery.disabled = true;
          els.exportQuery.disabled = true;
        }
        els.cancel.disabled = !msg.running;
        return;
      }
      if (msg.type === "savedQueries") {
        renderSavedQueries(msg.queries);
        return;
      }
      if (msg.type === "queryLoaded") {
        els.dql.value = msg.dql;
        schedulePlan();
        return;
      }
      if (msg.type === "exportDone") {
        text(els.dqlFormatted, "Exported " + msg.rowCount + " rows → " + msg.path);
        return;
      }
      if (msg.type === "inspectResult") {
        text(
          els.inspectDetail,
          "#" + msg.rowIndex + " · " + msg.column + " · " + msg.inferredType +
            " · raw: " + JSON.stringify(msg.raw),
        );
        return;
      }
      if (msg.type === "editPreview") {
        text(els.editDiff, msg.preview.unifiedDiff || "(no changes)");
        return;
      }
      if (msg.type === "editApplied") {
        text(els.editDiff, "");
        selected = null;
        renderDescribe(msg.describe);
        renderIngestDiagnostics(msg.ingestDiagnostics);
        renderGrid(msg.preview);
        return;
      }
      if (msg.type === "dqlPlan") {
        renderDqlDiagnostics(msg.diagnostics);
        text(
          els.dqlFormatted,
          msg.formatted && msg.ok ? "Formatted: " + msg.formatted : "",
        );
        return;
      }
      if (msg.type === "staleSource") {
        showStale(msg.message);
        return;
      }
      if (msg.type === "session") {
        try {
          if (els.loading) els.loading.hidden = true;
          clearStale();
          const h = msg.handle;
          const titleEl = document.getElementById("title");
          if (titleEl && h.revision && h.revision.path) {
            text(titleEl, h.revision.path.split(/[/\\]/).pop() || "Dataset");
          }
          if (h.revision && h.revision.path) {
            text(els.meta, h.revision.path);
          }
          renderDescribe(msg.describe);
          renderIngestDiagnostics(msg.ingestDiagnostics);
          renderDqlDiagnostics([]);
          text(els.dqlFormatted, "");
          text(els.editDiff, "");
          selected = null;
          renderGrid(msg.preview);
        } catch (err) {
          if (els.loading) els.loading.hidden = false;
          text(els.loading, "UI error: " + (err && err.message ? err.message : String(err)));
        }
        return;
      }
      if (msg.type === "queryResult") {
        renderDqlDiagnostics(msg.diagnostics);
        renderGrid(msg.result);
        return;
      }
      if (msg.type === "error") {
        if (els.loading) els.loading.hidden = true;
        renderDqlDiagnostics([{ severity: "error", message: msg.message }]);
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
