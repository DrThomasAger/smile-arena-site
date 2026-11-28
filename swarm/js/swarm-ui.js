// Swarm page: format picker, live diagram, strategist chat, per-node chat with take over / pause / hand back.
// URL params: ?format=chain  ?idle=10 (seconds before a taken-over node is handed back)  ?tick=1800 (ms per round)  ?seed=7
import { esc } from '../../js/shell.js';
import * as voice from '../../js/speak.js';
import { listFormats, loadFormat, KINDS } from './formats.js';
import { runtime } from './core.js';
import { mountDiagram } from './diagram.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const IDLE = Math.max(1, Number(params.get('idle')) || 10);
const TICK = Math.max(100, Number(params.get('tick')) || 1800);
const SEED = Number(params.get('seed')) || 7;
const EXAMPLES = {
  game: ['Scouts report the east bridge, everyone hold', 'Captains push north, keep formation', 'terms: no attacks at the spawn for 2 minutes'],
  nature: ['Find the nearest food and mark the trail', 'Everyone back to the nest, storm coming'],
  default: ['Search the codebase for every login call and report', 'Split the task three ways and verify each result', 'Everyone pause and summarise what you have'],
};

const state = { formats: [], format: null, swarm: null, diagram: null, selected: null, tab: 'chat', timer: null, running: true, idleTimer: null, idleLeft: 0, dots: [], source: 'stub' };
window.__swarm = state;

