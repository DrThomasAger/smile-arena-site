// Built by scripts/build-swarm.mjs from swarm/core/policies.mjs. Do not edit here.
// Tier 1 deterministic policies: what each seat does with its inbox each tick.
// Leader: operator prompt -> orders out. Control: relay orders down and reports up.
// Store (virtual blackboard): mirror everything to every reader. Body: act on orders
// in the world through the adapter and report Done/Blocked.
import { parseOrders, orderWords, parseResponse } from './message.js';
import { OPERATOR } from './bus.js';

// "terms: no attacks at the spawn" from the operator: the leader sends the terms as a note to its note
// neighbours (clan war: the Herald), a control seat carries them on word for word, the other leader
// agrees with a note back, and the leader who offered tells the operator.
const TERMS = /^\s*terms\s*[:\-]\s*(.+?)\s*$/i;

const KIND_OF_WHO = { mages: 'mage', scouts: 'scout', skillers: 'skiller' };
export function orderFor(order, kind) { return order.who === 'all' || KIND_OF_WHO[order.who] === kind; }

export async function deterministic({ node, context }) {
  const { inbox, tick } = context;
  const out = [];
  let action = null;
  let think = '';
  const seen = node.state.seenOrders, seenReports = node.state.seenReports;

  for (const msg of inbox) {
    if (msg.kind === 'stop') { node.mode = 'stopped'; node.state.order = null; think += 'stopped. '; continue; }
    if (msg.kind === 'chat') {
      const terms = msg.text.match(TERMS);
      if (terms) {
        const heralds = (context.sideways?.() || []).filter(id => context.seatOf?.(id) !== 'body');
        if (!heralds.length) { out.push({ to: msg.from, kind: 'chat', sections: { Done: 'none', Blocked: 'I have no one to carry terms to in this format.' } }); continue; }
        for (const to of heralds) out.push({ to, kind: 'note', ref: msg.id, sections: { Terms: terms[1], From: node.id } });
        out.push({ to: msg.from, kind: 'chat', sections: { Done: `terms offered: ${terms[1]} (through ${heralds.join(', ')})`, Blocked: 'none' } });
        think += 'terms offered. ';
        continue;
      }
      const orders = parseOrders(msg.text, { tick, seed: node.seat === 'leader' ? 'leader' : node.id });
      if (/^\s*(status|report|where are you|what are you doing)\??\s*$/i.test(msg.text)) {
        out.push({ to: msg.from, kind: 'chat', sections: statusSections(node, context) });
        continue;
      }
      if (!orders.length) {
        if (node.tier > 1) return null; // escalate: this needs judgement
        out.push({ to: msg.from, kind: 'chat', sections: { Done: 'none', Blocked: `I did not understand "${msg.text}". Orders I know: hold, move, attack, retreat, watch, gather, bank, supply, regroup, freeze, with a place (${['lavas', 'bank', 'fishing', 'north'].join(', ')}).` } });
        continue;
      }
      if (node.seat === 'leader' && msg.from === OPERATOR) {
        for (const o of orders) { seen.add(o.id); node.state.issued.push({ ...o, tick }); }
        for (const to of context.downstream('order')) for (const o of orders) out.push({ to, kind: 'order', orderId: o.id, meta: { order: o }, sections: leaderSections(node, orders, o, context) });
        out.push({ to: msg.from, kind: 'chat', sections: { [node.roleSpec.sections[0] || 'Orders']: orders.map(orderWords).join('\n'), Cooperation: context.cooperationLine?.() || 'no returns yet' } });
        think += `issued ${orders.length} order(s). `;
      } else {
        // a node chatted to directly: it follows only the operator now (manual), the order is its own
        const mine = orders.filter(o => node.kind ? orderFor(o, node.kind) || o.who !== 'all' : true);
        const o = mine[0] || orders[0];
        if (node.seat === 'body') adopt(node, { ...o, who: 'all' }, tick, 'operator');
        else { for (const to of context.downstream('order')) out.push({ to, kind: 'order', orderId: o.id, meta: { order: o }, sections: { [node.roleSpec.sections[0] || 'Orders']: orderWords(o), [node.roleSpec.sections[1] || 'Report Up']: 'relayed from my own chat' } }); seen.add(o.id); }
        out.push({ to: msg.from, kind: 'chat', sections: { Done: `taking order: ${orderWords(o)}`, Blocked: 'none' } });
        think += `manual order ${o.verb}. `;
      }
      continue;
    }
    if (msg.kind === 'order' || (msg.kind === 'field' && msg.orderId)) {
      const o = msg.meta?.order;
      if (!o || seen.has(o.id)) continue;
      seen.add(o.id);
      node.state.hops = Math.max(node.state.hops, msg.hops + 1);
      if (node.seat === 'body' && node.mode === 'auto' && orderFor(o, node.kind)) {
        adopt(node, o, tick, msg.from);
        for (const to of context.upstream('report')) out.push({ to, kind: 'report', orderId: o.id, ref: msg.id, sections: bodySections(node, `taking order: ${orderWords(o)}`, 'none') });
      }
      // relay onward to everyone the format lets me reach, except where it came from
      for (const to of context.downstream(node.seat === 'store' ? 'field' : 'order')) {
        if (to === msg.from) continue;
        out.push({ to, kind: node.seat === 'store' ? 'field' : 'order', orderId: o.id, ref: msg.id, hops: msg.hops + 1, meta: { order: o }, sections: relaySections(node, o) });
      }
      continue;
    }
    if (msg.kind === 'note') {
      const sec = parseResponse(msg.text).sections;
      if (!sec.Terms) continue;
      const key = msg.ref || msg.id;
      if (seenReports.has(key)) continue;
      seenReports.add(key);
      if (node.seat === 'leader') {
        if (sec.Agreed) { out.push({ to: OPERATOR, kind: 'chat', sections: { Done: `terms agreed through ${msg.from}: ${sec.Terms}`, Blocked: 'none' } }); think += 'terms agreed. '; }
        else { out.push({ to: msg.from, kind: 'note', ref: `${key}-agreed`, sections: { Terms: sec.Terms, Agreed: 'yes', From: node.id } }); think += 'terms accepted. '; }
        continue;
      }
      for (const to of (context.sideways?.() || [])) if (to !== msg.from && to !== sec.From) out.push({ to, kind: 'note', ref: key, hops: msg.hops + 1, text: msg.text, carried: true });
      think += 'carried terms. ';
      continue;
    }
    if (msg.kind === 'report' || (msg.kind === 'field' && !msg.orderId)) {
      const key = msg.ref || msg.id;
      if (seenReports.has(key)) continue;
      seenReports.add(key);
      node.state.reports.push({ tick, from: msg.from, orderId: msg.orderId, text: msg.text });
      if (node.state.reports.length > 200) node.state.reports.shift();
      if (node.seat === 'leader' || node.seat === 'body') continue; // reports climb through control seats only
      for (const to of context.upstream(node.seat === 'store' ? 'field' : 'report')) {
        if (to === msg.from) continue;
        out.push({ to, kind: node.seat === 'store' ? 'field' : 'report', orderId: msg.orderId, ref: key, hops: msg.hops + 1, text: msg.text, carried: true });
      }
    }
  }

  // body: act in the world on the current order
  if (node.seat === 'body' && node.mode !== 'stopped' && node.mode !== 'paused' && context.observe) {
    const r = bodyAct(node, context);
    action = r.action;
    if (r.report) for (const to of (node.mode === 'manual' ? [OPERATOR] : context.upstream('report'))) out.push({ to, kind: to === OPERATOR ? 'chat' : 'report', orderId: node.state.order?.id || null, sections: bodySections(node, r.report.done, r.report.blocked) });
    think += r.think || '';
  }
  return { messages: out, action, think: think.trim() };
}

