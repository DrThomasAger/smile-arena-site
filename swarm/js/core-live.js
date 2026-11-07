// Live swarm runtime for the Swarm page: the real core (swarm/core, the sim adapter and the format library,
// published as plain browser modules under swarm/js/live/ by scripts/build-swarm.mjs) behind the API the page
// was built against (core-stub.js documents it; docs/SWARM-API.md documents the core underneath).
//
// The core runs on exactly the nodes the page draws: createSwarm(format) hands the core the page's capped node
// list (Swarm.create({ nodes })), seats one sim team member per body node, and the core's bus, policies, tier
// router, innovation log and sim world do the rest. Nothing here touches a game, a network or a login.
import { Swarm, OPERATOR, makeMessage, parseResponse } from './live/core/index.js';
import { registerFormat } from './live/formats/index.js';

export const STATES = ['auto', 'manual', 'paused', 'stopped'];
export const SOURCE = 'live';
const STRATEGIST = 'strategist';
// page message kinds -> core message kinds
const CORE_KIND = { order: 'order', report: 'report', peer: 'note', terms: 'note', ack: 'note', note: 'note', prompt: 'chat', chat: 'chat', field: 'field', stop: 'stop' };

// One line of plain words from a SMILE response (name tag line, then "# Section" blocks).
export function brief(text) {
  const r = parseResponse(text);
  const parts = Object.entries(r.sections).filter(([, v]) => v && v !== 'none').map(([k, v]) => `${k}: ${v.replace(/\s*\n\s*/g, ' / ')}`);
  if (parts.length) return parts.join(' · ');
  return r.ok ? (String(text).split('\n').slice(1).join(' ').trim() || 'none') : String(text);
}

// One sim team member per body seat, in the plan's 8 : 4 : 10 proportion (mages, scouts, skillers).
export function teamFor(count) {
  const least = count >= 3 ? 1 : 0;
  const mages = Math.min(count, Math.max(least, Math.round(count * 8 / 22)));
  const scouts = Math.min(count - mages, Math.max(least, Math.round(count * 4 / 22)));
  const skillers = Math.max(0, count - mages - scouts);
  const team = [];
  const add = (kind, n, label) => { for (let i = 1; i <= n; i++) team.push({ id: `${kind}-${i}`, kind, name: `${label} ${i}` }); };
  add('mage', mages, 'Mage'); add('scout', scouts, 'Scout'); add('skiller', skillers, 'Skiller');
  return team;
}

