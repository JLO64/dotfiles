---
name: html-visualization
description: Generate HTML visualizations for diagrams, flows, system architectures, and data in a browser. Use when the user asks to visualize a flow, diagram, architecture, component tree, data, or any concept better shown graphically than as ASCII art.
---

# HTML Visualization

Generate rich, static HTML visualizations in the browser. HTML, CSS, and inline SVG are vastly superior to ASCII art for visualizing flows, systems, and architectures.

## Important: Wait for User Content

After this skill is loaded, do **not** generate any page content on your own. Wait for the user to specify what the page should contain — what data, text, structure, or visualization they want. Only generate the HTML once the user has provided the content.

## Output Location

Write HTML files to `/tmp/pi-visualizations/<descriptive-name>.html`. Create the directory if it doesn’t exist.

```bash
mkdir -p /tmp/pi-visualizations
```

## Diagram Authoring Model

Create complete, directly openable HTML documents. Use native HTML and CSS for layout, zones, cards, labels, tables, and data presentation. Use inline SVG only when CSS cannot faithfully express a required connector, arrowhead, sequence marker, or other diagram geometry.

Keep CSS and SVG inline. Do not use Mermaid, D3, or another diagram-rendering library. Diagrams must remain static: do not add animation.

### Visual Language

Use the template’s Rosé Pine Moon canvas and follow this flat, scannable diagram style:

- Use crisp sans-serif type, rounded zones and cards, and no gradients, shadows, or decorative effects.
- Represent systems and artifacts as real components, not numbered process steps. Give each component a clear colored header and one concise, specific body label when needed.
- Use meaningful service or product colors for component borders, headers, and accents. Use restrained template colors for unbranded internal components.
- Prefer labels over prose. Omit captions, notes, legends, status copy, and repeated role descriptions unless the user explicitly requests them.
- Do not encode meaning through color alone: pair colors with component names, text labels, or logos.
- When using remote logos, provide concise `alt` text and an emoji fallback that appears if the logo cannot load. Do not leave broken-image placeholders.
- Make layouts responsive from mobile through large desktop widths. Allow horizontal scrolling for a dense connected map rather than shrinking it until it is illegible.

### Flow-Diagram Composition

For operational workflows, use a branching node-and-connector map:

- Put the functional component name in each colored node header and one bold line in its body for its role, identifier, or artifact. Do not add secondary explanatory text inside nodes.
- When a card needs extra height, reserve its header height with a grid layout such as `grid-template-rows: 48px 1fr`; do not stretch the header with the body.
- Place sequence numbers in small circles on directional arrows, never in node headers. Omit arrow labels unless the relationship would otherwise be ambiguous.
- Model the actual topology. Arrows may branch, converge, cross a route, or return to an earlier layer; do not force a linear chain.
- Use solid, numbered arrows for the primary runtime sequence. Use restrained dashed arrows for supporting inputs such as source repositories, data APIs, or optional assets; do not number supporting dependencies by default.
- Keep inline SVG connectors behind nodes and preserve their arrowheads and number circles at every viewport. Keep supporting nodes near their consumer so connectors stay short.
- Keep a diagram scoped to one lifecycle. Split unrelated later stages into separate diagrams.

## Opening in Browser

After writing the HTML, open the file with the OS default browser:

```bash
# macOS
open /tmp/pi-visualizations/<name>.html

# Linux
xdg-open /tmp/pi-visualizations/<name>.html
```

## Template

**Always start from the template file** at `~/.pi/agent/skills/html-visualization/template.html` instead of writing HTML from scratch. The template provides:

- Rosé Pine Moon color theme with CSS custom properties (for example, `var(--rp-base)`, `var(--rp-surface)`, and `var(--rp-iris)`)
- Iris header bar for the title and description
- Surface content cards for organizing sections
- Native HTML/CSS styles for diagram canvases, zones, component nodes, service cards, connectors, and sequence markers
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

1. **Always start from the template** — copy `~/.pi/agent/skills/html-visualization/template.html` and replace `<!-- CONTENT -->` with your content.
2. **Use native diagram primitives** — compose diagrams with HTML/CSS zones and nodes; use inline SVG only for connectors that CSS cannot express.
3. **Use the Rosé Pine Moon theme** — stick to the CSS variables defined in the template (`--rp-*`); do not introduce arbitrary theme colors. Meaningful service accents are the exception when a diagram represents a known branded service.
4. **Make it self-contained** — put all markup, CSS, and SVG in one file. Remote logos are permitted when they are stable and include an accessible fallback.
5. **Add content inside `.card` containers** — use `<section class="card">` for each logical section of content.
6. **Use `.diagram-canvas`, `.diagram-zone`, and `.diagram-node`** for architecture and flow diagrams. Apply `--brand` or `--service` inline to set a component’s meaningful accent color.
7. **Include a legend** only when the user requests one or when color, shape, or line style has meaning that cannot be conveyed by the diagram’s labels.
8. **Use `/tmp/pi-visualizations/`** for all output files.

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
  <div class="diagram-canvas">
    <section class="diagram-zone" style="--brand: var(--rp-pine)">
      <header class="diagram-zone-header">Application</header>
      <div class="diagram-zone-body diagram-grid">
        <article class="diagram-node" style="--service: var(--rp-foam)">
          <h3 class="diagram-node-header">API</h3>
          <p class="diagram-node-body">Request router</p>
        </article>
        <article class="diagram-node" style="--service: var(--rp-iris)">
          <h3 class="diagram-node-header">Database</h3>
          <p class="diagram-node-body">Primary records</p>
        </article>
      </div>
    </section>
  </div>
</section>
```

3. Open the result:

```bash
# macOS
open /tmp/pi-visualizations/architecture.html
```