function adopt(node, o, tick, from) {
  node.state.order = o; node.state.orderTick = tick; node.state.orderTicks.set(o.id, tick); node.state.orderFrom = from; node.state.arrived = false; node.state.lastSight = ''; node.state.acted = (node.state.acted || 0) + 1;
}
function leaderSections(node, orders, o, context) {
  const s = node.roleSpec.sections;
  const obj = {};
  obj[s[0] || 'Orders'] = orders.map(orderWords).join('\n');
  if (s.length > 2) obj[s[s.length - 2]] = `this order: ${orderWords(o)}`;
  obj[s[s.length - 1] || 'Cooperation'] = context.cooperationLine?.() || 'no returns yet';
  return obj;
}
function relaySections(node, o) {
  const s = node.roleSpec.sections;
  return { [s[0] || 'Orders']: orderWords(o), [s[1] || 'Report Up']: `relayed order ${o.id}` };
}
function bodySections(node, done, blocked) {
  const s = node.roleSpec.sections;
  return { [s[0] || 'Done']: done, [s[1] || 'Blocked']: blocked };
}
function statusSections(node, context) {
  const obs = context.observe?.();
  return {
    Status: `${node.id} (${node.role}${node.member ? ', ' + node.member.name : ''}) mode ${node.mode}, tier ${node.tier}`,
    Order: node.state.order ? orderWords(node.state.order) : 'none',
    World: obs ? `at ${obs.place || `${obs.pos.x},${obs.pos.y}`}, hp ${obs.hp}/${obs.maxHp}, ${obs.nearby.filter(n => n.side === 'enemy').length} enemies in sight` : 'no body',
    Inbox: `${node.transcript.filter(t => t.dir === 'in').length} in, ${node.transcript.filter(t => t.dir === 'out').length} out`,
  };
}

