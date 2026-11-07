// Built by scripts/build-swarm.mjs from swarm/core/team.mjs. Do not edit here.
// The team and how a format is composed around it.
// Body seats are filled by team members (preferring the member kind the role names);
// control seats are scaled from the diagram's counts to the team's size; leaders keep
// the diagram's count. A format with 1000 fighters composes cleanly around 22 members.
import { expandEdges, sideOf } from '../formats/wiring.js';
import { SwarmNode } from './node.js';

export const DEFAULT_TEAM = { mages: 8, scouts: 4, skillers: 10 };

export function makeTeam(spec = DEFAULT_TEAM) {
  const team = [];
  const add = (kind, n, label) => { for (let i = 1; i <= n; i++) team.push({ id: `${kind}-${i}`, kind, name: `${label} ${i}` }); };
  add('mage', spec.mages ?? 0, 'Mage'); add('scout', spec.scouts ?? 0, 'Scout'); add('skiller', spec.skillers ?? 0, 'Skiller');
  return team;
}

// `nodes`: an optional explicit node list [{ id, role (name), index, side?, label? }] (the Swarm page passes
// its capped diagram so the core runs on exactly the nodes drawn); body seats in it take team members in order.
export function composeSwarm(format, team, { sangha, nodes: given = null } = {}) {
  const bodyRoles = format.roles.filter(r => r.seat === 'body');
  const bodyCount = bodyRoles.reduce((a, r) => a + r.count, 0) || 1;
  const ratio = team.length / bodyCount;
  const sides = format.sides?.count >= 2 ? format.sides.count : 1;
  const nodes = [];
  const roleCount = {};
  const push = (r, member = null, spec = null) => {
    const index = spec?.index ?? (roleCount[r.name] = (roleCount[r.name] || 0) + 1);
    const side = spec && spec.side !== undefined ? spec.side : sideOf(format, r, index);
    nodes.push(new SwarmNode({ id: spec?.id || `${r.key}-${index}`, role: r.name, roleSpec: r, seat: r.virtual ? 'store' : r.seat, index, tier: r.tier, member, side, label: spec?.label || null, slots: { sangha: sangha || format.title } }));
  };
  if (given) {
    const pool = [...team];
    const byName = Object.fromEntries(format.roles.map(r => [r.name, r]));
    for (const spec of given) {
      const r = byName[spec.role];
      if (!r) throw new Error(`no role ${spec.role} in ${format.id}`);
      let member = null;
      if (r.seat === 'body' && pool.length) { const i = r.prefer ? pool.findIndex(m => m.kind === r.prefer) : -1; member = pool.splice(i >= 0 ? i : 0, 1)[0]; }
      push(r, member, spec);
    }
    return { nodes, edges: expandEdges(nodes, format.wiring) };
  }
  for (const r of format.roles) {
    if (r.seat === 'body') continue;
    const per = (format.sides?.shared || []).includes(r.name) ? 1 : sides;   // each side keeps at least one of every control role; shared roles are not multiplied
    const scaled = Math.round(r.count * ratio / per) * per;
    const count = r.seat === 'leader' || r.virtual ? r.count : Math.max(per, Math.min(r.count, scaled));
    for (let i = 0; i < count; i++) push(r);
  }
  // seat the team: preferred kinds first, then round-robin by the diagram's proportions
  const pool = [...team];
  const seats = bodyRoles.map(r => ({ r, want: Math.max(1, Math.round(r.count * ratio)), got: 0 }));
  for (const s of seats) if (s.r.prefer) {
    for (let i = pool.length - 1; i >= 0 && s.got < s.want; i--) if (pool[i].kind === s.r.prefer) { push(s.r, pool.splice(i, 1)[0]); s.got++; }
  }
  let turn = 0;
  while (pool.length) {
    const open = seats.filter(s => s.got < s.want);
    const s = open.length ? open[turn % open.length] : seats[turn % seats.length];
    push(s.r, pool.shift()); s.got++; turn++;
  }
  const edges = expandEdges(nodes, format.wiring);
  return { nodes, edges };
}
