// Built by scripts/build-swarm.mjs from swarm/core/message.mjs. Do not edit here.
// SMILE message format for the swarm.
// Every message body is a SMILE response: a name tag line, then "# Section" blocks.
// Prompt-language marks ( (: [= [: (-: ) never appear in a response; if they do, the
// node has not understood the Smile (register D3) and the message is marked bad.
let seq = 0;
export const PROMPT_MARKS = /^\s*(\(:|\(-:|\[=|\[:|\(;|\) End |\] End )/m;

export function nextId(prefix = 'm') { return `${prefix}${(++seq).toString(36)}`; }
export function resetIds() { seq = 0; }

// Replaces [$slot$] markers. Unknown slots are left in place so a test can spot them.
export function fillSlots(text, slots = {}) {
  const lower = Object.fromEntries(Object.entries(slots).map(([k, v]) => [k.toLowerCase(), v]));
  return text.replace(/\[\$([^$\]]+)\$\]/g, (m, name) => {
    const key = name.trim().toLowerCase();
    return key in lower ? String(lower[key]) : m;
  });
}

export function formatResponse(tag, sections) {
  const lines = [`${tag}:`];
  for (const [name, body] of Object.entries(sections)) lines.push(`# ${name}`, String(body ?? '').trim() || 'none');
  return lines.join('\n');
}

export function parseResponse(text) {
  const lines = String(text || '').split('\n');
  const tagLine = lines[0] || '';
  const tagMatch = tagLine.match(/^(\S+)?\s*\*\*\*(.+?)\*\*\*:\s*$/);
  const sections = {};
  let current = null;
  for (const line of lines.slice(1)) {
    const h = line.match(/^# (.+)$/);
    if (h) { current = h[1].trim(); sections[current] = ''; continue; }
    if (current !== null) sections[current] += (sections[current] ? '\n' : '') + line;
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].trim();
  return { ok: !!tagMatch, tag: tagMatch ? tagLine.replace(/:\s*$/, '') : null, emojis: tagMatch?.[1] || '', name: tagMatch?.[2] || null, sections };
}

// Verifiable checks from the SMILE register: E3 name tag present, D3 no prompt-syntax bleed,
// and (optionally) the expected tag and sections.
export function checkSmile(text, { tag, sections } = {}) {
  const problems = [];
  const r = parseResponse(text);
  if (!r.ok) problems.push('no name tag on the first line (E3: no agreement to the instructions)');
  if (tag && r.tag !== tag) problems.push(`name tag is "${r.tag}", expected "${tag}"`);
  if (PROMPT_MARKS.test(String(text).split('\n').slice(1).join('\n'))) problems.push('prompt-language marks in the response (D3: the Smile was not understood)');
  for (const s of sections || []) if (!(s in r.sections)) problems.push(`missing section "# ${s}"`);
  return { ok: problems.length === 0, problems, parsed: r };
}

export function makeMessage({ from, to, kind, text, tick = 0, orderId = null, ref = null, hops = 0, meta = {} }) {
  return { id: nextId(), tick, from, to, kind, text, orderId, ref, hops, meta };
}

// Operator prompt → orders. Deterministic, tier 1. Returns [] when nothing parses so the
// router can escalate to a higher tier.
export const PLACES = ['lavas', 'bank', 'fishing', 'north', 'south', 'east', 'west', 'gate', 'altar', 'mine', 'trees', 'home'];
const VERBS = [
  ['hold', /\b(hold|stay|defend|guard|camp)\b/], ['move', /\b(move|go|walk|head|run|travel)\b/],
  ['attack', /\b(attack|push|engage|fight|pk|kill|hunt|rush)\b/], ['retreat', /\b(retreat|fall back|fallback|pull back|flee|escape|disengage)\b/],
  ['watch', /\b(watch|scout|look|spot|patrol|observe)\b/], ['gather', /\b(gather|fish|mine|chop|collect|skill|farm|harvest)\b/],
  ['supply', /\b(supply|resupply|deliver|feed|bring)\b/], ['regroup', /\b(regroup|rally|gather up|form up)\b/],
  ['freeze', /\b(freeze|snare|bind|barrage)\b/], ['bank', /\b(bank|deposit|store)\b/],
];
export function parseOrders(text, { tick = 0, seed = '' } = {}) {
  const clauses = String(text || '').toLowerCase().split(/[;.\n]|,\s*(?=\w+\s)|\band\b(?=\s+(?:the\s+)?(?:mages?|scouts?|skillers?|all|everyone))/).map(s => s.trim()).filter(Boolean);
  const orders = [];
  clauses.forEach((c, i) => {
    const who = /\b(mages?|pkers?|fighters?)\b/.test(c) ? 'mages' : /\bscouts?\b/.test(c) ? 'scouts' : /\b(skillers?|gatherers?|fishers?)\b/.test(c) ? 'skillers' : 'all';
    const verb = (VERBS.find(([, re]) => re.test(c)) || [])[0] || (who === 'skillers' && /\bfish|mine|chop\b/.test(c) ? 'gather' : null);
    if (!verb) return;
    const target = PLACES.find(p => new RegExp(`\\b${p}\\b`).test(c)) || (c.match(/\b(?:to|at|on|near|from)\s+(?:the\s+)?([a-z]+)/) || [])[1] || null;
    orders.push({ id: `o${hash(`${seed}|${tick}|${i}|${c}`)}`, who, verb, target, raw: c });
  });
  return orders;
}
export function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
export function orderWords(o) { return `${o.who} ${o.verb}${o.target ? ' ' + o.target : ''}`; }
