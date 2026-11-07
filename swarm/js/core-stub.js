// Swarm runtime stub for the UI (SWARM-PLAN piece 2 is Agent A's; this mirrors the planned API so the
// UI can be built and tested now). Everything is tier-1 deterministic, runs in the browser, touches no game.
//
// API (same shape docs/SWARM-API.md is expected to publish):
//   const swarm = createSwarm(format, { seed, maxHops })
//   swarm.nodes            Map id -> node { id, role, roleName, name, tier, state, inbox, outbox, reasoning, out:{order,report,peer,terms} }
//   swarm.bus.allowed(from, to)      true when the format has that edge (or from === 'strategist' to an entry node)
//   swarm.bus.send(from, to, { kind, text })   -> message, or { ok:false, reason } when the edge is not permitted
//   swarm.strategist(text)           human prompt to the entry node(s)
//   swarm.prompt(nodeId, text)       act as that node (manual takeover): the text is parsed into messages on its own edges
//   swarm.takeover(id) / pause(id) / handback(id, why) / stopAll(why) / resumeAll()
//   swarm.tick()                     one round: every auto node processes its inbox; ambient reports from the leaves
//   swarm.on(event, fn)              'message' | 'reject' | 'state' | 'reasoning' | 'reply' | 'stop' | 'resume'
//   swarm.innovation                 plain-word notes about what the team did differently (piece 8 keeps the real log)

