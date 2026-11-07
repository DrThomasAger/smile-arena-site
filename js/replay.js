// Replay page: plays a smile-arena/match-log@1 timeline. /replays/<id>/?t=<seconds> jumps to a moment.
import { loadJSON, esc } from './shell.js';

const root = document.getElementById('replay');
const id = document.body.dataset.match || location.pathname.split('/').filter(Boolean).at(-1);
export const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const NOTABLE = { prompt: 'Order', intent: 'Translation', decision: 'Decision', objective: 'Flag', match_start: 'Start', match_end: 'End' };
const FILTERS = [['all', 'All'], ['prompt', 'Orders'], ['decision', 'Decisions'], ['objective', 'Flags']];

let log;
try { log = await loadJSON(`data/matches/${id}.json`); }
catch { root.innerHTML = `<div class="pagehead"><h1>Replay not found</h1><p class="muted">No match log for <code>${esc(id)}</code>. <a href="content.html">Back to content</a></p></div>`; throw new Error('no match ' + id); }

const m = log.match, D = m.durationSec, clans = log.clans, [A, B] = clans;
const byId = Object.fromEntries(clans.map(c => [c.id, c]));
const zoneName = Object.fromEntries(m.zones.map(z => [z.id, z.name]));
const ev = log.events;
const snaps = [{ t: 0, scores: Object.fromEntries(clans.map(c => [c.id, 0])) }, ...ev.filter(e => e.type === 'score').map(e => ({ t: e.t, scores: e.scores }))];
const end = ev.find(e => e.type === 'match_end');
if (end && snaps.at(-1).t < D) snaps.push({ t: D, scores: end.scores });
const terr = ev.filter(e => e.type === 'territory');
const coop = ev.filter(e => e.type === 'cooperation');
const kills = ev.filter(e => e.type === 'kill');
const notable = ev.filter(e => NOTABLE[e.type]);
const prompts = Object.fromEntries(ev.filter(e => e.type === 'prompt').map(e => [e.id, e]));

const lastAt = (arr, t) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].t <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; } return r; };
function scoreAt(t) {
  const i = Math.max(0, lastAt(snaps, t)), a = snaps[i], b = snaps[i + 1];
  if (!b) return a.scores;
  const f = (t - a.t) / (b.t - a.t);
  return Object.fromEntries(clans.map(c => [c.id, Math.round(a.scores[c.id] + f * (b.scores[c.id] - a.scores[c.id]))]));
}
const killsAt = (t, clan) => { let n = 0; for (const k of kills) { if (k.t > t) break; if (k.clan === clan) n++; } return n; };

function describe(e) {
  const c = byId[e.clan];
  switch (e.type) {
    case 'prompt': return `<b>${esc(e.strategist)}</b> orders: <q>${esc(e.text)}</q>`;
    case 'intent': return `Translated to <code>${esc(e.intent.goal)} ${esc(e.intent.target)}</code>, priority ${esc(e.intent.priority)}${e.sliders.length ? '; ' + e.sliders.map(s => `${esc(s.role)} ${esc(s.slider)} ${s.from}→${s.to}`).join(', ') : ''}`;
    case 'decision': return `<b>${esc(e.agent)}</b> <span class="hint">${esc(e.role)} · ${esc(e.tier.toUpperCase())}${e.coop ? ' · helps a clanmate' : ''}</span>: ${esc(e.action)}. <span class="muted">${esc(e.rationale)}</span>${e.respondsTo && prompts[e.respondsTo] ? ` <span class="hint">(answers ${clock(prompts[e.respondsTo].t)} order)</span>` : ''}`;
    case 'objective': return `<b>${esc(c?.name)}</b> ${e.action === 'capture' ? 'take' : 'abandon'} the ${esc(zoneName[e.zone] || e.zone)}`;
    case 'match_start': return 'Start horn';
    case 'match_end': return `<b>${esc(byId[e.winner]?.name)}</b> win ${clans.map(k => e.scores[k.id]).join(' to ')} <span class="hint">(${esc(e.reason)})</span>`;
  }
  return esc(e.type);
}

