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
