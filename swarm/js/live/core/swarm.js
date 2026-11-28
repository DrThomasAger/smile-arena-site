// Built by scripts/build-swarm.mjs from swarm/core/swarm.mjs. Do not edit here.
// The swarm: a format composed around a team, a bus that only carries permitted edges,
// a tier router, an adapter for the world, and the innovation log.
import { loadFormatSync } from '../formats/index.js';
import { renderFormatSVG } from '../formats/render.js';
import { Bus, OPERATOR } from './bus.js';
import { TierRouter } from './router.js';
import { deterministic, orderFor } from './policies.js';
import { makeTeam, composeSwarm, DEFAULT_TEAM } from './team.js';
import { makeMessage, parseOrders } from './message.js';
import { InnovationLog } from './log/innovation.js';
import { SimAdapter } from '../adapters/sim/index.js';

export class Swarm {
  static create(opts = {}) { return new Swarm(opts); }
  constructor({ format = 'chain', team = DEFAULT_TEAM, nodes = null, adapter = null, router = null, idleHandbackTicks = 0, seed = 1, sangha = null, history = null } = {}) {
    this.team = Array.isArray(team) ? team : makeTeam(team);
    this.nodeSpec = nodes;          // optional explicit node list (see composeSwarm)
    this.stopped = false;
    this.adapter = adapter || new SimAdapter({ seed });
    this.router = router || new TierRouter({ deterministic });
    this.idleHandbackTicks = idleHandbackTicks;
    this.sangha = sangha;
    this.tick = 0;
    this.listeners = {};
    this.log = new InnovationLog({ history });
    this.prompts = [];
    for (const m of this.team) this.adapter.spawn(m);
    this.useFormat(format);
  }
  useFormat(format) {
    this.format = typeof format === 'string' ? loadFormatSync(format) : format;
    const { nodes, edges } = composeSwarm(this.format, this.team, { sangha: this.sangha, nodes: this.nodeSpec });
    this.nodes = nodes; this.edges = edges;
    this.byId = new Map(nodes.map(n => [n.id, n]));
    for (const n of nodes) if (n.member) this.byId.set(n.member.id, n);
    this.bus = new Bus({ nodes, edges });
    this.bus.on('message', m => this.emit('message', m));
    this.bus.on('rejected', m => this.emit('rejected', m));
    this.emit('format', this.format.id);
    return this;
  }
  switchFormat(id) { return this.useFormat(id); }
  get leaders() { return this.nodes.filter(n => n.seat === 'leader'); }
  get bodies() { return this.nodes.filter(n => n.seat === 'body'); }
  node(id) { const n = this.byId.get(id); if (!n) throw new Error(`no node ${id}`); return n; }

  // Operator prompt in -> orders out through the format's leader(s). `to` narrows it to some leader ids
  // (the Swarm page talks to side A's strategist only).
  prompt(text, { to = null } = {}) {
    const orders = parseOrders(text, { tick: this.tick, seed: 'leader' });
    this.prompts.push({ tick: this.tick, text, orders });
    const leaders = to ? this.leaders.filter(l => to.includes(l.id)) : this.leaders;
    const messages = [];
    for (const l of leaders) { const m = makeMessage({ from: OPERATOR, to: l.id, kind: 'chat', text, tick: this.tick }); if (this.bus.send(m).ok) messages.push(m); }
    this.log.orders(orders, text, this.tick);
    this.emit('prompt', { text, orders });
    return { orders, leaders: leaders.map(l => l.id), messages };
  }
  // Per-node control. Chatting with a node takes it over; handback returns it to the format.
  chat(id, text) { const n = this.node(id); n.takeover(); this.bus.send(makeMessage({ from: OPERATOR, to: n.id, kind: 'chat', text, tick: this.tick })); this.emit('chat', { id: n.id, text }); return n; }
  takeover(id) { return this.node(id).takeover(); }
  handback(id) { return this.node(id).handback(); }
  pause(id) { return this.node(id).pause(); }
  resume(id) { return this.node(id).resume(); }
  stopAll() {     // Ctrl+Shift+Esc in the UI lands here
    for (const n of this.nodes) this.bus.send(makeMessage({ from: OPERATOR, to: n.id, kind: 'stop', text: 'stop', tick: this.tick }));
    for (const n of this.nodes) { n.mode = 'stopped'; n.state.order = null; }
    this.adapter.halt?.();
    this.stopped = true;
    this.emit('stop', { tick: this.tick });
    return this;
  }
  // Resume all (the page's button after a stop): every node back on auto, pending stop messages dropped, the world moves again.
  resumeAll() {
    for (const box of this.bus.inboxes.values()) box.splice(0, box.length, ...box.filter(m => m.kind !== 'stop'));
    for (const n of this.nodes) { n.mode = 'auto'; n.state.idle = 0; }
    this.adapter.resume?.();
    this.stopped = false;
    this.emit('resume', { tick: this.tick });
    return this;
  }
  replies(id = null) { return this.bus.log.filter(m => m.to === OPERATOR && (!id || m.from === id)); }

