// Built by scripts/build-swarm.mjs from swarm/core/node.mjs. Do not edit here.
// One node = one agent: its own inbox, filled SMILE role prompt, state, mode and transcript.
import { fillSlots, formatResponse, checkSmile, makeMessage } from './message.js';
import { OPERATOR } from './bus.js';

export class SwarmNode {
  constructor({ id, role, roleSpec, seat, index, tier, member = null, label = null, side = null, slots = {} }) {
    this.id = id; this.role = role; this.roleSpec = roleSpec; this.seat = seat; this.index = index; this.tier = tier; this.side = side;
    this.member = member; this.kind = member?.kind || null; this.label = label || member?.name || id;
    this.mode = 'auto';            // auto | manual | paused | stopped
    this.transcript = [];          // {tick, dir: in|out|think, text, kind, peer}
    this.state = { order: null, seenOrders: new Set(), orderTicks: new Map(), seenReports: new Set(), reports: [], issued: [], hops: 0, idle: 0, kills: 0, acted: 0 };
    const fill = { n: index, k: index, id: index, sangha: slots.sangha || 'the swarm', ...slots };
    if (side !== null && side !== undefined) fill.side ||= 'AB'[side] || String(side + 1);
    for (const s of ['skill', 'step', 'side', 'channel', 'household', 'craft', 'resource', 'nation', 'name', 'module', 'role', 'section', 'part', 'wing']) fill[s] ||= member?.name || role;
    this.tag = fillSlots(roleSpec.tag, fill);
    this.prompt = fillSlots(roleSpec.prompt, fill);
    this.lastTier = 1;
  }
  takeover() { if (this.mode !== 'stopped') this.mode = 'manual'; this.state.idle = 0; return this; }
  handback() { if (this.mode !== 'stopped') this.mode = 'auto'; this.state.idle = 0; return this; }
  pause() { if (this.mode !== 'stopped') this.mode = 'paused'; return this; }
  resume() { if (this.mode === 'paused') this.mode = 'auto'; return this; }
  // Compose a SMILE response in this node's voice and check it before it leaves.
  compose(sections, text, carried = false) {
    const body = text ?? formatResponse(this.tag, sections || { Done: 'none', Blocked: 'none' });
    const check = checkSmile(body, carried ? {} : { tag: this.tag });
    return { text: body, check };
  }
  note(tick, dir, text, extra = {}) { this.transcript.push({ tick, dir, text, ...extra }); if (this.transcript.length > 400) this.transcript.splice(0, this.transcript.length - 400); }

  async step(ctx) {
    const inbox = ctx.bus.drain(this.id, ctx.tick);
    for (const m of inbox) this.note(ctx.tick, 'in', m.text, { kind: m.kind, peer: m.from, id: m.id });
    const chatted = inbox.some(m => m.kind === 'chat' && m.from === OPERATOR);
    if (chatted && this.mode === 'auto' && this.seat !== 'leader') this.mode = 'manual'; // the operator prompt is the leader's normal input
    if (this.mode === 'manual') { this.state.idle = chatted ? 0 : this.state.idle + 1; if (ctx.idleHandbackTicks && this.state.idle >= ctx.idleHandbackTicks) { this.handback(); this.note(ctx.tick, 'think', 'idle, handed back to auto'); } }
    const stop = inbox.find(m => m.kind === 'stop');
    if (stop) { this.mode = 'stopped'; this.state.order = null; this.note(ctx.tick, 'think', 'stop received'); return { messages: [], action: null }; }
    if (this.mode === 'paused' && !inbox.some(m => m.kind === 'chat')) { for (const m of inbox) ctx.bus.inboxes.get(this.id).push(m); return { messages: [], action: null }; }
    const manualFilter = this.mode === 'manual' ? inbox.filter(m => m.kind === 'chat' || m.kind === 'report' || m.kind === 'field' && !m.orderId) : inbox;
    const context = {
      tick: ctx.tick, inbox: manualFilter,
      downstream: kind => ctx.bus.neighbours(this.id, kind),
      upstream: kind => ctx.bus.neighbours(this.id, kind).filter(id => ctx.seatOf(id) !== 'body'),
      observe: ctx.adapter && this.member ? () => ctx.adapter.observe(this.member.id) : null,
      sideways: () => ctx.bus.sideways(this.id),
      places: ctx.adapter?.places || null, seatOf: ctx.seatOf,
      cooperationLine: ctx.cooperationLine, reply: inbox.find(m => m.kind === 'chat')?.from || null, question: inbox.find(m => m.kind === 'chat')?.text || '',
    };
    const d = await ctx.router.decide(this, context);
    this.lastTier = d.tier;
    if (d.think) this.note(ctx.tick, 'think', `[tier ${d.tier}] ${d.think}`);
    const sent = [];
    for (const m of d.messages || []) {
      const { text, check } = this.compose(m.sections, m.text, !!m.carried);
      const msg = makeMessage({ from: this.id, to: m.to, kind: m.kind, text, tick: ctx.tick, orderId: m.orderId || null, ref: m.ref || null, hops: m.hops || 0, meta: { ...(m.meta || {}), smile: check.ok, problems: check.problems } });
      const r = ctx.bus.send(msg);
      this.note(ctx.tick, 'out', text, { kind: m.kind, peer: m.to, ok: r.ok, id: msg.id });
      if (r.ok) sent.push(msg);
    }
    if (d.action && ctx.adapter && this.member) { const r = ctx.adapter.act(this.member.id, d.action); if (r && r.note) this.note(ctx.tick, 'think', r.note); }
    return { messages: sent, action: d.action };
  }
  snapshot(adapter) {
    const obs = adapter && this.member ? adapter.observe(this.member.id) : null;
    return { id: this.id, role: this.role, seat: this.seat, side: this.side, tier: this.tier, lastTier: this.lastTier, mode: this.mode, member: this.member ? { id: this.member.id, kind: this.member.kind, name: this.member.name } : null,
      tag: this.tag, order: this.state.order ? { id: this.state.order.id, who: this.state.order.who, verb: this.state.order.verb, target: this.state.order.target } : null,
      world: obs ? { pos: obs.pos, place: obs.place, hp: obs.hp, maxHp: obs.maxHp, kills: obs.kills, gp: obs.gp, inventory: obs.inventory } : null,
      inbox: this.transcript.filter(t => t.dir === 'in').slice(-10), outbox: this.transcript.filter(t => t.dir === 'out').slice(-10), reasoning: this.transcript.filter(t => t.dir === 'think').slice(-10) };
  }
}
