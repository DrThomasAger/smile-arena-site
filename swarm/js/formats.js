// Format specs for the swarm UI, built from the format library in swarm/formats (copied into
// site/swarm/data/formats by scripts/build-swarm.mjs). Who may talk to whom comes from each format's
// `wiring`, expanded by the same wiring.js the core uses. This file adds what the page needs:
// a capped node list (so 1000 fighters do not become 1000 dots), one message kind per directed edge,
// a layout in a 640x400 box, and the entry node(s) the human strategist talks to.
import { expandEdges } from './wiring.js';

export const KINDS = { order: 'Order', report: 'Report', peer: 'Peer note', terms: 'Terms', ack: 'Ack', prompt: 'Prompt' };
const DEFAULT_CAP = 12;

// Page-only hints per format: layout, caps, sides. Edges never come from here.
const HINTS = {
  orbit: { layout: 'star' }, web: { layout: 'star' }, chain: { layout: 'tree' }, roundtable: { layout: 'ring' }, assembly: { layout: 'row' },
  field: { layout: 'star', center: 'The Field (shared store)' }, market: { layout: 'star' },
  court: { layout: 'tree', layers: [['Judge'], ['Advocate for', 'Advocate against', 'Clerk'], ['Witness']] },
  subak: { layout: 'tree' }, banjar: { layout: 'tree', layers: [['Kelian', 'Kulkul drum'], ['Household representative'], ['Worker']] },
  sangha: { layout: 'star' }, indra: { layout: 'star' }, quaker: { layout: 'star' }, haudenosaunee: { layout: 'star' }, beehive: { layout: 'star' }, ants: { layout: 'star' },
  mycelium: { layout: 'tree' }, hebbian: { layout: 'tree', layers: [['Body', 'Synapse ledger'], ['Organ (role)'], ['Cell (prompt module)']] },
  orchestra: { layout: 'tree', layers: [['Conductor', 'Score'], ['Section principal'], ['Player']] }, tulku: { layout: 'ring' },
  mcts: { layout: 'tree', layers: [['Root'], ['Selector', 'Evaluator'], ['Expander'], ['Rollout']] },
  clanwar: { layout: 'sides', caps: { Fighter: 20, 'Squad lead': 10 } },
};
const RANK = { leader: 3, control: 2, body: 1 };

