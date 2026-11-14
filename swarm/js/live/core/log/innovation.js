// Built by scripts/build-swarm.mjs from swarm/core/log/innovation.mjs. Do not edit here.
// Innovation log: what the team did differently, in plain words. GP is a side note.
// Reads world events and bus messages each tick, then writes a run entry naming the
// tactics, formations, scout tricks and supply lines it saw, and which were new.
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class InnovationLog {
  constructor({ history = null } = {}) {
    this.history = new Set(history || []);     // signatures seen in earlier runs
    this.orderLines = []; this.events = []; this.freezes = []; this.sightings = new Map(); this.contacts = [];
    this.formationTicks = { tight: 0, line: 0, scattered: 0 }; this.supplies = 0; this.kills = 0; this.deaths = 0; this.gp = 0; this.fish = 0;
    this.relays = 0; this.messages = 0; this.firstDelivery = null; this.hopsMax = 0; this.smileBad = 0; this.ticks = 0; this.manualTicks = 0; this.pausedTicks = 0;
  }
  orders(orders, text, tick) { this.orderLines.push({ tick, text, orders: orders.map(o => `${o.who} ${o.verb}${o.target ? ' ' + o.target : ''}`) }); }
  observe({ tick, events, messages, nodes, adapter }) {
    this.ticks++;
    for (const e of events) {
      if (e.type === 'freeze' && e.hit) this.freezes.push(e);
      if (e.type === 'sight') { if (!this.sightings.has(e.enemy)) this.sightings.set(e.enemy, { tick, by: e.by, dist: e.dist }); }
      if (e.type === 'hit') { const s = this.sightings.get(e.from); if (s && !s.contact) { s.contact = tick; this.contacts.push({ enemy: e.from, warning: tick - s.tick, by: s.by }); } }
      if (e.type === 'supply') this.supplies++;
      if (e.type === 'kill') { this.kills++; this.gp += e.loot || 0; }
      if (e.type === 'death') this.deaths++;
      if (e.type === 'bank') { this.gp += e.gp || 0; this.fish += e.items || 0; }
    }
    for (const m of messages) { this.messages++; if (m.hops > 0) this.relays++; this.hopsMax = Math.max(this.hopsMax, m.hops); if (m.meta && m.meta.smile === false) this.smileBad++; }
    for (const n of nodes) { if (n.mode === 'manual') this.manualTicks++; if (n.mode === 'paused') this.pausedTicks++; }
    // formation of the mages while any enemy is near them
    if (adapter?.observe) {
      const mages = nodes.filter(n => n.member?.kind === 'mage').map(n => adapter.observe(n.member.id)).filter(o => o && o.hp > 0);
      const engaged = mages.filter(o => o.nearby.some(x => x.side === 'enemy' && x.dist <= 10));
      if (engaged.length >= 2) {
        let sum = 0, pairs = 0;
        for (let i = 0; i < engaged.length; i++) for (let j = i + 1; j < engaged.length; j++) { sum += dist(engaged[i].pos, engaged[j].pos); pairs++; }
        const mean = sum / pairs;
        this.formationTicks[mean < 3 ? 'tight' : mean <= 8 ? 'line' : 'scattered']++;
      }
    }
  }
  tactics(format) {
    const t = [];
    const name = (n, words, detail = '') => t.push({ name: n, words, detail, signature: `${format.id}:${n}` });
    for (const o of this.orderLines) for (const line of o.orders) name(`order ${line}`, `The operator asked: "${line}" and the ${format.title} carried it through ${format.leader}.`);
    // chain freezes: two different mages freezing the same target within 3 ticks
    const chains = new Set();
    for (let i = 0; i < this.freezes.length; i++) for (let j = i + 1; j < this.freezes.length; j++) { const a = this.freezes[i], b = this.freezes[j]; if (a.to === b.to && a.from !== b.from && Math.abs(a.tick - b.tick) <= 3) chains.add(a.to); }
    if (chains.size) name('chain freeze', `Two or more mages froze the same target within three ticks (${chains.size} target${chains.size > 1 ? 's' : ''}), so it never got a step.`);
    const warned = this.contacts.filter(c => c.warning >= 2);
    if (warned.length) { const avg = Math.round(warned.reduce((a, c) => a + c.warning, 0) / warned.length); name('scout early warning', `Scouts called ${warned.length} enemy ${warned.length > 1 ? 'arrivals' : 'arrival'} on average ${avg} ticks before first contact.`); }
    if (this.supplies) name('supply line', `Skillers ran ${this.supplies} ${this.supplies > 1 ? 'deliveries' : 'delivery'} of food to the fighters at the front.`);
    const f = this.formationTicks, total = f.tight + f.line + f.scattered;
    if (total) { const top = Object.entries(f).sort((a, b) => b[1] - a[1])[0]; const words = { tight: 'a tight ball (stacked on the same tiles)', line: 'a spread line (three to eight tiles apart)', scattered: 'scattered (more than eight tiles apart)' }; name(`formation ${top[0]}`, `While fighting, the mages mostly held ${words[top[0]]}: ${Math.round(100 * top[1] / total)}% of engaged ticks.`); }
    if (this.relays) name(`relay depth ${this.hopsMax}`, `Orders travelled up to ${this.hopsMax} hops along permitted edges only (${this.relays} relays, ${this.messages} messages).`);
    if (this.manualTicks) name('operator takeover', `A person took single nodes over by chat for ${this.manualTicks} node-ticks; the rest of the swarm kept its orders.`);
    return t;
  }
  finish({ format, metrics, prompts = [], adapter = null }) {
    const tactics = this.tactics(format).map(x => ({ ...x, firstSeen: !this.history.has(x.signature) }));
    for (const x of tactics) this.history.add(x.signature);
    const entry = {
      format: { id: format.id, title: format.title, family: format.family }, ticks: this.ticks, prompts: prompts.map(p => p.text),
      tactics, newCount: tactics.filter(x => x.firstSeen).length,
      cooperation: metrics.cooperation, harmony: metrics.harmony, gathering: metrics.gathering, smileClean: metrics.smileClean,
      sideNote: { gp: this.gp, kills: this.kills, deaths: this.deaths, fish: this.fish },
      words: format.smileMetrics,
    };
    entry.text = render(entry);
    return entry;
  }
  signatures() { return [...this.history]; }
}