const t0 = Date.now();
const stamp = () => { const s = Math.floor((Date.now() - t0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function logLine(log, cls, who, text) {
  const d = document.createElement('div');
  d.innerHTML = `<span class="t">[${stamp()}]</span> ${who ? `<span class="${cls}">${esc(who)}</span> ` : ''}${cls === 'sys' ? `<span class="sys">${esc(text)}</span>` : esc(text)}`;
  log.append(d); log.scrollTop = log.scrollHeight;
  while (log.children.length > 300) log.firstChild.remove();
}
const slog = (cls, who, text) => logLine($('slog'), cls, who, text);
const nodeOf = id => state.swarm && state.swarm.nodes.get(id);

async function boot() {
  state.formats = await listFormats();
  $('format').innerHTML = state.formats.map(f => `<option value="${f.id}">${esc(f.title)} · ${f.family}</option>`).join('');
  const rt = await runtime(); state.createSwarm = rt.createSwarm; state.source = rt.source;
  if (rt.source === 'live') $('runtimeNote').textContent = 'Runtime: the real swarm core (swarm/core: bus, tier-1 policies, tier router, sim world, innovation log) running in your browser as swarm/js/live/. No game, no logins.';
  $('idleSec').textContent = IDLE;
  const want = params.get('format');
  await switchFormat(state.formats.some(f => f.id === want) ? want : 'chain', true);
  wire();
}

async function switchFormat(id, first = false) {
  const f = await loadFormat(id);
  if (state.timer) clearInterval(state.timer);
  if (state.diagram) state.diagram.destroy();
  closeNode(); $('stopBanner').hidden = true;
  state.format = f; $('format').value = id;
  const swarm = state.createSwarm(f, { seed: SEED });
  state.swarm = swarm; state.dots = [];
  const url = new URL(location.href); url.searchParams.set('format', id); history.replaceState(null, '', url);

  $('fTitle').textContent = f.title; $('fFamily').textContent = f.family;
  $('fCounts').textContent = `${f.nodes.length} nodes · ${f.edges.length} edges`;
  $('fNote').textContent = f.note || '';
  $('refSvg').src = f.svg; $('refSvg').alt = `Original diagram: ${f.title}`;
  $('fSummary').textContent = f.summary;
  $('fMetrics').innerHTML = Object.entries(f.smileMetrics || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd style="text-align:left;font-family:inherit;color:var(--muted)">${esc(v)}</dd>`).join('');
  $('legend').innerHTML = f.roles.map(r => `<span><i style="background:var(--c${r.color % 7})"></i>${esc(r.name)} ×${r.count} · tier ${r.tier}</span>`).join('') +
    `<span class="kind"><i style="background:var(--accent)"></i>order</span><span class="kind"><i style="background:var(--good)"></i>report</span><span class="kind"><i style="background:var(--info)"></i>peer</span><span class="kind"><i style="background:var(--gold)"></i>terms</span>`;
  $('sTarget').textContent = `→ ${f.entry.map(id => swarm.nodes.get(id).name).join(', ')}`;
  const ex = EXAMPLES[f.family] || EXAMPLES.default;
  $('sex').innerHTML = ex.map(x => `<button class="btn sm" type="button">${esc(x)}</button>`).join('');
  $('sex').querySelectorAll('button').forEach(b => b.addEventListener('click', () => sendOrder(b.textContent)));

  state.diagram = mountDiagram($('diagram'), f, { onSelect: openNode });
  swarm.on('message', m => { const d = state.diagram.animate(m); if (d) state.dots.push({ id: m.id, from: m.from, to: m.to, kind: m.kind }); if (state.selected && (m.from === state.selected || m.to === state.selected)) renderNode(); });
  swarm.on('reject', r => { if (state.selected && r.from === state.selected) { logLine($('nLog'), 'sys', '', `Refused: ${r.reason}`); } });
  swarm.on('reply', r => { slog('n', r.name, r.text); voice.callout('orders', r.text, { priority: 'normal' }); });
  swarm.on('reasoning', r => { if (r.node === state.selected && state.tab !== 'prompt') renderNode(); });
  swarm.on('state', s => { state.diagram.setState(s.node, s.state); const chip = $('strip').querySelector(`[data-node="${s.node}"]`); if (chip) chip.dataset.state = s.state; if (s.node === state.selected) renderNode(); updateMode(); });
  swarm.on('stop', ({ why }) => { $('stopBanner').hidden = false; $('stopWhy').textContent = `all ${f.nodes.length} nodes halted (${why}). Nothing moves until you resume.`; slog('sys', '', `STOP: all agents halted (${why}).`); voice.stop(); updateMode(); });
  swarm.on('resume', () => { $('stopBanner').hidden = true; slog('sys', '', 'Resumed: all nodes back on auto.'); updateMode(); });

  $('strip').innerHTML = f.nodes.map(n => `<button class="sw-chip" type="button" role="listitem" data-node="${n.id}" data-state="auto" title="${esc(n.roleName)} · tier ${n.tier}"><i style="background:var(--c${n.color % 7})"></i>${esc(n.name)}</button>`).join('');
  $('strip').querySelectorAll('button').forEach(b => b.addEventListener('click', () => openNode(b.dataset.node)));

  slog('sys', '', `${first ? 'Loaded' : 'Switched to'} ${f.title}: ${f.nodes.length} nodes in ${f.roles.length} roles, ${f.edges.length} permitted edges. Talk to ${f.entry.map(id => swarm.nodes.get(id).name).join(' and ')}.`);
  renderInnovation();
  state.timer = setInterval(() => { if (state.running) tick(); }, TICK);
  updateMode();
}

async function tick() { await state.swarm.tick(); renderInnovation(); if (state.selected && state.tab !== 'prompt') renderNode(); updateMode(); }

function sendOrder(text) {
  text = text.trim(); if (!text) return;
  if (state.swarm.stopped) { slog('sys', '', 'Stopped. Resume all before giving orders.'); return; }
  slog('y', 'you', text);
  state.swarm.strategist(text);
}

// ---- node chat ----
function openNode(id) {
  state.selected = id; state.diagram.select(id);
  $('strip').querySelectorAll('.sw-chip').forEach(c => c.classList.toggle('on', c.dataset.node === id));
  $('nodePanel').hidden = false;
  renderNode(); updateMode();
  if (window.innerWidth <= 860) $('nodePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeNode() {
  if (state.selected && nodeOf(state.selected)?.state === 'manual') state.swarm.handback(state.selected, 'chat closed');
  state.selected = null; if (state.diagram) state.diagram.select(null);
  $('nodePanel').hidden = true; $('strip').querySelectorAll('.sw-chip.on').forEach(c => c.classList.remove('on'));
  stopIdle(); updateMode();
}
function renderNode() {
  const n = nodeOf(state.selected); if (!n) return;
  $('nName').textContent = n.name; $('nRole').textContent = `${n.roleName} · tier ${n.tier} ${n.tierName}${n.side != null ? ' · sangha ' + 'AB'[n.side] : ''}`;
  const st = $('nState'); st.textContent = n.state.toUpperCase(); st.className = 'pill sw-state ' + n.state;
  $('nodePanel').classList.toggle('manual', n.state === 'manual');
  $('takeBtn').hidden = n.state === 'manual' || n.state === 'stopped'; $('pauseBtn').hidden = n.state === 'paused' || n.state === 'stopped'; $('backBtn').hidden = n.state === 'auto' || n.state === 'stopped';
  $('cInbox').textContent = n.inbox.length ? n.inbox.length : ''; $('cOutbox').textContent = n.outbox.length;
  $('nSay').disabled = n.state !== 'manual';
  $('nHint').textContent = n.state === 'manual' ? `You speak as ${n.name}. Edges: ${['order', 'report', 'peer', 'terms'].filter(k => n.out[k].length).map(k => `${k} → ${n.out[k].length}`).join(', ') || 'none'}. F8 or ${IDLE} s idle hands back.`
    : n.state === 'paused' ? 'Paused: messages wait in the inbox. Hand back to continue.' : n.state === 'stopped' ? 'Stopped with the whole swarm. Resume all to continue.' : 'Running on its role prompt. Take over to type as this node.';
  const log = $('nLog'); const pre = $('nPrompt');
  pre.hidden = state.tab !== 'prompt'; log.hidden = state.tab === 'prompt';
  if (state.tab === 'prompt') { pre.textContent = n.prompt || state.format.roles.find(r => r.id === n.role)?.prompt || ''; return; }
  const fmt = m => `${m.kind}${m.hops ? ' (hop ' + m.hops + ')' : ''}: ${m.text}`;
  const nm = id => id === 'strategist' ? 'strategist' : (nodeOf(id)?.name || id);
  let lines = [];
  if (state.tab === 'inbox') lines = n.inbox.map(m => ['n', '← ' + nm(m.from), fmt(m)]);
  else if (state.tab === 'outbox') lines = n.outbox.slice(-60).map(m => ['y', '→ ' + nm(m.to), fmt(m)]);
  else if (state.tab === 'reasoning') lines = n.reasoning.map(r => ['r', `t${r.t}`, r.text]);
  else if (n.chat) lines = n.chat.slice(-40).map(c => [c.who === 'you' ? 'y' : c.who ? 'n' : 'sys', c.who, c.text]);
  else lines = n.reasoning.slice(-25).map(r => r.text.startsWith('You said:') ? ['y', 'you', r.text.replace(/^You said: "(.*?)"\.\s*/, '$1  ·  ')] : ['n', n.name, r.text]);
  log.innerHTML = lines.length ? lines.map(([c, w, t]) => `<div>${w ? `<span class="${c}">${esc(w)}</span> ` : ''}${esc(t)}</div>`).join('') : `<div class="sw-empty">${state.tab === 'inbox' ? 'Inbox empty (messages are handled each round).' : 'Nothing yet.'}</div>`;
  log.scrollTop = log.scrollHeight;
}
function promptNode(text) {
  const n = nodeOf(state.selected); if (!n || !text.trim()) return;
  if (n.state !== 'manual') { logLine($('nLog'), 'sys', '', 'Take over first (button or F8) to speak as this node.'); return; }
  state.swarm.prompt(n.id, text); renderNode(); resetIdle();
}
function toggleTakeover(why) {
  const n = nodeOf(state.selected); if (!n || state.swarm.stopped) return;
  if (n.state === 'manual') { state.swarm.handback(n.id, why); stopIdle(); }
  else { state.swarm.takeover(n.id, why); $('nSay').focus(); resetIdle(); }
}
// Idle: in manual mode, no typing or mouse for IDLE seconds hands the node back.
function resetIdle() {
  stopIdle();
  const n = nodeOf(state.selected); if (!n || n.state !== 'manual') return;
  state.idleLeft = IDLE; showIdle();
  state.idleTimer = setInterval(() => { state.idleLeft--; showIdle(); if (state.idleLeft <= 0) { const id = state.selected; stopIdle(); state.swarm.handback(id, `idle ${IDLE} s`); } }, 1000);
}
function stopIdle() { if (state.idleTimer) clearInterval(state.idleTimer); state.idleTimer = null; $('idleLeft').textContent = ''; }
function showIdle() { $('idleLeft').textContent = state.idleLeft <= IDLE / 2 ? `hands back in ${state.idleLeft} s` : ''; }

function updateMode() {
  const m = $('mode'); const n = nodeOf(state.selected);
  if (!state.swarm) return;
  if (state.swarm.stopped) { m.textContent = 'STOPPED'; m.className = 'pill stopped'; return; }
  const manual = [...state.swarm.nodes.values()].filter(x => x.state === 'manual');
  if (manual.length) { m.textContent = `MANUAL · ${manual.map(x => x.name).join(', ')}`; m.className = 'pill manual'; }
  else { const paused = [...state.swarm.nodes.values()].filter(x => x.state === 'paused').length; m.textContent = `AUTO · ${state.swarm.nodes.size} nodes${paused ? ` · ${paused} paused` : ''}`; m.className = 'pill ok'; }
  void n;
}
function renderInnovation() {
  const items = state.swarm.innovation.slice(-8).reverse();
  $('innov').innerHTML = items.length ? items.map(i => `<li><span class="t mono dim">t${i.t}</span> ${esc(i.text)}</li>`).join('') : '<li class="sw-empty">Nothing yet. Give an order or wait for reports.</li>';
  if (state.swarm.metrics) { const m = state.swarm.metrics(); $('innovMetrics').textContent = `tick ${m.tick} · cooperation ${m.cooperation} (${m.ordersActed} of ${m.ordersSent} orders taken) · harmony ${m.harmony} · gathering ${m.gathering.ticks ?? '-'} ticks / ${m.gathering.hops} hops · ${m.messages} messages, ${m.rejected} refused · SMILE-clean ${Math.round(m.smileClean * 100)}%`; }
}

function wire() {
  $('format').addEventListener('change', e => switchFormat(e.target.value));
  $('sform').addEventListener('submit', e => { e.preventDefault(); sendOrder($('sorder').value); $('sorder').value = ''; });
  $('nForm').addEventListener('submit', e => { e.preventDefault(); promptNode($('nSay').value); $('nSay').value = ''; });
  $('takeBtn').addEventListener('click', () => toggleTakeover('button'));
  $('backBtn').addEventListener('click', () => { const n = nodeOf(state.selected); if (n) { state.swarm.handback(n.id, 'button'); stopIdle(); } });
  $('pauseBtn').addEventListener('click', () => { const n = nodeOf(state.selected); if (n) { state.swarm.pause(n.id, 'button'); stopIdle(); } });
  $('closeBtn').addEventListener('click', closeNode);
  $('stopAll').addEventListener('click', () => state.swarm.stopAll('button'));
  $('resumeAll').addEventListener('click', () => state.swarm.resumeAll());
  $('tickBtn').addEventListener('click', tick);
  $('runBtn').addEventListener('click', () => { state.running = !state.running; $('runBtn').textContent = state.running ? 'Pause clock' : 'Run clock'; $('runBtn').setAttribute('aria-pressed', String(state.running)); });
  $('nTabs').querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; $('nTabs').querySelectorAll('[role=tab]').forEach(x => x.setAttribute('aria-selected', String(x === b))); renderNode(); }));
  document.addEventListener('keydown', e => {
    if (e.key === 'F8') { e.preventDefault(); if (state.selected) toggleTakeover('F8'); else slog('sys', '', 'F8: open a node first (click one in the diagram).'); }
    if (e.key === 'Escape' && e.ctrlKey && e.shiftKey) { e.preventDefault(); if (!state.swarm.stopped) state.swarm.stopAll('Ctrl+Shift+Esc'); }
  });
  for (const ev of ['keydown', 'pointermove', 'pointerdown']) document.addEventListener(ev, () => { if (state.idleTimer) { state.idleLeft = IDLE; showIdle(); } }, { passive: true });
  const tg = voice.toggleButton('orders', 'Speak replies', true, { className: 'btn sm speak-toggle' });
  $('sTarget').parentElement.append(tg);
}

boot().catch(e => { slog('sys', '', 'Failed to load: ' + e.message); console.error(e); });
