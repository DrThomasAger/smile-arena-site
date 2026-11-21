// Live team diagram: nodes and permitted edges of a format as SVG; messages animate as dots along the
// edge they travel. Node state (auto / manual / paused / stopped) and selection are shown on the node.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.append(e); return e; };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountDiagram(container, format, { onSelect = () => {}, dur = 1100 } = {}) {
  container.replaceChildren();
  const svg = el('svg', { viewBox: '0 0 640 400', class: 'sw-svg', role: 'group', 'aria-label': `${format.title}: ${format.nodes.length} nodes, ${format.edges.length} permitted edges` }, container);
  const gEdges = el('g', { class: 'sw-edges' }, svg);
  const gDots = el('g', { class: 'sw-dots' }, svg);
  const gNodes = el('g', { class: 'sw-nodes' }, svg);
  const pos = Object.fromEntries(format.nodes.map(n => [n.id, n]));
  const r = format.nodes.length <= 12 ? 13 : format.nodes.length <= 26 ? 10 : 8;

  // One line per pair, so a two-way edge is drawn once.
  const pairs = new Map();
  for (const e of format.edges) { const k = [e.from, e.to].sort().join('|'); if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(e); }
  const lines = new Map();
  for (const [k, es] of pairs) {
    const a = pos[es[0].from], b = pos[es[0].to];
    const line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'sw-edge kind-' + es[0].kind, 'data-pair': k, 'data-edges': es.map(e => e.from + '>' + e.to).join(' ') }, gEdges);
    lines.set(k, line);
  }

  const nodeEls = new Map();
  for (const n of format.nodes) {
    const big = format.entry.includes(n.id);
    const g = el('g', { class: 'sw-node', 'data-node': n.id, 'data-role': n.role, 'data-state': 'auto', tabindex: '0', role: 'button', 'aria-label': `${n.name} (${n.roleName}, tier ${n.tier})`, transform: `translate(${n.x} ${n.y})` }, gNodes);
    el('title', {}, g).textContent = `${n.name} · ${n.roleName} · tier ${n.tier} ${n.tierName}`;
    el('circle', { class: 'sw-halo', r: (big ? r + 3 : r) + 5 }, g);
    el('circle', { class: 'sw-body', r: big ? r + 3 : r, style: `fill: var(--c${n.color % 7})` }, g);
    const t = el('text', { class: 'sw-label', y: '0.35em', 'text-anchor': 'middle', 'font-size': big ? r : r - 1 }, g);
    t.textContent = n.short;
    if (format.nodes.length <= 26 || big) { const name = el('text', { class: 'sw-name', y: (big ? r + 3 : r) + 11, 'text-anchor': 'middle', 'font-size': 9 }, g); name.textContent = n.name; }
    const pick = () => onSelect(n.id);
    g.addEventListener('click', pick);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    nodeEls.set(n.id, g);
  }

  let selected = null;
  const api = {
    format, svg,
    animate(msg) {
      const a = pos[msg.from], b = pos[msg.to];
      if (!a || !b) return null;
      const k = [msg.from, msg.to].sort().join('|');
      const line = lines.get(k);
      if (line) { line.classList.add('hot'); setTimeout(() => line.classList.remove('hot'), dur); }
      const dot = el('circle', { r: 4.5, class: 'sw-dot kind-' + msg.kind, 'data-from': msg.from, 'data-to': msg.to, 'data-kind': msg.kind, 'data-id': msg.id }, gDots);
      if (reduced()) { dot.setAttribute('cx', b.x); dot.setAttribute('cy', b.y); }
      else {
        const m = el('animateMotion', { dur: dur + 'ms', path: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, fill: 'freeze', calcMode: 'spline', keySplines: '.4 0 .6 1', keyTimes: '0;1' }, dot);
        if (m.beginElement) try { m.beginElement(); } catch { /* starts on its own */ }
      }
      setTimeout(() => dot.remove(), dur + 150);
      return dot;
    },
    setState(id, state) { const g = nodeEls.get(id); if (g) g.setAttribute('data-state', state); },
    select(id) {
      if (selected) nodeEls.get(selected)?.classList.remove('sel');
      selected = id; if (id) nodeEls.get(id)?.classList.add('sel');
    },
    destroy() { container.replaceChildren(); },
  };
  return api;
}
