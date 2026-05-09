---
name: html-visualization
description: Generate HTML visualizations for diagrams, flows, system architectures, and data in a browser. Use when the user asks to visualize a flow, diagram, architecture, component tree, data, or any concept better shown graphically than as ASCII art.
---

# HTML Visualization

Generate HTML files that render rich, interactive diagrams and visualizations in the browser. HTML is vastly superior to ASCII art for visualizing flows, systems, and architectures.

## Output Location

Write HTML files to `/tmp/pi-visualizations/<descriptive-name>.html`. Create the directory if it doesn’t exist.

```bash
mkdir -p /tmp/pi-visualizations
```

## Opening in Browser

After writing the file, open it with the OS default browser:

```bash
# macOS
open /tmp/pi-visualizations/<name>.html

# Linux
xdg-open /tmp/pi-visualizations/<name>.html
```

## Recommended Libraries (CDN)

### Mermaid.js (diagrams, flowcharts, sequence diagrams, Gantt)

```html
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>
```

Use for: flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, pie charts, architecture diagrams, C4 diagrams.

### D3.js (custom data visualizations)

```html
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
```

Use for: custom force-directed graphs, hierarchical trees, network topologies, data flow diagrams.

### No library — Pure SVG/Canvas

For simple diagrams, inline SVG or HTML5 Canvas is often sufficient and keeps the file self-contained.

## Design Guidelines

1. **Use Mermaid for structured diagrams** — it handles layout, arrows, and styling automatically
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
