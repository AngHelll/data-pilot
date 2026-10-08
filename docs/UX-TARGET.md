# Data Pilot — Diseño UX objetivo y evaluación de alineación

**Fecha:** 7 de octubre de 2026  
**Versión:** 0.1  
**Estado:** dirección de diseño acordada; implementación y momento de integración sujetos a revisión del repo.

Complementa el phase map (`docs/ARCHITECTURE.md`). No sustituye sus contratos ni afirma que se hayan completado sus fases. No existe `docs/ROADMAP.md`: el turno de este diseño es la **fase 7**, después de las fases 5 y 6 y antes de CLI/agentes (fase 8+).

## 1. Decisión que conservamos

Data Pilot será un workspace de datos integrado con VS Code: la navegación vive en la sidebar y el trabajo con datos vive en los editores.

Humanos y agentes comparten capacidades del core; cada uno tiene su interfaz. El diseño visual no cambia la semántica del motor ni obliga a un agente a operar la UI.

DQL permanece como nombre del lenguaje de Data Pilot. En documentación: “Data Pilot Query Language (DQL)”. No se afirma compatibilidad con otros lenguajes que usan esas siglas. Identificador de lenguaje propuesto: `data-pilot-dql`; extensión inicial `.dql`, cuyo selector debe evitar apropiarse de archivos de otros productos. Parser y contratos existentes no se renombran por este diseño.

No se introducen dos dialectos para acomodar la UI. La captura actual usa `where`; el mockup muestra predicados sin ese prefijo. La especificación vigente es `docs/DQL-SPEC.md` §3 y §4.2: el stage es `where` + predicado. El parser (`parseWhere` en `packages/dql`) rechaza un predicado suelto. Las consultas guardadas conservan el texto DQL 0.1 ya validado (`dqlVersion: "0.1"`). No hay migración: no se cambia la sintaxis en silencio como parte del rediseño. Los ejemplos de `docs/PRODUCT.md` que omiten `where` son deriva documental, no un segundo dialecto.

## 2. Qué aprendimos de la captura actual

La vista lateral concentra schema, consulta, botones, resultados, inspector y edición. El editor central muestra CSV como texto. Esta distribución consume ancho para controles y deja la tabla en la zona más estrecha.

La captura permite evaluar distribución y funciones visibles. No permite confirmar calidad del core, cobertura, separación de responsabilidades ni fase terminada. La evaluación de reutilización requiere leer el repo.

El mockup generado representa una dirección, no una especificación literal de las APIs del IDE. Los conteos, datos, tiempos y estados mostrados son ilustrativos.

## 3. Superficies y responsabilidades

| Superficie | Contenido | Comportamiento |
|---|---|---|
| Activity Bar | Icono propio de Data Pilot | Abre su contenedor de navegación |
| Sidebar: Datasets | Datasets registrados/abiertos | Seleccionar abre o enfoca su pestaña; no copia el filesystem entero |
| Sidebar: Saved Queries | Consultas guardadas | Abre consulta y muestra su dataset asociado |
| Sidebar: Jobs | Trabajos activos y estados recientes | Permite cancelar o abrir resultado; no es un log de IPC |
| Editor de dataset | Tabla, filtros, columnas, búsqueda e inspector | Superficie principal; custom editor con webview |
| Editor DQL | Texto, diagnóstico, completions y Run Query | Editor nativo independiente, opcional en split |
| Editor de resultado | Tabla de salida y evidencia de ejecución | Se distingue de la vista del origen |
| Status Bar/progreso | Estado contextual y operación activa | Información breve; los detalles se abren bajo demanda |
| Output | Diagnóstico técnico | Sin volcados de datos o mensajes internos como experiencia principal |

No desplegar formularios completos dentro de la sidebar. No crear un dashboard de bienvenida grande cuando ya existe un dataset abierto.

## 4. Editor de dataset

Estructura de arriba hacia abajo:

1. Cabecera compacta: nombre, formato/tamaño y estado. Conteo exacto solo cuando existe; para preview, indicar muestra o total desconocido.
2. Pestañas internas: Data primero; Profile y Changes aparecen cuando sus capacidades estén implementadas. Compare/Validation solo al llegar a sus fases.
3. Toolbar: filtros visuales, selector de columnas, búsqueda, export y menú de acciones secundarias.
4. Tabla virtualizada que ocupa el espacio principal. Selección de celda/fila, navegación por teclado, columnas ajustables y scroll horizontal.
5. Inspector plegable dentro del custom editor: columna, tipo, valor raw acotado, copiar y editar cuando permitido.
6. Pie: alcance, filas devueltas, completitud/truncamiento y estado de ejecución.

