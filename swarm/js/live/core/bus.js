// Built by scripts/build-swarm.mjs from swarm/core/bus.mjs. Do not edit here.
// Message bus. Only edges the format permits carry messages; the operator may always
// chat with, or stop, any node, and any node may always answer the operator.
export const OPERATOR = 'operator';

export class Bus {
  constructor({ nodes = [], edges = [] } = {}) {
    this.permits = new Map();     // "from>to" -> Set(kinds)
    this.out = new Map();         // from -> [{to, kinds}]
    this.inboxes = new Map();
    this.log = [];                // every accepted message, in order
    this.rejected = [];
    this.listeners = {};
    this.keep = 5000;
    for (const n of nodes) this.inboxes.set(n.id, []);
    for (const e of edges) this.permit(e.from, e.to, e.kinds);
  }
  permit(from, to, kinds) {
    const key = `${from}>${to}`;
    const set = this.permits.get(key) || new Set();
    for (const k of kinds) set.add(k);
    this.permits.set(key, set);
    const list = this.out.get(from) || [];
    const existing = list.find(x => x.to === to);
    if (existing) existing.kinds = [...set]; else list.push({ to, kinds: [...set] });
    this.out.set(from, list);
  }
  allows(from, to, kind) {
    if (from === OPERATOR && (kind === 'chat' || kind === 'stop')) return true;
    if (to === OPERATOR && kind === 'chat') return true;
    const set = this.permits.get(`${from}>${to}`);
    return !!set && set.has(kind);
  }
  neighbours(from, kind) { return (this.out.get(from) || []).filter(x => x.kinds.includes(kind)).map(x => x.to); }
  // Sideways neighbours: edges that carry notes but no orders or reports (a herald, a ring of peers).
  sideways(from) { return (this.out.get(from) || []).filter(x => x.kinds.includes('note') && !x.kinds.includes('order') && !x.kinds.includes('report')).map(x => x.to); }
  send(msg) {
    if (!this.allows(msg.from, msg.to, msg.kind)) {
      const reason = `edge ${msg.from} -> ${msg.to} does not carry ${msg.kind}`;
      this.rejected.push({ ...msg, reason });
      this.emit('rejected', { ...msg, reason });
      return { ok: false, reason };
    }
    if (msg.to !== OPERATOR) {
      if (!this.inboxes.has(msg.to)) { const reason = `no node ${msg.to}`; this.rejected.push({ ...msg, reason }); return { ok: false, reason }; }
      this.inboxes.get(msg.to).push(msg);
    }
    this.log.push(msg);
    if (this.log.length > this.keep) this.log.splice(0, this.log.length - this.keep);
    this.emit('message', msg);
    return { ok: true };
  }
  // Messages sent during tick t are read at tick t+1, so delivery takes real ticks.
  drain(nodeId, beforeTick = Infinity) {
    const box = this.inboxes.get(nodeId) || [];
    const ready = [], later = [];
    for (const m of box) (m.tick < beforeTick ? ready : later).push(m);
    box.splice(0, box.length, ...later);
    return ready;
  }
  on(event, fn) { (this.listeners[event] ||= []).push(fn); return () => { this.listeners[event] = this.listeners[event].filter(f => f !== fn); }; }
  emit(event, data) { for (const fn of this.listeners[event] || []) fn(data); }
  since(index) { return this.log.slice(index); }
}
