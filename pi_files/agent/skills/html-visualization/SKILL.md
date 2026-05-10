---
name: html-visualization
description: Generate HTML visualizations for diagrams, flows, system architectures, and data in a browser. Use when the user asks to visualize a flow, diagram, architecture, component tree, data, or any concept better shown graphically than as ASCII art.
---

# HTML Visualization

Generate HTML files that render rich, interactive diagrams and visualizations in the browser. HTML is vastly superior to ASCII art for visualizing flows, systems, and architectures.

## Important: Wait for User Content

After this skill is loaded, do **not** generate any page content on your own. Wait for the user to specify what the page should contain — what data, text, structure, or visualization they want. Only generate the HTML once the user has provided the content.

## Output Location

Write HTML files to `/tmp/pi-visualizations/<descriptive-name>.html`. Create the directory if it doesn’t exist.

```bash
mkdir -p /tmp/pi-visualizations
```

## Validating Mermaid Syntax

If the generated HTML contains Mermaid diagrams, validate them before opening the browser.

### Setup (once)

Install dependencies in the skill directory:

```bash
npm install --prefix ~/.pi/agent/skills/html-visualization jsdom mermaid
```

Save the validation script as `~/.pi/agent/skills/html-visualization/validate-mermaid.mjs` (see below for full script).

### Usage

After writing the HTML, validate it:

```bash
node ~/.pi/agent/skills/html-visualization/validate-mermaid.mjs /tmp/pi-visualizations/<name>.html
```

Fix any reported errors, re-validate, and only then open the browser.

### How it works

- For **flowchart, sequence, class, state, ER, pie, C4** diagrams: uses `mermaid.parse()` for strict syntax checking.
- **⚠️ Gantt charts are not supported** — Mermaid Gantt has too many browser-specific quirks and is banned. Use HTML tables or D3 timelines instead.

### Validation script

Save the following as `~/.pi/agent/skills/html-visualization/validate-mermaid.mjs`:

```javascript
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
for (const k of ['window', 'document', 'Element', 'Node', 'NodeFilter', 'DOMParser']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true });
}

const mermaid = await import('mermaid');
mermaid.default.initialize({ startOnLoad: false, securityLevel: 'loose' });

const html = readFileSync(process.argv[2], 'utf-8');
const re = /<pre class="mermaid">\s*\n?([\s\S]*?)<\/pre>/g;
let match, idx = 0, errors = 0;

while ((match = re.exec(html)) !== null) {
  idx++;
  const code = match[1].trim();
  const firstLine = code.split('\n')[0].trim();

  // Gantt charts are not supported — skip
  if (firstLine.toLowerCase().startsWith('gantt')) {
    console.log(`Block ${idx} (gantt): SKIPPED — Gantt charts are not supported`);
    continue;
  }

  // Standard mermaid.parse() for all other diagram types
  try {
    await mermaid.default.parse(code);
    console.log(`Block ${idx} (${firstLine.split(/\s/)[0]}): OK`);
  } catch (e) {
    errors++;
    console.log(`Block ${idx}: FAILED`);
    console.log(`  ${e.message}`);
  }
}

if (errors > 0) {
  console.log(`\n${errors} mermaid error(s). Fix them before opening the browser.`);
  process.exit(1);
}
console.log('All mermaid blocks passed validation.');
```

## Opening in Browser

After validating (if applicable), open the file with the OS default browser:

```bash
# macOS
open /tmp/pi-visualizations/<name>.html

# Linux
xdg-open /tmp/pi-visualizations/<name>.html
```

## Recommended Libraries (CDN)

### Mermaid.js (diagrams, flowcharts, sequence diagrams)

```html
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'base', themeVariables: { darkMode: true } });
</script>
```

Use for: flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, pie charts, architecture diagrams, C4 diagrams. (Gantt charts are **not supported** — use HTML tables instead.)

> **Note:** The template already includes a full Rosé Pine Moon Mermaid configuration. Copy the template — don't write this from scratch.

### D3.js (custom data visualizations)

```html
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
```

Use for: custom force-directed graphs, hierarchical trees, network topologies, data flow diagrams.

### No library — Pure SVG/Canvas

