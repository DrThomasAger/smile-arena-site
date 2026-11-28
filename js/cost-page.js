import { DEFAULTS, PRICE_PRESETS, PRICES_AS_OF, TIERS, clone, estimate, per1000v1000Hour, fmtUSD, fmtInt, localPricePerM } from './cost-model.js';

const KEY = 'smile-arena-cost-v1';
const $ = id => document.getElementById(id);
const COLORS = { t1: 'var(--c2)', t2: 'var(--c1)', t3: 'var(--c3)', t4: 'var(--c4)', t5: 'var(--c0)', strategist: 'var(--c5)', servers: 'var(--c6)' };
const SIMPLE = ['agentsPerSide', 'sides', 'matchMinutes', 'decisionsPerAgentPerMin', 'smallTokensIn', 'smallTokensOut', 'llmTokensIn', 'llmTokensOut',
  'cacheHitShare', 'strategistCallsPerMin', 'strategistTokensIn', 'strategistTokensOut', 'agentsPerWorld', 'vcpuPerWorld', 'botsPerVcpu', 'dollarsPerVcpuHour', 'cooperativeShare'];

let state = load();
let view = 'cost';

function load() {
  const base = clone(DEFAULTS);
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('agents')) base.agentsPerSide = Number(q.get('agents'));
    if (q.has('sides')) base.sides = Number(q.get('sides'));
    if (q.has('minutes')) base.matchMinutes = Number(q.get('minutes'));
    if (q.toString()) return base;
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) return { ...base, ...saved, share: { ...base.share, ...saved.share }, gpu: { ...base.gpu, ...saved.gpu } };
  } catch { /* storage unavailable */ }
  return base;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }

