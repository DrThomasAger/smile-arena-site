// Built by scripts/build-swarm.mjs from swarm/adapters/sim/index.mjs. Do not edit here.
// Simulation adapter: a small grid world with the same role API a game adapter must offer.
// No game, no network, no logins. Deterministic under a seed.
//   spawn(member)            puts a team member in the world
//   observe(memberId)        -> { pos, place, hp, maxHp, frozen, inventory, inventoryMax, kills, gp, nearby[] }
//   act(memberId, action)    -> { ok, note? }   actions: hold, move{to}, cast{spell,target}, gather, bank, supply{target}
//   tick()                   -> events[]        advances the world one tick
//   places                   named places on the grid
//   halt()                   stops everything moving
//   resume()                 lets it move again after a halt
export const PLACES = {
  lavas: { x: 32, y: 20 }, bank: { x: 8, y: 56 }, fishing: { x: 52, y: 52 }, north: { x: 32, y: 4 }, south: { x: 32, y: 60 },
  west: { x: 4, y: 32 }, east: { x: 60, y: 32 }, gate: { x: 32, y: 12 }, altar: { x: 44, y: 24 }, mine: { x: 14, y: 40 }, trees: { x: 50, y: 36 }, home: { x: 8, y: 56 },
};
export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class SimAdapter {
  constructor({ seed = 1, size = 64, opponents = 6, opponentHp = 60, spawnEvery = 40 } = {}) {
    this.rng = mulberry32(seed); this.size = size; this.places = PLACES; this.tick_ = 0; this.halted = false;
    this.ents = new Map(); this.events = []; this.opponentHp = opponentHp; this.spawnEvery = spawnEvery; this.opponentsWanted = opponents; this.opponentSeq = 0;
    this.total = { kills: 0, deaths: 0, gp: 0, fish: 0, supplies: 0 };
    for (let i = 0; i < opponents; i++) this.spawnOpponent();
  }
  spawn(member) {
    const e = { id: member.id, kind: member.kind, side: 'ally', pos: { ...PLACES.bank }, hp: 99, maxHp: 99, frozen: 0, inventory: 0, inventoryMax: 28, kills: 0, gp: 0, target: null, sight: member.kind === 'scout' ? 18 : 9, speed: member.kind === 'scout' ? 3 : 2, action: null, deaths: 0 };
    this.ents.set(member.id, e); return e;
  }
  spawnOpponent() {
    const id = `enemy-${++this.opponentSeq}`;
    const edge = Math.floor(this.rng() * 4);
    const pos = edge === 0 ? { x: Math.floor(this.rng() * this.size), y: 0 } : edge === 1 ? { x: this.size - 1, y: Math.floor(this.rng() * this.size) } : edge === 2 ? { x: Math.floor(this.rng() * this.size), y: this.size - 1 } : { x: 0, y: Math.floor(this.rng() * this.size) };
    this.ents.set(id, { id, kind: 'pker', side: 'enemy', pos, hp: this.opponentHp, maxHp: this.opponentHp, frozen: 0, sight: 9, speed: 2, action: null, kills: 0, gp: 0, inventory: 0, inventoryMax: 0 });
    return id;
  }
  placeOf(pos) { for (const [name, p] of Object.entries(PLACES)) if (name !== 'home' && dist(pos, p) <= 3) return name; return null; }
  observe(id) {
    const e = this.ents.get(id); if (!e) return null;
    const nearby = [];
    for (const o of this.ents.values()) { if (o.id === id || o.hp <= 0) continue; const d = dist(e.pos, o.pos); if (d <= e.sight) nearby.push({ id: o.id, side: o.side, kind: o.kind, pos: { ...o.pos }, dist: d, hp: o.hp, frozen: o.frozen > 0 }); }
    return { pos: { ...e.pos }, place: this.placeOf(e.pos), hp: e.hp, maxHp: e.maxHp, frozen: e.frozen > 0, inventory: e.inventory, inventoryMax: e.inventoryMax, kills: e.kills, gp: e.gp, nearby, tick: this.tick_ };
  }
  act(id, action) {
    const e = this.ents.get(id); if (!e) return { ok: false, note: 'no such body' };
    if (this.halted) return { ok: false, note: 'world halted' };
    if (e.hp <= 0) return { ok: false, note: 'down' };
    e.action = action; return { ok: true };
  }
  halt() { this.halted = true; for (const e of this.ents.values()) e.action = null; }
  resume() { this.halted = false; }
  resolveTarget(to) { if (!to) return null; if (typeof to === 'string') return PLACES[to] ? { ...PLACES[to] } : null; return { x: to.x, y: to.y }; }
  moveToward(e, target) {
    const d = dist(e.pos, target); if (d === 0) return false;
    const stepX = Math.sign(target.x - e.pos.x) * Math.min(e.speed, Math.abs(target.x - e.pos.x));
    const stepY = Math.sign(target.y - e.pos.y) * Math.min(e.speed, Math.abs(target.y - e.pos.y));
    e.pos = { x: Math.max(0, Math.min(this.size - 1, e.pos.x + stepX)), y: Math.max(0, Math.min(this.size - 1, e.pos.y + stepY)) };
    return true;
  }
  tick() {
    this.tick_++; const ev = []; const T = this.tick_;
    if (this.halted) return ev;
    // opponents: approach the nearest living ally in sight, else wander toward lavas; melee at range 1
    for (const o of this.ents.values()) {
      if (o.side !== 'enemy' || o.hp <= 0) continue;
      if (o.frozen > 0) { o.frozen--; continue; }
      let best = null, bd = Infinity;
      for (const a of this.ents.values()) if (a.side === 'ally' && a.hp > 0) { const d = dist(o.pos, a.pos); if (d < bd && d <= o.sight) { bd = d; best = a; } }
      if (best && bd <= 1) { const dmg = Math.floor(this.rng() * 13); best.hp = Math.max(0, best.hp - dmg); ev.push({ tick: T, type: 'hit', from: o.id, to: best.id, dmg }); if (best.hp === 0) { best.deaths++; this.total.deaths++; ev.push({ tick: T, type: 'death', id: best.id, by: o.id }); } }
      else this.moveToward(o, best ? best.pos : PLACES.lavas);
    }
    // allies act
    for (const e of this.ents.values()) {
      if (e.side !== 'ally' || e.hp <= 0) { if (e.side === 'ally' && e.hp <= 0 && T % 30 === 0) { e.hp = e.maxHp; e.pos = { ...PLACES.bank }; ev.push({ tick: T, type: 'respawn', id: e.id }); } continue; }
      if (e.frozen > 0) e.frozen--;
      if (this.placeOf(e.pos) === 'bank' && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + 10); // food at the bank
      const a = e.action; e.action = null;
      if (!a || a.type === 'hold') continue;
      if (a.type === 'move') { if (e.frozen > 0) continue; const t = this.resolveTarget(a.to); if (t && this.moveToward(e, t)) ev.push({ tick: T, type: 'move', id: e.id, pos: { ...e.pos }, to: typeof a.to === 'string' ? a.to : null }); continue; }
      if (a.type === 'cast') {
        const t = this.ents.get(a.target); if (!t || t.hp <= 0 || dist(e.pos, t.pos) > 10) continue;
        if (a.spell === 'freeze') { const hit = this.rng() < 0.6; if (hit) t.frozen = 5; ev.push({ tick: T, type: 'freeze', from: e.id, to: t.id, hit }); }
        else { const dmg = 5 + Math.floor(this.rng() * 21); t.hp = Math.max(0, t.hp - dmg); ev.push({ tick: T, type: 'blast', from: e.id, to: t.id, dmg }); if (t.hp === 0) { e.kills++; this.total.kills++; const loot = 50000 + Math.floor(this.rng() * 150000); e.gp += loot; this.total.gp += loot; ev.push({ tick: T, type: 'kill', from: e.id, to: t.id, loot }); } }
        continue;
      }
      if (a.type === 'gather') { if (this.placeOf(e.pos) && e.inventory < e.inventoryMax) { e.inventory++; this.total.fish++; ev.push({ tick: T, type: 'gather', id: e.id, at: this.placeOf(e.pos), inventory: e.inventory }); } continue; }
      if (a.type === 'bank') { if (this.placeOf(e.pos) === 'bank' && e.inventory > 0) { const gp = e.inventory * 100; e.gp += gp; this.total.gp += gp; ev.push({ tick: T, type: 'bank', id: e.id, items: e.inventory, gp }); e.inventory = 0; } continue; }
      if (a.type === 'supply') { const t = this.ents.get(a.target); if (t && t.hp > 0 && dist(e.pos, t.pos) <= 1 && e.inventory > 0) { const n = Math.min(5, e.inventory); e.inventory -= n; t.hp = Math.min(t.maxHp, t.hp + n * 4); this.total.supplies++; ev.push({ tick: T, type: 'supply', from: e.id, to: t.id, items: n }); } continue; }
    }
    // scouts see: emit sight events for new enemies in a scout's view
    for (const e of this.ents.values()) if (e.side === 'ally' && e.kind === 'scout' && e.hp > 0) for (const o of this.ents.values()) if (o.side === 'enemy' && o.hp > 0 && dist(e.pos, o.pos) <= e.sight) { e.seen ||= new Set(); if (!e.seen.has(o.id)) { e.seen.add(o.id); ev.push({ tick: T, type: 'sight', by: e.id, enemy: o.id, dist: dist(e.pos, o.pos) }); } }
    // keep the pressure on: replace fallen opponents now and then
    const alive = [...this.ents.values()].filter(x => x.side === 'enemy' && x.hp > 0).length;
    if (alive < this.opponentsWanted && T % this.spawnEvery === 0) ev.push({ tick: T, type: 'spawn', id: this.spawnOpponent() });
    this.events.push(...ev); if (this.events.length > 20000) this.events.splice(0, this.events.length - 20000);
    return ev;
  }
}