const dot = c => c ? `<span class="rp-dot" style="background:${esc(c.color)}"></span>` : '';
root.innerHTML = `
  ${log.sample ? `<p class="banner" id="sampleBanner"><b>SAMPLE</b> · ${esc(log.label)}</p>` : ''}
  <div class="pagehead"><p class="kicker" style="color:var(--gold);font:600 12px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;margin:0 0 6px">Replay${log.sample ? ' · sample data' : ''}</p>
    <h1>${esc(m.title)}</h1>
    <p>${esc(m.map)}. ${clans.map(c => `${c.agents} agents`).join(' vs ')}, ${clock(D)} on the clock, ${m.world.tickMs} ms ticks.</p></div>
  <div class="card rp-board">
    ${clans.map((c, i) => `<div class="rp-side ${i ? 'r' : ''}"><div class="rp-name">${dot(c)}${esc(c.name)}</div><div class="hint">strategist ${esc(c.strategist.handle)}</div>
      <div class="rp-score mono" id="sc-${esc(c.id)}">0</div>
      <div class="hint mono"><span id="zn-${esc(c.id)}">0 zones</span> · <span id="kl-${esc(c.id)}">0</span> kills · coop <span id="cp-${esc(c.id)}">-</span></div></div>`).join('<div class="rp-mid"><div class="rp-clock mono" id="clock">0:00</div><div class="hint mono">of ' + clock(D) + '</div><div class="hint" id="leadTxt"></div></div>')}
  </div>
  <div class="card rp-controls">
    <div class="row">
      <button class="btn pri" id="play" type="button" aria-label="Play">▶ Play</button>
      <span class="row" role="group" aria-label="Speed">${[1, 10, 30, 60].map(s => `<button class="btn sm${s === 30 ? ' on' : ''}" data-speed="${s}" type="button">${s}×</button>`).join('')}</span>
      <button class="btn sm" id="prev" type="button">◀ moment</button><button class="btn sm" id="next" type="button">moment ▶</button>
      <button class="btn sm" id="copy" type="button">Copy link to this moment</button>
    </div>
    <input type="range" id="scrub" min="0" max="${D}" step="1" value="0" aria-label="Match clock in seconds">
  </div>
  <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Lead</h3>
    <span class="row hint">${clans.map(c => `${dot(c)}${esc(c.name)} ahead`).join(' &nbsp; ')}</span></div>
    <div class="rp-chart" id="chart"></div><p class="hint" style="margin:6px 0 0">Points of ${esc(A.name)} minus ${esc(B.name)} (kills, captures and zones held). Dots mark orders and flags; click the chart to jump.</p></div>
  <div class="grid rp-cols">
    <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Events</h3>
      <span class="row" role="tablist">${FILTERS.map(([k, l], i) => `<button class="btn sm${i ? '' : ' on'}" role="tab" data-filter="${k}" type="button">${l}</button>`).join('')}</span></div>
      <ol class="rp-events" id="events"></ol></div>
    <div class="rp-side-col">
      <div class="card"><h3 style="margin:0 0 8px">Zones</h3><ul class="rp-zones" id="zones"></ul></div>
      <div class="card"><h3 style="margin:0 0 8px">Kill feed</h3><ol class="log rp-kills" id="kills"></ol></div>
    </div>
  </div>`;