function buildForm() {
  $('asof').textContent = PRICES_AS_OF;
  $('shares').innerHTML = TIERS.map(t => `
    <div class="slider">
      <label class="name" for="sh-${t.id}">${t.id.toUpperCase()} ${t.name}</label>
      <div class="row" style="flex-wrap:nowrap"><input type="range" id="sh-${t.id}" min="0" max="100" step="0.5"><input type="number" id="shn-${t.id}" min="0" max="100" step="0.5" style="width:76px" aria-label="${t.name} share"></div>
      <div class="poles"><span>${t.note}</span></div>
    </div>`).join('');
  $('gpus').innerHTML = ['t2', 't3', 't4'].map(id => `
    <label class="f">${id.toUpperCase()} GPU $/hour <input type="number" id="g-${id}-h" min="0" step="0.05"></label>
    <label class="f">${id.toUpperCase()} tokens/s <input type="number" id="g-${id}-t" min="1" step="100"></label>`).join('');
  const opts = Object.entries(PRICE_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('foundationModel').innerHTML = opts;
  $('strategistModel').innerHTML = opts;
}

function fill() {
  for (const k of SIMPLE) $(k).value = state[k];
  for (const t of TIERS) { $('sh-' + t.id).value = state.share[t.id]; $('shn-' + t.id).value = state.share[t.id]; }
  for (const id of ['t2', 't3', 't4']) { $(`g-${id}-h`).value = state.gpu[id].dollarsPerHour; $(`g-${id}-t`).value = state.gpu[id].tokensPerSec; }
  $('foundationModel').value = state.foundationModel; $('strategistModel').value = state.strategistModel;
  for (const [pre, obj] of [['f', state.foundation], ['s', state.strategist]]) {
    $(pre + '-in').value = obj.in; $(pre + '-cachedIn').value = obj.cachedIn; $(pre + '-out').value = obj.out;
  }
}

function readForm(e) {
  const num = id => { const v = parseFloat($(id).value); return isFinite(v) ? v : 0; };
  for (const k of SIMPLE) state[k] = num(k);
  for (const t of TIERS) {
    if (e && e.target.id === 'sh-' + t.id) $('shn-' + t.id).value = $('sh-' + t.id).value;
    if (e && e.target.id === 'shn-' + t.id) $('sh-' + t.id).value = $('shn-' + t.id).value;
    state.share[t.id] = num('shn-' + t.id);
  }
  for (const id of ['t2', 't3', 't4']) state.gpu[id] = { dollarsPerHour: num(`g-${id}-h`), tokensPerSec: Math.max(1, num(`g-${id}-t`)) };
  for (const [sel, pre, key, modelKey] of [['foundationModel', 'f', 'foundation', 'foundationModel'], ['strategistModel', 's', 'strategist', 'strategistModel']]) {
    if (e && e.target.id === sel) {
      state[modelKey] = $(sel).value; state[key] = { ...PRICE_PRESETS[state[modelKey]] };
      $(pre + '-in').value = state[key].in; $(pre + '-cachedIn').value = state[key].cachedIn; $(pre + '-out').value = state[key].out;
    } else {
      const edited = e && e.target.id && e.target.id.startsWith(pre + '-');
      state[key] = { ...state[key], in: num(pre + '-in'), cachedIn: num(pre + '-cachedIn'), out: num(pre + '-out') };
      if (edited) { state[modelKey] = 'custom'; state[key].label = 'Custom'; state[key].source = 'your numbers'; $(sel).value = 'custom'; }
    }
  }
}

function render() {
  const r = estimate(state);
  const big = per1000v1000Hour(state);
  $('total').textContent = view === 'cost' ? fmtUSD(r.total) : fmtInt(r.cooperationPerDollar) + ' / $';
  $('o-agents').textContent = fmtInt(r.agents);
  $('o-decisions').textContent = fmtInt(r.decisions);
  $('o-aph').textContent = fmtUSD(r.perAgentHour);
  $('o-big').textContent = fmtUSD(big.total);
  $('o-servers').textContent = `${r.worlds} · ${r.vcpu}`;
  const max = Math.max(...r.rows.map(x => x.cost), 1e-9);
  $('bars').innerHTML = r.rows.map(row => `
    <div class="bar" title="${row.label}: ${fmtUSD(row.cost)}">
      <span class="l">${row.label.replace(/ \(.*\)$/, '')}</span>
      <span class="track"><span class="fill" style="display:block;width:${(row.cost / max * 100).toFixed(2)}%;background:${COLORS[row.id]}"></span></span>
      <span class="v">${fmtUSD(row.cost)}</span>
    </div>`).join('');
  $('o-coop').textContent = fmtInt(r.cooperative);
  $('o-cpd').textContent = isFinite(r.cooperationPerDollar) ? fmtInt(r.cooperationPerDollar) : '∞';
  $('o-forb').textContent = (r.forbearance * 100).toFixed(1) + '%';
  $('o-dpl').textContent = r.llmDecisions ? fmtInt(r.decisions / r.llmDecisions) : '∞';
  $('stack').innerHTML = r.rows.filter(x => ['t1', 't2', 't3', 't4', 't5'].includes(x.id))
    .map(x => `<span title="${x.label}: ${fmtInt(x.decisions)}" style="width:${(x.decisions / Math.max(1, r.decisions) * 100).toFixed(3)}%;background:${COLORS[x.id]}"></span>`).join('');
  const sum = Object.values(state.share).reduce((a, b) => a + b, 0);
  $('share-sum').textContent = `Shares add up to ${sum.toFixed(1)}%` + (Math.abs(sum - 100) > 0.01 ? ' (normalised to 100% in the estimate).' : '.');
  $('f-src').textContent = 'Source: ' + (state.foundation.source || PRICE_PRESETS[state.foundationModel]?.source || 'your numbers') +
    `. Local T3 works out at ${fmtUSD(localPricePerM(state.gpu.t3))}/M tokens.`;
  document.body.dataset.total = r.total.toFixed(6);
}

function update(e) { readForm(e); save(); render(); }

buildForm();
fill();
render();
$('form').addEventListener('input', update);
$('form').addEventListener('change', update);
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
  const p = b.dataset.preset;
  if (p === 'reset') state = clone(DEFAULTS);
  if (p === '100') Object.assign(state, { agentsPerSide: 100, sides: 2, matchMinutes: 30 });
  if (p === '1000') Object.assign(state, { agentsPerSide: 1000, sides: 2, matchMinutes: 30 });
  if (p === 'speed') Object.assign(state, { agentsPerSide: 25, sides: 8, matchMinutes: 60 });
  fill(); save(); render();
}));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
  $('cost-view').hidden = view !== 'cost';
  $('smile-view').hidden = view !== 'smile';
  render();
}));