For simple diagrams, inline SVG or HTML5 Canvas is often sufficient and keeps the file self-contained.

## Template

**Always start from the template file** at `~/.pi/agent/skills/html-visualization/template.html` instead of writing HTML from scratch. The template provides:

- **Rosé Pine Moon color theme** with CSS custom properties (e.g., `var(--rp-base)`, `var(--rp-surface)`, `var(--rp-iris)`, etc.)
- **Iris header bar** for the title and description
- **Surface content cards** for organizing sections
- **Mermaid.js** pre-configured with matching Rosé Pine Moon theme variables
- Responsive styling and a clean layout

To use it: copy the template, update the `<title>` and header text, then replace `<!-- CONTENT -->` with your visualization content.

### Copy the template

```bash
cp ~/.pi/agent/skills/html-visualization/template.html /tmp/pi-visualizations/<name>.html
```

### Rosé Pine Moon color reference

| Role | Variable | Hex | Use |
|------|----------|-----|-----|
| Base | `--rp-base` | `#232136` | Page background |
| Surface | `--rp-surface` | `#2a273f` | Content cards |
| Overlay | `--rp-overlay` | `#393552` | Borders, separators |
| Muted | `--rp-muted` | `#6e6a86` | Secondary text |
| Subtle | `--rp-subtle` | `#908caa` | Descriptions, captions |
| Text | `--rp-text` | `#e0def4` | Primary text |
| Love | `--rp-love` | `#eb6f92` | Errors, destructive |
| Gold | `--rp-gold` | `#f6c177` | Warnings, highlights |
| Rose | `--rp-rose` | `#ea9a97` | Accent |
| Pine | `--rp-pine` | `#3e8fb0` | Links, info |
| Foam | `--rp-foam` | `#9ccfd8` | Success, secondary accent |
| Iris | `--rp-iris` | `#c4a7e7` | Header, primary accent |
| Highlight Low | `--rp-highlight-low` | `#2a283e` | Subtle hover |
| Highlight Med | `--rp-highlight-med` | `#44415a` | Medium hover |
| Highlight High | `--rp-highlight-high` | `#56526e` | Strong hover |

## Design Guidelines

1. **Always start from the template** — copy `~/.pi/agent/skills/html-visualization/template.html` and replace `<!-- CONTENT -->` with your content
2. **Do not use Mermaid unless the user explicitly asks for a diagram** — default to pure HTML/CSS layouts unless diagrams are requested
3. **Prefer `flowchart TD` over `flowchart LR`** — top-down flowcharts give each node more width so text stays readable. LR is fine for ≤3 nodes; anything wider should be TD.
4. **Use the Rosé Pine Moon theme** — stick to the CSS variables defined in the template (`--rp-*`); do not introduce new colors
5. **Make it self-contained** — everything in one file, CDN scripts from fast providers
6. **Add content inside `.card` containers** — use `<section class="card">` for each logical section of content
7. **Include a legend** when the diagram uses color or shape semantics (use the `.legend` / `.legend-item` structure from the template)
8. **Use `/tmp/pi-visualizations/`** for all output files

## Example: Using the Template

1. Copy the template:

```bash
cp ~/.pi/agent/skills/html-visualization/template.html /tmp/pi-visualizations/architecture.html
```

2. Edit the file — update the `<title>`, header `<h1>` and `<p>`, then replace `<!-- CONTENT -->` with your sections. For example:

```html
<!-- CONTENT -->
<section class="card">
  <h2>System Architecture</h2>
  <p>High-level architecture showing component relationships.</p>
  <pre class="mermaid">
    graph TD
      A[Client] --> B[API Gateway]
      B --> C[Auth Service]
      B --> D[Business Logic]
      D --> E[(Database)]
      D --> F[Cache]
  </pre>
</section>

<section class="card">
  <h2>Data Flow</h2>
  <p>How data moves through the pipeline.</p>
  <svg id="viz"></svg>
  <script>
    // D3 visualization code here
  </script>
</section>
```

3. Validate (if Mermaid is used) and open:

```bash
node ~/.pi/agent/skills/html-visualization/validate-mermaid.mjs /tmp/pi-visualizations/architecture.html
# macOS
open /tmp/pi-visualizations/architecture.html
```