// Lead chart (one axis: lead in points; colour follows the clan that is ahead). Drawn at the real pixel width.
let W = 1000, H = 230; const P = { l: 44, r: 18, t: 42, b: 24 };
const lead = snaps.map(s => ({ t: s.t, v: s.scores[A.id] - s.scores[B.id] }));
const maxAbs = Math.max(20, ...lead.map(p => Math.abs(p.v)));
const step = maxAbs > 150 ? 100 : maxAbs > 60 ? 50 : 20, lim = Math.ceil(maxAbs / step) * step;
const x = t => P.l + (t / D) * (W - P.l - P.r), y = v => P.t + (1 - (v + lim) / (2 * lim)) * (H - P.t - P.b);
const ticks = []; for (let v = -lim; v <= lim; v += step) ticks.push(v);
const markers = notable.filter(e => e.type === 'prompt' || e.type === 'objective');
const rowY = e => e.type === 'prompt' ? 8 : 22;
function drawChart() {
  const box = document.getElementById('chart');
  W = Math.max(280, box.clientWidth); H = W < 560 ? 200 : 230;
  const tStep = W < 560 ? 600 : 300;
  const path = lead.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${path}L${x(D)},${y(0)}L${x(0)},${y(0)}Z`;
  const xt = []; for (let s = 0; s <= D; s += tStep) xt.push(s);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Lead over time" id="leadSvg">
  <defs><clipPath id="above"><rect x="0" y="0" width="${W}" height="${y(0)}"/></clipPath><clipPath id="below"><rect x="0" y="${y(0)}" width="${W}" height="${H}"/></clipPath></defs>
  <text x="${P.l - 6}" y="${8 + 4}" text-anchor="end" class="rp-ax">orders</text><text x="${P.l - 6}" y="${22 + 4}" text-anchor="end" class="rp-ax">flags</text>
  ${ticks.map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="${v ? 1 : 1.5}"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" class="rp-ax">${v > 0 ? '+' : ''}${v}</text>`).join('')}
  ${xt.map((s, i) => `<text x="${x(s)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : s === D ? 'end' : 'middle'}" class="rp-ax">${clock(s)}</text>`).join('')}
  <path d="${area}" fill="${A.color}" fill-opacity=".18" clip-path="url(#above)"/><path d="${area}" fill="${B.color}" fill-opacity=".18" clip-path="url(#below)"/>
  <path d="${path}" fill="none" stroke="${A.color}" stroke-width="2" clip-path="url(#above)"/><path d="${path}" fill="none" stroke="${B.color}" stroke-width="2" clip-path="url(#below)"/>
  <line id="cursor" x1="${P.l}" x2="${P.l}" y1="2" y2="${H - P.b}" stroke="var(--ink)" stroke-width="1.5"/>
  ${markers.map(e => `<circle class="rp-mk" data-t="${e.t}" cx="${x(e.t)}" cy="${rowY(e)}" r="${W < 560 ? 4 : 5}" fill="${byId[e.clan]?.color}" stroke="var(--card)" stroke-width="2"><title>${clock(e.t)} ${esc(describe(e).replace(/<[^>]+>/g, ''))}</title></circle>`).join('')}