  async step(ticks = 1) {
    for (let i = 0; i < ticks; i++) {
      this.tick++;
      const events = this.adapter.tick?.() || [];
      const ctx = { tick: this.tick, bus: this.bus, router: this.router, adapter: this.adapter, idleHandbackTicks: this.idleHandbackTicks, cooperationLine: () => this.cooperationLine(), seatOf: id => this.byId.get(id)?.seat };
      const start = this.bus.log.length;
      for (const n of this.nodes) await n.step(ctx);
      const messages = this.bus.log.slice(start);
      this.log.observe({ tick: this.tick, events, messages, nodes: this.nodes, adapter: this.adapter });
      this.emit('tick', { tick: this.tick, events, messages });
    }
    return this;
  }
  run(ticks) { return this.step(ticks); }

  // Metrics in the format's own three words.
  metrics() {
    const issued = this.leaders.flatMap(l => l.state.issued);
    const uniq = new Map(issued.map(o => [o.id, o]));
    let sent = 0, acted = 0, gatherTicks = [], hops = 0, matched = 0, bodiesWithOrder = 0;
    for (const o of uniq.values()) {
      const targets = this.bodies.filter(b => orderFor(o, b.kind));
      const got = targets.filter(b => b.state.seenOrders.has(o.id));
      sent += targets.length; acted += got.length;
      if (got.length === targets.length && targets.length) gatherTicks.push(Math.max(...got.map(b => b.state.orderTicks.get(o.id) ?? o.tick)) - o.tick);
    }
    for (const b of this.bodies) { hops = Math.max(hops, b.state.hops); if (b.state.order) { bodiesWithOrder++; if (uniq.has(b.state.order.id)) matched++; } }
    const smileOk = this.bus.log.filter(m => m.meta?.smile !== undefined);
    return {
      format: this.format.id, tick: this.tick, nodes: this.nodes.length, edges: this.edges.length,
      ordersIssued: uniq.size, ordersSent: sent, ordersActed: acted,
      cooperation: sent ? +(acted / sent).toFixed(3) : 0,
      harmony: bodiesWithOrder ? +(matched / bodiesWithOrder).toFixed(3) : 1,
      gathering: { ticks: gatherTicks.length ? Math.max(...gatherTicks) : null, hops },
      messages: this.bus.log.length, rejected: this.bus.rejected.length,
      smileClean: smileOk.length ? +(smileOk.filter(m => m.meta.smile).length / smileOk.length).toFixed(3) : 1,
      tiers: this.router.stats, words: this.format.smileMetrics,
    };
  }
  cooperationLine() { const m = this.metrics(); return `cooperation ${m.cooperation} (${m.ordersActed} of ${m.ordersSent} orders taken), harmony ${m.harmony}, gathering ${m.gathering.ticks ?? '-'} ticks / ${m.gathering.hops} hops`; }
  snapshot() { return { tick: this.tick, format: { id: this.format.id, title: this.format.title }, nodes: this.nodes.map(n => n.snapshot(this.adapter)), edges: this.edges, recent: this.bus.log.slice(-50), metrics: this.metrics() }; }
  renderSVG(opts) { return renderFormatSVG(this.format, this.nodes.map(n => ({ id: n.id, role: n.role, seat: n.seat === 'store' ? 'control' : n.seat, mode: n.mode, label: n.label })), this.edges, opts); }
  innovation() { return this.log.finish({ format: this.format, metrics: this.metrics(), prompts: this.prompts, adapter: this.adapter }); }
  on(event, fn) { (this.listeners[event] ||= []).push(fn); return () => { this.listeners[event] = this.listeners[event].filter(f => f !== fn); }; }
  emit(event, data) { for (const fn of this.listeners[event] || []) fn(data); }
}