El inspector puede ocupar una franja derecha dentro del editor y colapsarse en ventanas estrechas. No se promete insertar arbitrariamente UI debajo de un editor de texto nativo.

Acciones contextuales:

“Edit value” aparece cuando hay celda seleccionada y edición soportada. “Review changes” muestra el plan antes de guardar. Export actúa sobre un resultado identificado, no sobre una tabla ambigua. Detalles de revisión, path completo y parsing se abren desde información del dataset.

Run es la acción principal de query. La validación sintáctica puede ser automática si es barata y no ejecuta scans. No ejecutar consultas sobre el dataset por cada tecla. “Check query” puede desaparecer como botón prominente sin perder el servicio de validación.

## 5. Editor DQL y resultados

Dos flujos complementarios:

- Exploración visual: abrir dataset → filtrar → inspeccionar → guardar query/exportar.
- Trabajo con consultas: abrir DQL → verificar dataset/parameters → ejecutar → inspeccionar resultado.

No obligar a abrir el editor DQL para usar filtros visuales. Ofrecer “Open query in editor” para pasar de exploración a consulta reutilizable.

Archivo DQL con syntax highlighting, completions según schema asociado, diagnósticos del parser y acción Run Query en toolbar. Comenzar con providers directos si son suficientes; no introducir LSP solo por imitar otros lenguajes.

La asociación a dataset debe ser explícita. No ejecutar sobre “el último dataset activo” sin indicar cuál. Queries guardadas conservan versión de lenguaje, parsing/schema esperado y parámetros según los contratos del core.

Vista del origen vs salida:

`users.csv — Data` representa el dataset. Un resultado puede identificarse como `Active MX users — Results`, con fuente, revisión y query asociadas.

Si `select id, name, balance` se ejecutó, el resultado tiene esas tres columnas. La tabla de origen puede conservar más columnas, pero no presentarse como si fuera ese resultado. Resultados agregados no son filas editables del origen. Editar un resultado filtrado/proyectado solo será posible si mantiene localizadores verificables hacia la revisión de origen.

Una respuesta atrasada no reemplaza un resultado nuevo. Estado de celda/inspector se vincula a dataset, revisión y resultado, no solamente a índice de fila.

## 6. Integración real con VS Code

Custom editor para dataset: modelo propio, apertura acotada y lifecycle. Si ya existe implementación con save/undo/revert, preservarla; el rediseño no justifica volver a una vista de lectura y perder funciones.

Los grupos de editores permiten datos y DQL al lado. El usuario controla su distribución. Ofrecer una acción explícita “Open query beside dataset”, sin reorganizar el escritorio automáticamente al abrir cada archivo.

Inspector dentro de la webview del dataset es la primera opción. Una vista auxiliar movible es alternativa posterior si los usuarios necesitan inspeccionar independientemente. No imponer la sidebar secundaria ni replicar controles nativos mediante hacks del DOM de VS Code.

Tema mediante variables VS Code, foco visible, contraste, labels accesibles, atajos documentados y tipografía consistente. Native-feeling significa comportamiento integrado además de apariencia. Tabla y filtros siguen siendo UI propia dentro de la webview.

Untrusted conserva la política decidida: preview/lectura acotada; operaciones de escritura, export y agentes bloqueadas inicialmente. Cambiar la ubicación de una acción no elimina su validación en host.

## 7. Estado compartido entre superficies

Antes de crear pestañas adicionales, verificar:

- Registro de sesiones/datasets independiente de cada vista.
- Queries/jobs/resultados con IDs y revisión, y correlación de mensajes.
- Diferenciar documento de dataset, estado visual y resultado de query.
- Al cerrar una pestaña, liberar su UI; no cancelar otra vista que usa la misma sesión por accidente.
- Cambios externos invalidan las vistas/resultados relacionados.
- Al restaurar pestañas, recrear recursos por referencia persistente; no confiar en session IDs antiguos.
- Completions/diagnósticos baratos no inician motor analítico o scans globales.

