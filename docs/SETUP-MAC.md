# Data Pilot — setup en Mac

## Si clonaste el repo temporal de Cursor

Cursor crea carpetas como `tmp-23fca949cfc9bbb8`. Conviene renombrarlas y alinearlas con el resto de tus repos (`bdd-pilot`, etc.).

```bash
mkdir -p ~/workspace/repos

# Ajusta la ruta si clonaste en otro sitio (Downloads, Desktop, etc.)
SRC=~/tmp-23fca949cfc9bbb8
DEST=~/workspace/repos/data-pilot

if [ ! -d "$SRC" ]; then
  echo "No encontré $SRC — indica dónde está tu clone."
  exit 1
fi

if [ -e "$DEST" ]; then
  echo "Ya existe $DEST — no sobrescribo. Revisa manualmente."
  exit 1
fi

mv "$SRC" "$DEST"
cd "$DEST"

# Rama con fases 0–2 (si no estás ya ahí)
git fetch origin 2>/dev/null || true
git checkout cursor/phase-0-foundation-b430 2>/dev/null || git branch --show-current

npm install
npm run build
npm test
```

Abre en Cursor: **File → Open Folder** → `~/workspace/repos/data-pilot`.

## Remotes

| Remote | Uso |
|--------|-----|
| `origin` (Cursor tmp) | Solo mientras no exista GitHub; no clones de nuevo desde terminal sin Create repo |
| `github` (opcional) | Cuando crees `AngHelll/data-pilot`: `git remote add github git@github.com:AngHelll/data-pilot.git` |

## Smoke

```bash
npm run preview -- fixtures/sample/tiny.csv
npm run query -- fixtures/sample/tiny.csv 'where country = "MX" | count'
```

Plan y decisiones del Project viven en **Context** de Cursor (Agent Store), no en este repo.

## Workflow local (agente)

Como en BDD Pilot: el pipeline ForgeOne (gates, specs, ContextOps) vive en **`docs-internal/`** y **`.cursor/`**, ambos **gitignored**. No se publica ni se commitea. Después de clonar, esas carpetas solo existen en esta máquina (copiar de otro repo Pilot o regenerar). Docs públicos de producto/arquitectura siguen en `docs/`.
