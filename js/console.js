// Strategist console mockup. Orders are parsed by tier-1 deterministic rules:
// find a role, find a direction word, move that role's slider one or two steps.
// Orders and the sangha's replies are spoken (js/speak.js) while the console's 🔊 toggle is on.
import * as voice from './speak.js';
export const ROLES = [
  { id: 'vanguard', name: 'Vanguard', words: ['vanguard', 'melee', 'front', 'tanks?'], low: 'Hold the line', high: 'All-in charge', v: 3 },
  { id: 'healers', name: 'Healers', words: ['healers?', 'support', 'priests?'], low: 'Stay back', high: 'Heal at the front', v: 2 },
  { id: 'rangers', name: 'Rangers', words: ['rangers?', 'archers?', 'range'], low: 'Cover from range', high: 'Chase targets', v: 3 },
  { id: 'mages', name: 'Mages', words: ['mages?', 'magic', 'casters?'], low: 'Save runes', high: 'Burst everything', v: 3 },
  { id: 'scouts', name: 'Scouts', words: ['scouts?', 'runners?'], low: 'Report only', high: 'Harass deep', v: 2 },
  { id: 'suppliers', name: 'Suppliers', words: ['suppl(y|iers?)', 'gatherers?', 'miners?', 'cooks?'], low: 'Stock the base', high: 'Run food to the front', v: 3 },
];
const UP = /\b(push|charge|attack|aggressive|forward|all[- ]in|engage|chase|burst|go|harass|front|rush)\b/i;
const DOWN = /\b(hold|back|retreat|defen[cs]e|defensive|careful|wait|save|stay|guard|regroup|fall back|cautious)\b/i;
const STRONG = /\b(all|everyone|now|hard|full)\b/i;

export function parseOrder(text, roles = ROLES) {
  const changes = [];
  // Split on commas, "and", "then" so each clause can address a different role.
  for (const clause of text.split(/,|;|\band\b|\bthen\b/i)) {
    const up = UP.test(clause), down = DOWN.test(clause);
    if (up === down) continue;
    const step = (STRONG.test(clause) ? 2 : 1) * (up ? 1 : -1);
    let hit = roles.filter(r => new RegExp('\\b(' + r.words.join('|') + ')\\b', 'i').test(clause));
    if (!hit.length && /\b(everyone|all|sangha|team|clan)\b/i.test(clause)) hit = roles;
    for (const r of hit) changes.push({ id: r.id, step });
  }
  return changes;
}

function el(id) { return document.getElementById(id); }

function mount() {
  if (!el('sliders')) return;
  const roles = ROLES.map(r => ({ ...r }));
  const log = el('log');
  const t0 = Date.now();
  const stamp = () => { const s = Math.floor((Date.now() - t0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const say = (cls, who, msg, { quiet = false } = {}) => {
    if (!quiet) voice.callout('orders', (who === 'strategist' ? `Order: ${msg}` : msg).replace(/→/g, ' to '), { priority: 'normal' });
    const d = document.createElement('div');
    d.innerHTML = `<span class="t">[${stamp()}]</span> <span class="${cls}">${who}</span> ${msg.replace(/</g, '&lt;')}`;
    log.append(d); log.scrollTop = log.scrollHeight;
  };
  const draw = () => {
    el('sliders').innerHTML = roles.map(r => `
      <div class="slider">
        <label class="name" for="sl-${r.id}">${r.name} <span class="lvl">${r.v}</span></label>
        <input type="range" id="sl-${r.id}" min="1" max="5" step="1" value="${r.v}" aria-valuetext="${r.v}: ${r.v <= 2 ? r.low : r.v >= 4 ? r.high : 'balanced'}">
        <div class="poles"><span>1 ${r.low}</span><span>${r.high} 5</span></div>
      </div>`).join('');
    roles.forEach(r => el('sl-' + r.id).addEventListener('input', e => {
      r.v = Number(e.target.value); draw(); say('s', 'strategist', `set ${r.name} to ${r.v}`);
    }));
  };
  draw();
  const tg = voice.toggleButton('orders', 'Speak orders', true, { className: 'btn sm speak-toggle' });
  if (el('mode')) el('mode').parentElement.append(tg);
  say('a', 'sangha', '250 agents online in 6 roles. Waiting for orders.', { quiet: true });

  const send = text => {
    if (!text.trim()) return;
    say('s', 'strategist', text);
    const ch = parseOrder(text, roles);
    if (!ch.length) { say('a', 'sangha', 'No role or direction recognised by tier 1. In a real match this order would go up to the foundation tier.'); return; }
    for (const c of ch) {
      const r = roles.find(x => x.id === c.id);
      const before = r.v; r.v = Math.max(1, Math.min(5, r.v + c.step));
      say('a', 'sangha', `${r.name} ${before} → ${r.v} (${r.v <= 2 ? r.low : r.v >= 4 ? r.high : 'balanced'})`);
    }
    draw();
  };
  el('say').addEventListener('submit', e => { e.preventDefault(); send(el('order').value); el('order').value = ''; });
  const ex = ['Healers stay back, vanguard push the east bridge', 'Everyone hold and regroup', 'Mages burst now and rangers cover', 'Suppliers run food to the front'];
  el('examples').innerHTML = ex.map(x => `<button class="btn sm" type="button">${x}</button>`).join('');
  el('examples').querySelectorAll('button').forEach(b => b.addEventListener('click', () => send(b.textContent)));

  let auto = false;
  const setMode = (a, why) => {
    if (a === auto) return; auto = a;
    el('mode').textContent = auto ? 'AUTO · sangha in control' : 'MANUAL';
    el('mode').className = 'pill ' + (auto ? 'warn' : 'ok');
    say('a', 'sangha', auto ? `Auto mode (${why}). The sangha acts on the current intent; type to prompt it.` : `Manual mode (${why}).`);
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'F8') { e.preventDefault(); setMode(!auto, 'F8'); }
    if (e.key === 'Escape' && e.ctrlKey && e.shiftKey) say('a', 'sangha', 'STOP: all agents halted (Ctrl+Shift+Esc).', { quiet: true }); // speech stops too
  });
}
if (typeof document !== 'undefined') mount();