Si estas responsabilidades están mezcladas, refactorizar el ownership antes de sumar nuevas superficies. No duplicar el motor para que cada panel funcione independientemente.

## 8. Cómo incorporarlo al roadmap

### A. Alinear ahora

Conviene si navegación/UI se pueden mover reutilizando servicios existentes, el lifecycle del dataset está definido y el cambio no interrumpe un gate crítico pendiente.

Primer corte: contenedor propio + árboles ligeros + dataset en editor central + inspector dentro del editor. Preservar las capacidades implementadas, corregir el espacio de trabajo y validar el flujo principal. No incluir lenguaje nativo completo, analítica ni nuevas operaciones en el mismo corte.

### B. Alinear parcialmente ahora

Conviene si mover todo expone acoplamiento importante. Registrar el diseño objetivo, separar ownership UI/sesión y entregar una sola ruta dataset→editor. Mantener temporalmente el flujo existente hasta que el reemplazo tenga paridad; retirar duplicaciones al terminar la transición.

### C. Programarlo para su fase

Conviene si hay defectos de corrección, pérdida de datos, budgets o lifecycle que invalidan el incremento. Corregir esos bloqueos y ubicar este trabajo en fase 3/integración UX antes del cierre v0.1. El editor DQL nativo puede ser un subincremento posterior, sin bloquear el workspace visual.

No agregar este diseño al final como decoración. Define el destino de la interfaz y debe guiar decisiones desde ahora, aunque la implementación espere. Las fechas y esfuerzo se estiman tras revisar el repo; no se deducen de una captura.

## 9. Criterios de aceptación del primer corte UX

- Data Pilot tiene acceso propio y navegación ligera; Explorer conserva acción contextual.
- Dataset se abre en editor central sin cargarlo completo ni perder precisión.
- Tabla domina el espacio y sigue usable en ventanas estrechas.
- Inspector contextual se vincula a la selección correcta y puede colapsarse.
- Consultar/exportar/editar conserva budgets, trust, revisión y garantías existentes.
- Abrir dos datasets o ejecutar dos consultas no mezcla estados ni respuestas.
- No aparecen stats completas cuando solo existe una muestra o scan parcial.
- Tema claro/oscuro y recorrido por teclado verificados.
- Pruebas relevantes del core siguen pasando; pruebas de integración comprueban lifecycle y paridad, no screenshots pixel-perfect.
- VSIX se empaqueta y el flujo abrir→filtrar→inspeccionar→guardar query→exportar se verifica en host real disponible.

## 10. Fuentes de viabilidad

Consultadas el 7 de octubre de 2026; la propuesta de UX es específica de Data Pilot.

- Tree View API: árboles y contenedores propios.
- Custom Editor API: modelo/lifecycle y vistas de datasets.
- Sidebars: superficies y reorganización de vistas.
- Extension Capabilities: características de lenguaje y contribuciones al IDE.
- Webview API: contenido propio y comunicación con host.

La primera evaluación de Cursor decide cuándo migrar; este documento conserva hacia dónde vamos.

## 11. Decisión de alineación (revisión del repo, 2026-10-07)

**Recomendación: B, con turno en la fase 7.** El diseño queda registrado. No se implementa dentro de las fases 5 ni 6.

- El camino verificado de v0.1 sigue siendo texto + panel Explorer (`dataPilot.explorer`). El custom editor (`dataPilot.dataset`, prioridad `option`) es opcional y queda fuera de ese cierre.
- `DatasetStore` guarda varias sesiones por `datasetId`. Las specs 1, 2 y 3 de la fase 7 están verificadas: ownership, Activity Bar con tabla central e inspector, y el editor DQL nativo.
- No hay `CustomDocument` con save/undo/revert. La fase 7 conserva Preview diff + Apply save (escritura solo en el host), budgets, trust y DQL `where`.
- El editor DQL nativo (`.dql`, `data-pilot-dql`) es la spec 3 de la fase 7 y está verificada. El enlace al dataset es explícito.
- Las fases 0–6 no abren este layout. Conservan el stage `where`, el panel Explorer como superficie v0.1, la edición en el host y un solo proceso hijo, para que la fase 7 los reubique.

Ningún ADR contradice el destino visual. ADR 0004 sigue exigiendo la misma validación de trust aunque el botón cambie de sitio. ADR 0001 admite un solo proceso hijo; no hace falta un segundo motor.