export const STATES = ['auto', 'manual', 'paused', 'stopped'];
const REPORTS = {
  game: ['3 enemies at the east bridge', 'flag held, food running low', 'supply line to base is clear', 'scout sees 5 mages moving north', 'squad beside us asks for help', 'runes down to 40'],
  nature: ['food source 40 m north', 'trail is strong this way', 'brood fed, stores at 60%', 'path ahead blocked, trying another', 'neighbour signals a rich patch'],
  default: ['task done, result attached', 'found two matching files', 'check passed with one warning', 'blocked on a missing input', 'draft ready for review', 'nothing new to report'],
};

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export function createSwarm(format, { seed = 7, maxHops = 6 } = {}) {
  const rand = rng(seed);
  let seq = 0, t = 0;
  const subs = {};
  const emit = (ev, data) => { for (const fn of subs[ev] || []) fn(data); };
  const nodes = new Map();
  for (const n of format.nodes) nodes.set(n.id, { ...n, state: 'auto', inbox: [], outbox: [], reasoning: [], out: { order: [], report: [], peer: [], terms: [], ack: [] }, seen: 0 });
  const edgeKind = new Map();
  for (const e of format.edges) { edgeKind.set(e.from + '>' + e.to, e.kind); const n = nodes.get(e.from); (n.out[e.kind] || (n.out[e.kind] = [])).push(e.to); }
  const entry = new Set(format.entry);
  const innovation = [];
  let stopped = false;

  const bus = {
    allowed(from, to) { if (from === 'strategist') return entry.has(to); return edgeKind.has(from + '>' + to); },
    kindOf(from, to) { return from === 'strategist' ? 'prompt' : edgeKind.get(from + '>' + to); },
    send(from, to, { kind, text, hops = 0, re = null }) {
      if (stopped) { const r = { ok: false, from, to, reason: 'stopped' }; emit('reject', r); return r; }
      if (!bus.allowed(from, to)) { const r = { ok: false, from, to, reason: `no edge ${from} → ${to} in ${format.title}` }; emit('reject', r); return r; }
      const target = nodes.get(to);
      if (target.state === 'stopped') { const r = { ok: false, from, to, reason: `${target.name} is stopped` }; emit('reject', r); return r; }
      const msg = { ok: true, id: 'm' + (++seq), t, from, to, kind: kind || bus.kindOf(from, to), text: String(text), hops, re };
      target.inbox.push(msg);
      const src = nodes.get(from); if (src) src.outbox.push(msg);
      emit('message', msg);
      return msg;
    },
  };

  const think = (n, text) => { n.reasoning.push({ t, text }); if (n.reasoning.length > 60) n.reasoning.shift(); emit('reasoning', { node: n.id, text, t }); };
  const reply = (n, text) => emit('reply', { node: n.id, name: n.name, text, t });
  const tierNote = n => n.tier <= 2 ? `tier ${n.tier} rule` : `tier ${n.tier} (${n.tierName}) would be asked here; the demo uses a tier-1 rule`;
  const nameOf = id => id === 'strategist' ? 'the strategist' : (nodes.get(id)?.name || id);
  const isTop = n => !n.out.report.length && !n.out.terms.length;
  const pool = REPORTS[format.family] || REPORTS.default;

  // One message, one deterministic decision.
  function handle(n, m) {
    if (m.hops >= maxHops) { think(n, `Dropped "${m.text}" from ${nameOf(m.from)}: it has travelled ${m.hops} hops, which is the limit.`); return; }
    const fwd = (ids, kind, text, extra = {}) => ids.forEach(to => bus.send(n.id, to, { kind, text, hops: m.hops + 1, re: m.id, ...extra }));
    if (m.kind === 'prompt' || m.kind === 'order') {
      const who = m.kind === 'prompt' ? 'Prompt' : 'Order';
      if (n.out.order.length) {
        think(n, `${who} from ${nameOf(m.from)}: "${m.text}". I pass orders to ${n.out.order.length} below me (${tierNote(n)}).`);
        fwd(n.out.order, 'order', m.text);
        if (m.kind === 'prompt') reply(n, `Order received: "${m.text}". Sent to ${roleWord(n.out.order)}.`);
        else ackTo(n, m);
      } else {
        think(n, `${who} from ${nameOf(m.from)}: "${m.text}". No one below me, so I act on it myself and report up (${tierNote(n)}).`);
        if (n.out.report.length) fwd(n.out.report.slice(0, 1), 'report', `doing: ${m.text}`);
        else if (n.out.peer.length) fwd(n.out.peer.slice(0, 2), 'peer', `I am on: ${m.text}`);
        if (m.kind === 'prompt') reply(n, `On it: "${m.text}".`);
        else if (m.from !== 'strategist' && m.from !== n.id && !n.out.report.includes(m.from)) ackTo(n, m);
      }
      if (n.out.terms.length && m.kind === 'prompt' && /\b(terms|truce|agree|honou?r|herald)\b/i.test(m.text)) { fwd(n.out.terms, 'terms', m.text); reply(n, 'Terms sent through the Herald.'); }
    } else if (m.kind === 'report') {
      if (isTop(n)) {
        n.seen++;
        think(n, `Report from ${nameOf(m.from)}: "${m.text}". Folded into the plan (${n.seen} reports so far).`);
        if (entry.has(n.id) && n.seen % 5 === 0) reply(n, `${n.seen} reports in. Latest from ${nameOf(m.from)}: ${m.text}. Plan holds.`);
        if (n.out.order.length && /enem|help|threat|blocked|storm|low/i.test(m.text) && !/^doing:/.test(m.text)) {
          const o = /enem|threat/i.test(m.text) ? 'hold formation and assist the squad beside you' : /blocked|storm/i.test(m.text) ? 'take the other path and regroup' : 'send supplies to whoever is low';
          think(n, `That report needs an answer. New order to everyone below me: "${o}".`); n.out.order.forEach(to => bus.send(n.id, to, { kind: 'order', text: o, hops: 0, re: m.id })); innovation.push({ t, text: `${n.name} answered "${m.text}" with "${o}"` });
        }
      } else if (n.out.report.length) {
        think(n, `Report from ${nameOf(m.from)}: "${m.text}". I pass it up to ${nameOf(n.out.report[0])}.`);
        fwd(n.out.report.slice(0, 1), 'report', `${nameOf(m.from).replace(/^[AB] /, '')}: ${m.text}`);
      } else think(n, `Report from ${nameOf(m.from)} noted: "${m.text}".`);
    } else if (m.kind === 'terms') {
      if (n.out.terms.length && !entry.has(n.id) && n.role === nodes.get(m.from)?.role) return;
      if (n.roleName === 'Herald') { think(n, `Carrying terms from ${nameOf(m.from)} to the other side, word for word.`); fwd(n.out.terms.filter(id => id !== m.from), 'terms', m.text); }
      else if (/^ok:/i.test(m.text)) { think(n, `The other side agreed: "${m.text}".`); if (entry.has(n.id)) reply(n, `Terms agreed through the Herald: ${m.text.slice(3).trim()}`); innovation.push({ t, text: `Both strategists kept terms: ${m.text.slice(3).trim()}` }); }
      else { think(n, `Terms offered by the other side: "${m.text}". I accept and answer through the Herald.`); fwd(n.out.terms, 'terms', 'ok: ' + m.text); }
    } else if (m.kind === 'peer') {
      think(n, `Note from ${nameOf(m.from)}: "${m.text}". Kept in mind; peer notes are not passed on.`);
    } else if (m.kind === 'ack') {
      think(n, `${nameOf(m.from)} acknowledged.`);
    }
  }
  function ackTo(n, m) { const k = edgeKind.get(n.id + '>' + m.from); if (k) bus.send(n.id, m.from, { kind: 'ack', text: 'ack', hops: m.hops + 1, re: m.id }); }
  function roleWord(ids) {
    const by = {}; for (const id of ids) { const r = nodes.get(id); const w = r ? r.roleName.replace(/\(.*?\)/g, '').trim().toLowerCase() : 'node'; by[w] = (by[w] || 0) + 1; }
    return Object.entries(by).map(([w, c]) => `${c} ${w}${c > 1 ? 's' : ''}`).join(', ');
  }

  function setState(n, state, why) { if (n.state === state) return; n.state = state; emit('state', { node: n.id, state, why }); }

  const swarm = {
    format, nodes, bus, innovation, entry: [...entry],
    get stopped() { return stopped; }, get t() { return t; },
    on(ev, fn) { (subs[ev] || (subs[ev] = new Set())).add(fn); return () => subs[ev].delete(fn); },
    strategist(text) { if (!text.trim()) return []; return [...entry].map(id => bus.send('strategist', id, { kind: 'prompt', text })); },
    // Manual takeover: the human speaks as this node. Plain words are routed by simple rules.
    prompt(id, text) {
      const n = nodes.get(id); if (!n || !text.trim()) return [];
      const sent = [];
      const to = (ids, kind, body) => ids.forEach(x => { const m = bus.send(n.id, x, { kind, text: body }); if (m.ok) sent.push(m); });
      let m;
      if ((m = text.match(/^(?:tell|order)\s+(.+)$/i)) && n.out.order.length) { think(n, `You said: "${text}". Ordering everyone below me.`); to(n.out.order, 'order', m[1]); }
      else if ((m = text.match(/^report\s+(.+)$/i)) && n.out.report.length) { think(n, `You said: "${text}". Reporting up.`); to(n.out.report, 'report', m[1]); }
      else if ((m = text.match(/^(?:ask|note)\s+(.+)$/i)) && n.out.peer.length) { think(n, `You said: "${text}". Noting it to my peers.`); to(n.out.peer, 'peer', m[1]); }
      else if ((m = text.match(/^terms\s+(.+)$/i)) && n.out.terms.length) { think(n, `You said: "${text}". Sending terms through the Herald.`); to(n.out.terms, 'terms', m[1]); }
      else {
        const targets = n.out.order.length ? ['order', n.out.order] : n.out.report.length ? ['report', n.out.report] : n.out.peer.length ? ['peer', n.out.peer] : n.out.terms.length ? ['terms', n.out.terms] : null;
        if (!targets) think(n, `You said: "${text}". This node has no edge to send on, so it is kept as its own note.`);
        else { think(n, `You said: "${text}". Sent as ${targets[0]} to ${targets[1].length} node${targets[1].length > 1 ? 's' : ''} on my edges.`); to(targets[1], targets[0], text); }
      }
      return sent;
    },
    takeover(id, why = 'button') { const n = nodes.get(id); if (n && !stopped) { setState(n, 'manual', why); think(n, `Taken over by you (${why}). I act only on what you type.`); } },
    pause(id, why = 'button') { const n = nodes.get(id); if (n && !stopped) { setState(n, 'paused', why); think(n, `Paused (${why}). Messages wait in my inbox.`); } },
    handback(id, why = 'button') { const n = nodes.get(id); if (n && !stopped) { setState(n, 'auto', why); think(n, `Control handed back (${why}). Back on my role prompt.`); } },
    stopAll(why = 'Ctrl+Shift+Esc') { stopped = true; for (const n of nodes.values()) setState(n, 'stopped', why); emit('stop', { why }); },
    resumeAll() { stopped = false; for (const n of nodes.values()) setState(n, 'auto', 'resume'); emit('resume', {}); },
    tick() {
      if (stopped) return; t++;
      for (const n of nodes.values()) {
        if (n.state !== 'auto') continue;
        for (const m of n.inbox.splice(0, 3)) handle(n, m);
      }
      // Ambient life: a leaf reports something it saw, so the diagram moves without input.
      const leaves = [...nodes.values()].filter(n => n.state === 'auto' && !n.out.order.length && n.out.report.length);
      if (leaves.length && rand() < 0.75) { const n = leaves[Math.floor(rand() * leaves.length)]; const text = pool[Math.floor(rand() * pool.length)]; think(n, `I noticed: ${text}. Reporting up.`); bus.send(n.id, n.out.report[0], { kind: 'report', text }); }
    },
  };
  return swarm;
}
