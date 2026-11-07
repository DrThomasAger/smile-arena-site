// Built by scripts/build-swarm.mjs from swarm/formats/render.mjs. Do not edit here.
// Renders a format (and optionally a live swarm) as an SVG string. No dependencies.
// Layout: leader in the centre, control seats on an inner ring, body seats on the outer ring.
// Each node carries data-node and each edge data-from/data-to so a UI can animate messages.
const TIER_FILL = { 1: '#2f3b2f', 2: '#2f3b4a', 3: '#3b2f4a', 4: '#4a3b2f', 5: '#4a2f2f' };

export function renderFormatSVG(format, nodes, edges, opts = {}) {
  const W = opts.width || 720, H = opts.height || 480, cx = W / 2, cy = H / 2 + 10;
  const leader = nodes.filter(n => n.seat === 'leader');
  const control = nodes.filter(n => n.seat === 'control');
  const body = nodes.filter(n => n.seat === 'body');
  const pos = {};
  const place = (list, r) => list.forEach((n, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(list.length, 1);
    pos[n.id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  if (leader.length === 1) pos[leader[0].id] = { x: cx, y: cy }; else place(leader, 28);
  place(control, Math.min(W, H) * 0.22);
  place(body, Math.min(W, H) * 0.42);
  const rad = n => n.seat === 'leader' ? 18 : n.seat === 'control' ? 13 : Math.max(6, Math.min(11, 220 / Math.max(body.length, 1)));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const roleOf = Object.fromEntries(format.roles.map(r => [r.name, r]));
  const emoji = n => (roleOf[n.role]?.tag || '').split(' ')[0] || '';
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" data-format="${esc(format.id)}" font-family="'Source Sans 3','Segoe UI',system-ui,sans-serif">`;
  out += `<title>${esc(format.title)}</title><desc>${esc(format.summary)}</desc>`;
  out += `<rect width="${W}" height="${H}" fill="${opts.background || '#15120f'}"/>`;
  out += `<text x="${cx}" y="26" text-anchor="middle" fill="#e8dcc8" font-size="16" font-weight="600">${esc(format.title)}</text>`;
  out += `<text x="${cx}" y="44" text-anchor="middle" fill="#a89b86" font-size="11">${nodes.length} nodes, ${edges.length} permitted edges</text>`;
  out += '<g class="edges">';
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to]; if (!a || !b) continue;
    const kind = e.kinds.includes('order') ? 'order' : e.kinds.includes('report') ? 'report' : e.kinds[0];
    const colour = kind === 'order' ? '#6b5a3e' : kind === 'report' ? '#3e5a6b' : '#4a4a4a';
    out += `<line data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-kinds="${esc(e.kinds.join(' '))}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${colour}" stroke-width="${kind === 'order' ? 1.2 : 0.8}" stroke-opacity="0.7"/>`;
  }
  out += '</g><g class="nodes">';
  for (const n of nodes) {
    const p = pos[n.id], r = rad(n), role = roleOf[n.role] || {};
    const state = n.mode ? ` data-mode="${esc(n.mode)}"` : '';
    out += `<g data-node="${esc(n.id)}" data-role="${esc(n.role)}" data-seat="${n.seat}"${state} transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">`;
    out += `<circle r="${r}" fill="${TIER_FILL[role.tier] || '#333'}" stroke="${n.mode === 'manual' ? '#f2c14e' : n.mode === 'paused' ? '#888' : '#c9b48a'}" stroke-width="${n.seat === 'leader' ? 2 : 1}"/>`;
    if (r >= 9) out += `<text y="${Math.round(r * 0.4)}" text-anchor="middle" font-size="${Math.round(r)}">${esc(emoji(n))}</text>`;
    if (n.seat !== 'body' || body.length <= 24) out += `<text y="${r + 11}" text-anchor="middle" fill="#cfc3ad" font-size="9">${esc(n.label || n.id)}</text>`;
    out += '</g>';
  }
  out += '</g></svg>';
  return out;
}
