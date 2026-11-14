// Built by scripts/build-swarm.mjs from swarm/formats/wiring.mjs. Do not edit here.
// Turns a format's wiring descriptors plus a concrete node list into explicit edges.
// An edge is { from, to, kinds } where from/to are node ids. Edges are directed.
// Node: { id, role, index, side? } (index is 1-based within the role).
// Sides: a format with `sides` (clan war: two sanghas) gives every node of a non-shared role a
// side number; shared roles (the Herald) have side null. Wiring is then expanded once per side over
// that side's nodes plus the shared ones, so a tree, ring or mesh never crosses sides. Only a wiring
// entry marked `across: true` is expanded over everyone.
const DOWN = ['order', 'note'];
const UP = ['report', 'note'];
const ALL = ['order', 'report', 'note'];

export function expandEdges(nodes, wiring) {
  const sides = [...new Set(nodes.map(n => n.side).filter(s => s !== null && s !== undefined))].sort();
  const edges = new Map();
  if (!sides.length) { expandInto(edges, nodes, wiring); return [...edges.values()]; }
  const shared = nodes.filter(n => n.side === null || n.side === undefined);
  for (const s of sides) expandInto(edges, [...nodes.filter(n => n.side === s), ...shared], wiring.filter(w => !w.across));
  const across = wiring.filter(w => w.across);
  if (across.length) expandInto(edges, nodes, across);
  return [...edges.values()];
}

function expandInto(edges, nodes, wiring) {
  const byRole = {};
  for (const n of nodes) (byRole[n.role] ||= []).push(n);
  const add = (from, to, kinds) => {
    if (from === to) return;
    const key = `${from}>${to}`;
    const e = edges.get(key) || { from, to, kinds: [] };
    for (const k of kinds) if (!e.kinds.includes(k)) e.kinds.push(k);
    edges.set(key, e);
  };
  const both = (a, b, kinds) => { add(a, b, kinds); add(b, a, kinds); };
  const list = r => byRole[r] || [];

  for (const w of wiring) {
    switch (w.type) {
      case 'star':
        for (const h of list(w.hub)) for (const r of w.spokes) for (const s of list(r)) {
          if (w.kinds) both(h.id, s.id, w.kinds); else { add(h.id, s.id, DOWN); add(s.id, h.id, UP); }
        }
        break;
      case 'tree':
        for (let i = 0; i + 1 < w.levels.length; i++) {
          const parents = list(w.levels[i]), kids = list(w.levels[i + 1]);
          if (!parents.length) continue;
          kids.forEach((k, j) => { const p = parents[j % parents.length]; add(p.id, k.id, DOWN); add(k.id, p.id, UP); k.parent = p.id; });
        }
        break;
      case 'mesh': {
        const members = w.among.flatMap(list);
        for (const a of members) for (const b of members) add(a.id, b.id, w.kinds || ALL);
        break;
      }
      case 'clusters': {
        const peers = list(w.role), bridges = list(w.bridge);
        const groups = Array.from({ length: w.clusters }, () => []);
        peers.forEach((p, i) => { groups[i % w.clusters].push(p); p.cluster = i % w.clusters; });
        for (const g of groups) for (const a of g) for (const b of g) add(a.id, b.id, ALL);
        bridges.forEach((br, i) => {
          const a = groups[i % w.clusters], b = groups[(i + 1) % w.clusters];
          br.clusters = [i % w.clusters, (i + 1) % w.clusters];
          for (const p of [...a, ...b]) both(br.id, p.id, ALL);
        });
        break;
      }
      case 'line': {
        const stations = w.order.map(list);
        for (let i = 0; i + 1 < stations.length; i++) for (const a of stations[i]) for (const b of stations[i + 1]) { add(a.id, b.id, DOWN); add(b.id, a.id, UP); }
        for (const [fromR, toR] of w.back || []) for (const a of list(fromR)) for (const b of list(toR)) add(a.id, b.id, ['order', 'note']);
        break;
      }
      case 'blackboard':
        for (const s of list(w.store)) for (const r of w.readers) for (const n of list(r)) both(s.id, n.id, ['field', ...ALL]);
        break;
      case 'broadcast':
        for (const f of list(w.from)) for (const r of (Array.isArray(w.to) ? w.to : [w.to])) for (const t of list(r)) add(f.id, t.id, w.kinds || DOWN);
        break;
      case 'ring': {
        const ring = list(w.role), k = w.neighbours || 1;
        if (ring.length < 2) break;
        ring.forEach((n, i) => { for (let d = 1; d <= k; d++) { both(n.id, ring[(i + d) % ring.length].id, w.kinds || ['note']); } });
        break;
      }
      case 'pair':
        for (const a of list(w.a)) for (const b of list(w.b)) both(a.id, b.id, w.kinds || ['note']);
        break;
      case 'pairwise': {
        const as = list(w.a), bs = list(w.b);
        if (!as.length || !bs.length) break;
        const n = Math.max(as.length, bs.length);
        for (let i = 0; i < n; i++) both(as[i % as.length].id, bs[i % bs.length].id, w.kinds || ['note', 'report']);
        break;
      }
      case 'link': {
        const froms = list(w.from), tos = Array.isArray(w.to) ? w.to.flatMap(list) : list(w.to);
        if (!froms.length || !tos.length) break;
        if (w.assign === 'round-robin') froms.forEach((f, i) => { const t = tos[i % tos.length]; add(f.id, t.id, w.kinds || UP); if (w.both) add(t.id, f.id, w.backKinds || DOWN); });
        else for (const f of froms) for (const t of tos) { add(f.id, t.id, w.kinds || UP); if (w.both) add(t.id, f.id, w.backKinds || DOWN); }
        break;
      }
      default: throw new Error(`unknown wiring type ${w.type}`);
    }
  }
}

// Which side (0..sides-1) the i-th node (1-based) of a role sits on; null for shared roles or formats without sides.
export function sideOf(format, role, index) {
  const s = format.sides;
  if (!s || !s.count || s.count < 2) return null;
  if ((s.shared || []).includes(role.name)) return null;
  return (index - 1) % s.count;
}

// Builds the node list a format describes on its own (format counts, no team).
export function formatNodes(format) {
  const nodes = [];
  for (const r of format.roles) for (let i = 1; i <= r.count; i++) nodes.push({ id: `${r.key}-${i}`, role: r.name, index: i, seat: r.seat, tier: r.tier, side: sideOf(format, r, i) });
  return nodes;
}