export function render(e) {
  const lines = [];
  lines.push(`Run on ${e.format.title} (${e.format.id}, ${e.format.family} family), ${e.ticks} ticks.`);
  if (e.prompts.length) lines.push(`Prompts: ${e.prompts.map(p => `"${p}"`).join('; ')}.`);
  lines.push('');
  lines.push('What the team did differently:');
  if (!e.tactics.length) lines.push('  nothing recorded yet; give the swarm an order and run a few ticks.');
  for (const t of e.tactics) lines.push(`  ${t.firstSeen ? 'NEW ' : '    '}${t.name}: ${t.words}`);
  lines.push('');
  lines.push(`Cooperation ${e.cooperation} (${e.words?.cooperation || ''})`);
  lines.push(`Harmony ${e.harmony} (${e.words?.harmony || ''})`);
  lines.push(`Gathering ${e.gathering?.ticks ?? '-'} ticks, ${e.gathering?.hops ?? 0} hops (${e.words?.gathering || ''})`);
  lines.push(`SMILE-clean messages: ${Math.round((e.smileClean ?? 1) * 100)}%`);
  lines.push('');
  lines.push(`Side note: ${e.sideNote.gp.toLocaleString('en-GB')} gp, ${e.sideNote.kills} kills, ${e.sideNote.deaths} deaths, ${e.sideNote.fish} fish. GP is a side note, innovation is the measure.`);
  return lines.join('\n');
}