// ---- body behaviour in the world (same for sim and game adapters) ----
function bodyAct(node, context) {
  const obs = context.observe();
  const o = node.state.order;
  const st = node.state;
  if (!obs) return { action: null };
  if (obs.hp <= 0) { if (!st.dead) { st.dead = true; return { action: null, report: { done: 'none', blocked: 'I am down' } }; } return { action: null }; }
  const enemies = obs.nearby.filter(n => n.side === 'enemy').sort((a, b) => a.dist - b.dist);
  const allies = obs.nearby.filter(n => n.side === 'ally');
  const low = obs.hp < obs.maxHp * 0.3;
  let report = null;

  if (node.kind === 'scout') {
    const names = enemies.map(e => `${e.id}@${e.pos.x},${e.pos.y}`).join(' ');
    if (enemies.length && names !== st.lastSight) { st.lastSight = names; report = { done: `sighted ${enemies.length} enemy: ${names}`, blocked: 'none' }; }
  }
  if (!o) return { action: { type: 'hold' }, report };

  if (low && o.verb !== 'retreat') {
    st.resume = o;
    st.order = { ...o, verb: 'retreat', target: 'bank', raw: 'auto retreat' };
    return { action: { type: 'move', to: 'bank' }, report: { done: 'none', blocked: `hp ${obs.hp}, retreating to bank` }, think: 'low hp' };
  }
  if (o.verb === 'retreat' && st.resume && obs.place === 'bank' && obs.hp >= obs.maxHp * 0.8) {
    st.order = st.resume; st.resume = null; st.arrived = false;
    return { action: { type: 'hold' }, report: { done: `healed, back to: ${orderWords(st.order)}`, blocked: 'none' }, think: 'healed' };
  }
  // scouts watch from a distance: step away from anything within four tiles
  if (node.kind === 'scout' && enemies.length && enemies[0].dist <= 4 && o.verb !== 'retreat') {
    const e = enemies[0].pos, away = { x: obs.pos.x + Math.sign(obs.pos.x - e.x || 1) * 6, y: obs.pos.y + Math.sign(obs.pos.y - e.y || 1) * 6 };
    return { action: { type: 'move', to: away }, report, think: 'kiting' };
  }
  const target = o.target && context.places?.[o.target] ? o.target : null;
  const arrive = () => { if (!st.arrived && target && obs.place === target) { st.arrived = true; report = { done: `arrived at ${target}`, blocked: 'none' }; } };

  switch (o.verb) {
    case 'retreat': return { action: { type: 'move', to: target || 'bank' }, report };
    case 'bank': return { action: obs.place === 'bank' ? { type: 'bank' } : { type: 'move', to: 'bank' }, report };
    case 'gather':
      if (node.kind !== 'skiller') return { action: target ? { type: 'move', to: target } : { type: 'hold' }, report };
      if (obs.inventory >= obs.inventoryMax) return { action: obs.place === 'bank' ? { type: 'bank' } : { type: 'move', to: 'bank' }, report, think: 'full, banking' };
      arrive();
      return { action: obs.place === (target || 'fishing') ? { type: 'gather' } : { type: 'move', to: target || 'fishing' }, report };
    case 'supply': {
      const mage = allies.filter(a => a.kind === 'mage').sort((a, b) => a.dist - b.dist)[0];
      if (obs.inventory <= 0) return { action: obs.place === 'fishing' ? { type: 'gather' } : { type: 'move', to: 'fishing' }, report };
      if (!mage) return { action: { type: 'move', to: target || 'lavas' }, report };
      if (mage.dist <= 1) return { action: { type: 'supply', target: mage.id }, report: { done: `supplied ${mage.id}`, blocked: 'none' } };
      return { action: { type: 'move', to: mage.pos }, report };
    }
    case 'watch':
      arrive();
      return { action: target && obs.place !== target ? { type: 'move', to: target } : { type: 'hold' }, report };
    case 'attack': case 'freeze': {
      if (node.kind === 'mage' && enemies.length) return { action: cast(enemies[0], o.verb === 'freeze'), report: kills(node, context, report) };
      if (enemies.length) return { action: { type: 'move', to: enemies[0].pos }, report };
      arrive();
      return { action: target && obs.place !== target ? { type: 'move', to: target } : { type: 'hold' }, report };
    }
    case 'hold': case 'move': case 'regroup': default: {
      if (node.kind === 'mage' && enemies.length && enemies[0].dist <= 10) return { action: cast(enemies[0], false), report: kills(node, context, report) };
      arrive();
      return { action: target && obs.place !== target ? { type: 'move', to: target } : { type: 'hold' }, report };
    }
  }
}
function cast(enemy, forceFreeze) { return { type: 'cast', spell: forceFreeze || !enemy.frozen ? 'freeze' : 'blast', target: enemy.id }; }
function kills(node, context, report) {
  const k = context.observe().kills || 0;
  if (k > (node.state.kills || 0)) { node.state.kills = k; return { done: `kill ${k}`, blocked: 'none' }; }
  return report;
}