</svg><div class="rp-tip" id="tip" hidden></div>`;
}
drawChart();

const evList = document.getElementById('events');
evList.innerHTML = notable.map(e => `<li data-t="${e.t}" data-type="${e.type}" id="ev-${e.id}"><a class="mono rp-t" href="replays/${esc(m.id)}/?t=${e.t}">${clock(e.t)}</a>
  <span class="pill">${dot(byId[e.clan])}${NOTABLE[e.type]}</span><span class="rp-txt">${describe(e)}</span></li>`).join('');

const $ = s => document.getElementById(s);
let t = 0, playing = false, speed = 30, last = 0, filter = 'all', lastUrlT = -1, lastCurrent = null;
function render(scroll) {
  const sc = scoreAt(t);
  $('clock').textContent = clock(t); $('scrub').value = Math.floor(t);
  const ti = lastAt(terr, t), ci = lastAt(coop, t);
  for (const c of clans) {
    $('sc-' + c.id).textContent = sc[c.id];
    { const n = ti < 0 ? 0 : terr[ti].holdings[c.id].length; $('zn-' + c.id).textContent = n + (n === 1 ? ' zone' : ' zones'); }
    $('kl-' + c.id).textContent = killsAt(t, c.id);
    $('cp-' + c.id).textContent = ci < 0 ? '-' : Math.round(coop[ci].scores[c.id] * 100) + '%';
  }
  const d = sc[A.id] - sc[B.id];
  $('leadTxt').textContent = d === 0 ? 'level' : `${(d > 0 ? A : B).name} +${Math.abs(d)}`;
  const cx = x(t); $('cursor').setAttribute('x1', cx); $('cursor').setAttribute('x2', cx);
  const holder = {}; if (ti >= 0) for (const [cid, zs] of Object.entries(terr[ti].holdings)) for (const z of zs) holder[z] = byId[cid];
  $('zones').innerHTML = m.zones.map(z => `<li>${holder[z.id] ? dot(holder[z.id]) : '<span class="rp-dot" style="background:var(--dim)"></span>'}${esc(z.name)} <span class="hint">${holder[z.id] ? esc(holder[z.id].name) : 'unheld'}</span></li>`).join('');
  const ki = lastAt(kills, t);
  $('kills').innerHTML = ki < 0 ? '<li class="t">No kills yet</li>' : kills.slice(Math.max(0, ki - 7), ki + 1).reverse()
    .map(k => `<li><span class="t">${clock(k.t)}</span> <span style="color:${byId[k.clan].color}">${esc(k.killer)}</span> defeats ${esc(k.victim)} <span class="t">${esc(zoneName[k.zone] || k.zone)}</span></li>`).join('');
  let current = null;
  for (const li of evList.children) {
    const past = Number(li.dataset.t) <= t;
    li.classList.toggle('future', !past);
    li.hidden = filter !== 'all' && li.dataset.type !== filter;
    if (past && !li.hidden) current = li;
  }
  if (current !== lastCurrent) { lastCurrent?.classList.remove('now'); current?.classList.add('now'); lastCurrent = current; if (current) scrollList(current); }
  else if (scroll && current) scrollList(current);
  const ft = Math.floor(t);
  if (ft !== lastUrlT) { lastUrlT = ft; const u = new URL(location.href); u.searchParams.set('t', ft); history.replaceState(null, '', u); }
  document.body.dataset.t = ft;
}
const scrollList = li => { evList.scrollTop = li.offsetTop - evList.clientHeight / 2 + li.clientHeight / 2; };
function seek(s) { t = Math.max(0, Math.min(D, s)); render(true); }
function setPlaying(p) { playing = p && t < D; $('play').textContent = playing ? '❚❚ Pause' : '▶ Play'; $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play'); if (playing) { last = performance.now(); requestAnimationFrame(tick); } }
function tick(now) { if (!playing) return; t = Math.min(D, t + (now - last) / 1000 * speed); last = now; render(); if (t >= D) setPlaying(false); else requestAnimationFrame(tick); }

$('play').onclick = () => { if (!playing && t >= D) t = 0; setPlaying(!playing); };
$('scrub').oninput = e => seek(Number(e.target.value));
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { speed = Number(b.dataset.speed); document.querySelectorAll('[data-speed]').forEach(o => o.classList.toggle('on', o === b)); });
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(o => { o.classList.toggle('on', o === b); o.setAttribute('aria-selected', o === b); }); lastCurrent = null; render(true); });
const moments = [...new Set(notable.map(e => e.t))];
$('next').onclick = () => { const n = moments.find(s => s > Math.floor(t)); if (n != null) seek(n); };
$('prev').onclick = () => { const p = moments.filter(s => s < Math.floor(t)).at(-1); seek(p ?? 0); };
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(location.href); $('copy').textContent = 'Link copied'; } catch { $('copy').textContent = location.search; } setTimeout(() => $('copy').textContent = 'Copy link to this moment', 1600); };
evList.addEventListener('click', e => { const a = e.target.closest('a.rp-t'); if (a) { e.preventDefault(); setPlaying(false); seek(Number(a.closest('li').dataset.t)); } });

const chartBox = $('chart');
const tAt = ev => { const r = $('leadSvg').getBoundingClientRect(); return ((ev.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r) * D; };
chartBox.addEventListener('click', ev => { const mk = ev.target.closest('.rp-mk'); seek(mk ? Number(mk.dataset.t) : Math.round(tAt(ev))); });
chartBox.addEventListener('pointermove', ev => {
  const tip = $('tip');
  const s = Math.max(0, Math.min(D, tAt(ev))), sc = scoreAt(s), d = sc[A.id] - sc[B.id];
  const r = $('leadSvg').getBoundingClientRect();
  tip.hidden = false; tip.style.left = Math.min(r.width - 170, Math.max(0, ev.clientX - r.left + 10)) + 'px';
  tip.innerHTML = `<b class="mono">${clock(s)}</b><br>${clans.map(c => `${dot(c)}${esc(c.name)} <span class="mono">${sc[c.id]}</span>`).join('<br>')}<br><span class="hint">${d ? (d > 0 ? A : B).name + ' +' + Math.abs(d) : 'level'}</span>`;
});
chartBox.addEventListener('pointerleave', () => { $('tip').hidden = true; });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { drawChart(); render(); }, 120); });
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea')) return;
  if (e.key === ' ') { e.preventDefault(); $('play').click(); }
  if (e.key === 'ArrowRight' && !e.target.matches('input')) seek(t + 10);
  if (e.key === 'ArrowLeft' && !e.target.matches('input')) seek(t - 10);
});

const q = Number(new URLSearchParams(location.search).get('t'));
seek(Number.isFinite(q) ? q : 0);