export function createSwarm(format, { seed = 7, idleTicks = 0 } = {}) {
  const spec = format.spec;
  if (!spec) throw new Error('createSwarm: the page format carries no spec (formats.js buildFormat sets format.spec)');
  registerFormat(spec);
  const nodeSpec = format.nodes.map(n => ({ id: n.id, role: n.roleName, index: n.idx + 1, side: n.side ?? null, label: n.name }));
  const team = teamFor(format.nodes.filter(n => n.seat === 'body').length);
  const s = Swarm.create({ format: spec, team, nodes: nodeSpec, seed, idleHandbackTicks: idleTicks });

  const subs = {};
  const emit = (ev, data) => { for (const fn of subs[ev] || []) fn(data); };
  const entry = new Set(format.entry);
  const edgeKind = new Map(format.edges.map(e => [e.from + '>' + e.to, e.kind]));
  const pageId = id => id === OPERATOR ? STRATEGIST : id;
  const noteKind = (from, to) => edgeKind.get(from + '>' + to) || 'peer';
  const kindOf = m => {
    if (m.kind === 'chat') return m.from === OPERATOR ? 'prompt' : 'reply';
    if (m.kind === 'order' || (m.kind === 'field' && m.orderId)) return 'order';
    if (m.kind === 'report' || m.kind === 'field') return 'report';
    if (m.kind === 'note') return noteKind(m.from, m.to);
    return m.kind;
  };
  const view = m => ({ ok: true, id: m.id, t: m.tick, from: pageId(m.from), to: pageId(m.to), kind: kindOf(m), text: brief(m.text), raw: m.text, hops: m.hops, orderId: m.orderId, smile: m.meta?.smile });
  const outKind = (from, t) => t.kind === 'chat' ? 'reply' : t.kind === 'note' ? noteKind(from, t.peer) : t.kind === 'field' ? 'order' : t.kind;

  let stopped = false, ticking = null;
  const modes = new Map(), thinks = new Map();
  const innovation = [], innovSeen = new Set();
  const nodes = new Map();
  for (const n of format.nodes) {
    const core = s.node(n.id);
    modes.set(n.id, core.mode); thinks.set(n.id, 0);
    const out = { order: [], report: [], peer: [], terms: [], ack: [] };
    for (const e of format.edges) if (e.from === n.id) (out[e.kind] || (out[e.kind] = [])).push(e.to);
    nodes.set(n.id, {
      id: n.id, role: n.role, roleName: n.roleName, name: n.name, short: n.short, color: n.color, seat: n.seat, side: n.side, tier: n.tier, tierName: n.tierName, out, core,
      get state() { return core.mode; },
      get tag() { return core.tag; },
      get prompt() { return core.prompt; },
      get member() { return core.member; },
      get lastTier() { return core.lastTier; },
      get order() { return core.state.order; },
      get world() { return core.member ? s.adapter.observe(core.member.id) : null; },
      get inbox() { return (s.bus.inboxes.get(n.id) || []).map(view); },
      get outbox() { return core.transcript.filter(t => t.dir === 'out' && t.ok).map(t => ({ ok: true, id: t.id, t: t.tick, from: n.id, to: pageId(t.peer), kind: outKind(n.id, t), text: brief(t.text), raw: t.text })); },
      get reasoning() { return core.transcript.filter(t => t.dir === 'think').map(t => ({ t: t.tick, text: t.text })); },
      // the node's own chat with the operator, plus the control notes (taken over, paused, handed back)
      // (what you typed shows at once, marked pending until the node reads it next tick)
      get chat() {
        const lines = core.transcript.filter(t => (t.peer === OPERATOR && t.dir !== 'think') || (t.dir === 'think' && t.control)).map(t => ({ t: t.tick, who: t.dir === 'in' ? 'you' : t.dir === 'out' ? n.name : '', text: t.dir === 'think' ? t.text : brief(t.text) }));
        for (const m of s.bus.inboxes.get(n.id) || []) if (m.from === OPERATOR && m.kind === 'chat') lines.push({ t: m.tick, who: 'you', text: m.text, pending: true });
        return lines;
      },
    });
  }
  const syncState = (id, why) => { const mode = s.node(id).mode; if (modes.get(id) !== mode) { modes.set(id, mode); emit('state', { node: id, state: mode, why }); } };
  const control = (id, why, fn, words) => { const core = s.node(id); fn(core); core.note(s.tick, 'think', `${words} (${why}).`, { control: true }); syncState(id, why); emit('reasoning', { node: id, text: `${words} (${why}).`, t: s.tick }); };

  s.bus.on('rejected', m => emit('reject', { ok: false, from: pageId(m.from), to: pageId(m.to), kind: m.kind, reason: m.reason }));
  s.on('message', m => {
    const v = view(m);
    emit('message', v);
    if (m.to === OPERATOR) emit('reply', { node: m.from, name: nodes.get(m.from)?.name || m.from, text: v.text, raw: m.text, t: m.tick });
  });

  const bus = {
    allowed(from, to) { if (from === STRATEGIST) return entry.has(to); return s.bus.permits.has(from + '>' + to); },
    kindOf(from, to) { return from === STRATEGIST ? 'prompt' : edgeKind.get(from + '>' + to); },
    send(from, to, { kind, text } = {}) {
      const reject = reason => { const r = { ok: false, from, to, reason }; emit('reject', r); return r; };
      if (stopped) return reject('stopped');
      if (from === STRATEGIST && !entry.has(to)) return reject(`the strategist talks to ${[...entry].map(id => nodes.get(id)?.name || id).join(', ')} only`);
      const target = s.byId.get(to); if (!target) return reject(`no node ${to}`);
      if (target.mode === 'stopped') return reject(`${target.label} is stopped`);
      const coreKind = from === STRATEGIST ? 'chat' : CORE_KIND[kind || bus.kindOf(from, to)] || kind;
      const msg = makeMessage({ from: from === STRATEGIST ? OPERATOR : from, to, kind: coreKind, text: String(text), tick: s.tick });
      const r = s.bus.send(msg);          // the core bus emits 'rejected' when the format has no such edge
      return r.ok ? view(msg) : { ok: false, from, to, reason: r.reason };
    },
  };

  const swarm = {
    format, spec, nodes, bus, innovation, entry: [...entry], core: s, source: SOURCE,
    get stopped() { return stopped; }, get t() { return s.tick; },
    on(ev, fn) { (subs[ev] || (subs[ev] = new Set())).add(fn); return () => subs[ev].delete(fn); },
    // Operator prompt to the entry node(s): the core parses it into orders at the leader and they fan out.
    strategist(text) {
      if (!text.trim()) return [];
      if (stopped) { const r = { ok: false, from: STRATEGIST, to: [...entry].join(','), reason: 'stopped' }; emit('reject', r); return []; }
      return s.prompt(text, { to: [...entry] }).messages.map(view);
    },
    // Chat with one node: the core takes it over (manual) and it answers in its own name tag next tick.
    prompt(id, text) {
      if (!nodes.has(id) || !text.trim() || stopped) return [];
      s.chat(id, text);
      syncState(id, 'chat');
      return [view(s.bus.log[s.bus.log.length - 1])];
    },
    takeover(id, why = 'button') { if (nodes.has(id) && !stopped) control(id, why, c => c.takeover(), 'Taken over by you. I act only on what you type'); },
    pause(id, why = 'button') { if (nodes.has(id) && !stopped) control(id, why, c => c.pause(), 'Paused. Messages wait in my inbox'); },
    handback(id, why = 'button') { if (nodes.has(id) && !stopped) control(id, why, c => c.handback(), 'Control handed back. Back on my role prompt'); },
    stopAll(why = 'Ctrl+Shift+Esc') {
      if (stopped) return;
      stopped = true; s.stopAll();
      for (const id of nodes.keys()) syncState(id, why);
      emit('stop', { why, tick: s.tick });
    },
    resumeAll() {
      s.resumeAll(); stopped = false;
      for (const id of nodes.keys()) syncState(id, 'resume');
      emit('resume', { tick: s.tick });
    },
    // One round of the core (async: the tier router is awaited). Returns the promise; a second call while a
    // round is running returns the same promise.
    tick() {
      if (stopped) return Promise.resolve();
      if (ticking) return ticking;
      ticking = s.step(1).then(() => {
        for (const [id, n] of nodes) {
          syncState(id, 'core');
          const th = n.core.transcript.filter(t => t.dir === 'think');
          const seen = thinks.get(id) || 0;
          for (const t of th.slice(seen > th.length ? 0 : seen)) if (!t.control) emit('reasoning', { node: id, text: t.text, t: t.tick });
          thinks.set(id, th.length);
        }
        for (const t of s.log.tactics(spec)) if (!innovSeen.has(t.signature)) { innovSeen.add(t.signature); innovation.push({ t: s.tick, name: t.name, text: t.words }); }
      }).finally(() => { ticking = null; });
      return ticking;
    },
    metrics() { return s.metrics(); },
    snapshot() { return s.snapshot(); },
    report() { return s.innovation().text; },
  };
  return swarm;
}
