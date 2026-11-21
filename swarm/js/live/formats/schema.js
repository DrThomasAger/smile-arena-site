// Built by scripts/build-swarm.mjs from swarm/formats/schema.mjs. Do not edit here.
// Validates a format file. Returns { ok, errors: [] }. Plain checks, no dependencies.
const KINDS = new Set(['order', 'report', 'note', 'field', 'chat', 'stop']);
const WIRING_TYPES = new Set(['star', 'tree', 'mesh', 'clusters', 'line', 'blackboard', 'broadcast', 'ring', 'pair', 'pairwise', 'link']);
const SLIDERS = ['autonomy', 'speech', 'generation', 'spend', 'reach'];

export function validateFormat(f) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(f && typeof f === 'object', 'format is not an object');
  if (!f) return { ok: false, errors };
  for (const k of ['id', 'title', 'family', 'summary', 'leader', 'communication']) need(typeof f[k] === 'string' && f[k], `missing ${k}`);
  need(Array.isArray(f.roles) && f.roles.length > 0, 'roles must be a non-empty array');
  need(Array.isArray(f.body) && f.body.length > 0, 'body must name at least one role');
  need(Array.isArray(f.wiring) && f.wiring.length > 0, 'wiring must be a non-empty array');
  const names = new Set();
  for (const r of f.roles || []) {
    need(typeof r.name === 'string' && r.name, 'role without name');
    need(!names.has(r.name), `duplicate role ${r.name}`); names.add(r.name);
    need(Number.isInteger(r.count) && r.count >= 1, `${r.name}: count must be a positive integer`);
    need(Number.isInteger(r.tier) && r.tier >= 1 && r.tier <= 5, `${r.name}: tier must be 1..5`);
    need(['leader', 'body', 'control'].includes(r.seat), `${r.name}: seat must be leader, body or control`);
    need(typeof r.tag === 'string' && /\*\*\*.+\*\*\*/.test(r.tag), `${r.name}: tag must be a bold-italic SMILE name tag`);
    need(typeof r.prompt === 'string' && r.prompt.includes('agent of reciprocity'), `${r.name}: prompt must name an agent of reciprocity`);
    need(Array.isArray(r.sections) && r.sections.length > 0, `${r.name}: response sections missing`);
    for (const s of SLIDERS) need(Number.isInteger(r.sliders?.[s]) && r.sliders[s] >= 1 && r.sliders[s] <= 5, `${r.name}: slider ${s} must be 1..5`);
  }
  need(names.has(f.leader), `leader ${f.leader} is not a role`);
  need((f.roles || []).filter(r => r.seat === 'leader').length === 1, 'exactly one leader role');
  for (const b of f.body || []) need(names.has(b), `body role ${b} is not a role`);
  for (const w of f.wiring || []) {
    need(WIRING_TYPES.has(w.type), `unknown wiring type ${w.type}`);
    for (const k of w.kinds || []) need(KINDS.has(k), `unknown message kind ${k}`);
    const refs = [w.hub, w.store, w.from, w.to, w.a, w.b, w.role, w.bridge, ...(w.spokes || []), ...(w.levels || []),
      ...(w.among || []), ...(w.readers || []), ...(w.order || []), ...(Array.isArray(w.to) ? w.to : []), ...(w.back || []).flat()]
      .filter(x => typeof x === 'string');
    for (const r of refs) need(names.has(r), `wiring refers to unknown role ${r}`);
  }
  if (f.sides != null) {
    need(f.sides && Number.isInteger(f.sides.count) && f.sides.count >= 2, 'sides.count must be an integer of 2 or more');
    for (const r of f.sides?.shared || []) need(names.has(r), `sides.shared role ${r} is not a role`);
    const shared = new Set(f.sides?.shared || []);
    for (const r of f.roles || []) if (!shared.has(r.name)) need(r.count % (f.sides?.count || 1) === 0, `${r.name}: count ${r.count} does not split evenly over ${f.sides?.count} sides`);
  }
  need(f.message && Array.isArray(f.message.kinds), 'message.kinds missing');
  return { ok: errors.length === 0, errors };
}

export const MESSAGE_KINDS = [...KINDS];