export const slug = s => String(s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const short = name => { const w = name.replace(/\(.*?\)/g, '').trim().split(/\s+/); return w.length > 1 ? w.map(x => x[0]).join('').toUpperCase().slice(0, 3) : name.slice(0, 2).toUpperCase(); };

// The core's edges carry a list of kinds; the page animates one kind per direction.
export function kindFor(e, from, to) {
  const K = e.kinds || [];
  const hasO = K.includes('order'), hasR = K.includes('report');
  if ((from.roleName === 'Herald' || to.roleName === 'Herald') && !hasO && !hasR) return 'terms';
  if (hasO && !hasR) return 'order';
  if (hasR && !hasO) return 'report';
  if (hasO && hasR) {
    if (from.role === to.role) return 'peer';
    const a = RANK[from.seat] || 2, b = RANK[to.seat] || 2;
    return a > b ? 'order' : a < b ? 'report' : 'peer';
  }
  return 'peer';
}

export function buildFormat(spec) {
  const hint = HINTS[spec.id] || { layout: 'tree' };
  // Sides (clan war: two sanghas) are the format's own: `sides: { count, shared }`; the core's wiring keeps every side apart.
  const sides = spec.sides?.count >= 2 ? spec.sides.count : 1;
  const sharedRoles = spec.sides?.shared || [];
  const roles = spec.roles.map((r, i) => ({
    id: r.key || slug(r.name), name: r.name, short: short(r.name), count: r.count, tier: r.tier, tierName: r.tierName, sliders: r.sliders, seat: r.seat,
    color: i, shared: sharedRoles.includes(r.name), prompt: r.prompt || spec.prompt || '', tag: r.tag, sections: r.sections,
  }));
  const nodes = [];
  for (const r of roles) {
    const cap = (hint.caps && hint.caps[r.name]) || DEFAULT_CAP;
    const shown = Math.min(r.count, cap);
    r.shown = shown; r.each = Math.max(1, Math.round(r.count / shown));
    for (let i = 0; i < shown; i++) {
      const side = r.shared || sides === 1 ? null : i % sides;
      nodes.push({ id: `${r.id}-${i + 1}`, role: r.id, roleName: r.name, seat: r.seat, name: (side == null ? '' : 'AB'[side] + ' ') + r.name.replace(/\(.*?\)/g, '').trim() + (shown > 1 ? ' ' + (Math.floor(i / sides) + 1) : ''),
        tier: r.tier, tierName: r.tierName, side, idx: Math.floor(i / sides), short: r.short, color: r.color });
    }
  }
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  // Same ids, role names and sides as the core's nodes, so the core's wiring expands the same way (and never across sides).
  const raw = expandEdges(nodes.map(n => ({ id: n.id, role: n.roleName, index: n.idx + 1, side: n.side })), spec.wiring);
  const edges = [];
  for (const e of raw) {
    const a = byId[e.from], b = byId[e.to];
    if (a.side != null && b.side != null && a.side !== b.side) throw new Error(`${spec.id}: edge ${e.from} > ${e.to} crosses sides`);
    edges.push({ from: e.from, to: e.to, kind: kindFor(e, a, b), kinds: e.kinds });
  }
  const f = { id: spec.id, title: spec.title, family: spec.family, summary: spec.summary, communication: spec.communication, svg: `swarm/svg/${spec.id}.svg`, sides, roles, nodes, edges,
    leader: spec.leader, layout: hint.layout, layers: hint.layers, center: hint.center, smileMetrics: spec.smileMetrics, wiring: spec.wiring, spec };
  f.entry = entryNodes(f);
  f.note = roles.filter(r => r.shown < r.count).map(r => `${r.shown} of ${r.count} ${r.name}s shown (each dot ≈ ${r.each})`).join('; ');
  layout(f);
  validateFormat(f);
  return f;
}

// The node(s) the human strategist talks to: the leader role on side A.
function entryNodes(f) {
  const lead = f.roles.find(r => r.name === f.leader) || f.roles[0];
  const first = f.nodes.filter(n => n.role === lead.id && (n.side == null || n.side === 0));
  return (first.length ? first : f.nodes.slice(0, 1)).map(n => n.id);
}

export function validateFormat(f) {
  const ids = new Set(f.nodes.map(n => n.id));
  const errors = [];
  if (!f.nodes.length) errors.push('no nodes');
  for (const e of f.edges) { if (!ids.has(e.from) || !ids.has(e.to)) errors.push(`edge ${e.from}>${e.to} points at a missing node`); if (!KINDS[e.kind]) errors.push(`edge kind ${e.kind}`); }
  const touched = new Set(f.edges.flatMap(e => [e.from, e.to]));
  for (const n of f.nodes) if (!touched.has(n.id)) errors.push(`node ${n.id} has no edge`);
  for (const id of f.entry) if (!ids.has(id)) errors.push(`entry ${id} missing`);
  for (const n of f.nodes) if (!(n.x >= 0 && n.y >= 0)) errors.push(`node ${n.id} has no position`);
  if (errors.length) throw new Error(`${f.id}: ` + errors.join('; '));
  return true;
}

// ---- layout in a 640x400 box ----
const W = 640, H = 400;
function layout(f) {
  const kind = f.layout;
  if (kind === 'sides') { sidesLayout(f); return; }
  if (kind === 'star') { starLayout(f); return; }
  if (kind === 'ring') { ringLayout(f.nodes, 320, 200, 230, 150); return; }
  if (kind === 'row') { rowLayout(f); return; }
  treeLayout(f.nodes, layersFor(f), 30, W - 30, 50, H - 50);
}
function layersFor(f, nodes = f.nodes) {
  const names = f.layers || f.roles.map(r => [r.name]);
  return names.map(group => nodes.filter(n => group.includes(n.roleName))).filter(l => l.length);
}
function treeLayout(nodes, layers, x0, x1, y0, y1) {
  layers.forEach((layer, i) => {
    const y = layers.length === 1 ? (y0 + y1) / 2 : y0 + i * (y1 - y0) / (layers.length - 1);
    const span = Math.min(x1 - x0, layer.length * 70);
    const start = (x0 + x1) / 2 - span / 2;
    layer.forEach((n, j) => { n.x = Math.round(start + (j + 0.5) * span / layer.length); n.y = Math.round(y); });
  });
}
function ringLayout(nodes, cx, cy, rx, ry, start = -Math.PI / 2) {
  nodes.forEach((n, i) => { const a = start + i * 2 * Math.PI / nodes.length; n.x = Math.round(cx + rx * Math.cos(a)); n.y = Math.round(cy + ry * Math.sin(a)); });
}
function starLayout(f) {
  const centerName = f.center || f.leader || f.roles[0].name;
  const rings = [f.nodes.filter(n => n.roleName === centerName)].concat(f.roles.filter(r => r.name !== centerName).map(r => f.nodes.filter(n => n.roleName === r.name)));
  const c = rings[0];
  if (c.length === 1) { c[0].x = 320; c[0].y = 200; } else ringLayout(c, 320, 200, 34, 28);
  const rest = rings.slice(1);
  rest.forEach((ring, i) => {
    const t = rest.length === 1 ? 1 : i / (rest.length - 1);
    const r = rest.length === 1 ? 150 : 90 + t * 95;
    ringLayout(ring, 320, 200, Math.round(r * 1.45), Math.round(r * 0.92), -Math.PI / 2 + i * 0.35);
  });
}
function rowLayout(f) {
  const leadName = f.leader || f.roles[0].name;
  const lead = f.nodes.filter(n => n.roleName === leadName);
  const rest = f.nodes.filter(n => !lead.includes(n));
  lead.forEach((n, i) => { n.x = Math.round(320 + (i - (lead.length - 1) / 2) * 70); n.y = 90; });
  rest.forEach((n, i) => { n.x = Math.round(60 + (i + 0.5) * 520 / rest.length); n.y = 260; });
}
function sidesLayout(f) {
  const shared = f.nodes.filter(n => n.side == null);
  shared.forEach((n, i) => { n.x = Math.round(320 + (i - (shared.length - 1) / 2) * 60); n.y = 40; });
  for (let s = 0; s < f.sides; s++) {
    const side = f.nodes.filter(n => n.side === s);
    const cols = f.roles.filter(r => !r.shared).map(r => side.filter(n => n.roleName === r.name)).filter(c => c.length);
    cols.forEach((col, i) => {
      const t = cols.length === 1 ? 0.5 : i / (cols.length - 1);
      const x = s === 0 ? 40 + t * 230 : 600 - t * 230;
      const span = Math.min(300, col.length * 28);
      col.forEach((n, j) => { n.x = Math.round(x); n.y = Math.round(220 - span / 2 + (j + 0.5) * span / col.length); });
    });
  }
}

// ---- loading (browser: fetched from site/swarm/data/formats) ----
const BASE = 'swarm/data/formats/';
const cache = new Map();
async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
export async function listFormats() {
  if (!cache.has('index')) cache.set('index', getJSON(BASE + 'index.json').then(async ix => Promise.all(ix.formats.map(async id => { const f = await loadSpec(id); return { id, title: f.title, family: f.family }; }))));
  return cache.get('index');
}
export async function loadSpec(id) {
  if (!cache.has(id)) cache.set(id, getJSON(`${BASE}${id}.json`));
  return cache.get(id);
}
export async function loadFormat(id) {
  return buildFormat(await loadSpec(id));
}
export { HINTS };
