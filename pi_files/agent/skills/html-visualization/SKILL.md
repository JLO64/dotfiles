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
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>
```

Use for: flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, pie charts, architecture diagrams, C4 diagrams. (Gantt charts are **not supported** — use HTML tables instead.)

### D3.js (custom data visualizations)

```html
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
```

Use for: custom force-directed graphs, hierarchical trees, network topologies, data flow diagrams.

### No library — Pure SVG/Canvas

For simple diagrams, inline SVG or HTML5 Canvas is often sufficient and keeps the file self-contained.

## Design Guidelines

1. **Do not use Mermaid unless the user explicitly asks for a diagram** — default to pure HTML/CSS layouts unless diagrams are requested
2. **Include a title and brief description** at the top of the page
3. **Use a clean, readable color scheme** — prefer neutral backgrounds, distinct node colors
4. **Make it self-contained** — everything in one file, CDN scripts from fast providers
5. **Add basic responsive styling** — `max-width` on containers, `viewport` meta tag
6. **Include a legend** when the diagram uses color or shape semantics
7. **Use `/tmp/pi-visualizations/`** for all output files

## Example: System Architecture Diagram

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>System Architecture</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'default' });
  </script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #333; }
    .mermaid { margin: 2rem 0; }
  </style>
</head>
<body>
  <h1>System Architecture</h1>
  <p>High-level architecture of the system showing component relationships.</p>
  <pre class="mermaid">
    graph TD
      A[Client] --> B[API Gateway]
      B --> C[Auth Service]
      B --> D[Business Logic]
      D --> E[(Database)]
      D --> F[Cache]
  </pre>
</body>
</html>
```

## Example: Data Flow Diagram (D3)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Flow</title>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    svg { width: 100%; height: 500px; border: 1px solid #eee; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Data Flow Diagram</h1>
  <svg id="viz"></svg>
  <script>
    // D3 visualization code here
  </script>
</body>
</html>
```
