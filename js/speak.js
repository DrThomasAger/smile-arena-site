// speak.js: one voice for every page. Shared by the Raid Lab and SMILE Arena
// (same file in both repos; no imports, no build step).
//
//   speak(text, { priority })   'high' interrupts and jumps the queue, 'normal' queues,
//                               'low' is dropped when something is already speaking.
//   stop()                      clears the queue and silences everything (also Ctrl+Shift+Esc).
//   readAloud(el)               reads the visible text of an element (toggle: again = stop).
//   readButton(getEl)           a 🔊 button that does readAloud on click.
//   settingsPanel({ toggles })  mute, engine, Breeze URL, speed, voice, per-page toggles.
//   enabled(key, dflt)          a per-feature toggle (e.g. 'calls', 'claude'), false when muted.
//
// Engines. Breeze TTS 2 runs on Ganesha (Tailscale host "buddhafield"):
//   GET  {url}/health                     200 when up
//   POST {url}/v1/audio/speech            JSON {model:'tts-1', input, response_format:'pcm', seed}
//                                          -> raw signed 16-bit mono PCM at 24 kHz
// (see Smile-Prompt-Language/THE MAP Viewer/src/mapview/speech.clj). The health check has a
// short timeout; when Breeze is down, off the tailnet, or blocked (https page -> http URL) the
// browser's own Web Speech voice speaks instead, so it works offline and on phones.

const KEY = 'speak_prefs_v1';
const DEFAULTS = {
  muted: false,
  engine: 'auto',                 // 'auto' (Breeze, then browser) | 'breeze' | 'browser'
  url: 'http://buddhafield:8137', // Breeze TTS 2 on Ganesha over Tailscale
  timeoutMs: 1500,                // health check
  synthTimeoutMs: 20000,          // one chunk of speech
  rate: 1,
  voice: '',                      // browser voice name ('' = system default)
  breezeVoice: '',                // Breeze voice from its --voices-dir ('' = default)
  seed: 1717,
  toggles: {},                    // feature toggles, e.g. { calls: true, claude: false }
};

let prefs = load();
function load() {
  try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return { ...DEFAULTS, ...p, toggles: { ...(p.toggles || {}) } }; }
  catch { return { ...DEFAULTS, toggles: {} }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ } emit(); }

export const getPrefs = () => ({ ...prefs, toggles: { ...prefs.toggles } });
export function setPrefs(patch) {
  prefs = { ...prefs, ...patch, toggles: { ...prefs.toggles, ...(patch.toggles || {}) } };
  if ('url' in patch || 'engine' in patch) breeze = { ok: null, at: 0 };
  if (patch.muted) stop();
  save();
}
export const muted = () => !!prefs.muted;
export function setMuted(m) { setPrefs({ muted: !!m }); }
export function enabled(key, dflt = true) { return !prefs.muted && (prefs.toggles[key] ?? dflt); }
export function setToggle(key, v) { setPrefs({ toggles: { [key]: !!v } }); }

// ------------------------------------------------------------------ state + events
const subs = new Set();
const state = { speaking: false, engine: '', text: '', source: null };
export const status = () => ({ ...state, queued: queue.length, breeze: breeze.ok });
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() {
  const s = status();
  subs.forEach(f => { try { f(s); } catch (e) { console.error(e); } });
  try { window.dispatchEvent(new CustomEvent('speak:state', { detail: s })); } catch { /* no window */ }
}
// Every chunk spoken is logged here (tests read it; handy in the console too).
const log = [];
if (typeof window !== 'undefined') window.__speak = { log, status, stop, getPrefs };

// ------------------------------------------------------------------ text
// Split into sentence-sized chunks (browsers cut long utterances; Breeze starts sooner).
export function chunks(text, max = 240) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // a sentence ends at . ! ? … followed by a space, so 6:50.00 and 1.0.0.6 stay whole
  const sentences = clean.split(/(?<=[.!?…]["')\]]*)\s+/);
  const out = [];
  let cur = '';
  for (let s of sentences) {
    s = s.trim();
    while (s.length > max) { const cut = s.lastIndexOf(' ', max) > 40 ? s.lastIndexOf(' ', max) : max; out.push(((cur ? cur + ' ' : '') + s.slice(0, cut)).trim()); cur = ''; s = s.slice(cut).trim(); }
    if ((cur + ' ' + s).length > max && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'SVG', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO', 'TEMPLATE', 'DIALOG', 'KBD', 'NAV']);
const BLOCK = /^(P|DIV|LI|H[1-6]|TR|TD|TH|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|PRE|DT|DD|FIGCAPTION|TABLE|UL|OL|DL|ASIDE|MAIN|LABEL|SUMMARY|DETAILS)$/;
// The readable text of an element: visible text only, no controls, blocks end as sentences.
export function textOf(root) {
  if (!root) return '';
  const parts = [];
  const walk = node => {
    if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    const el = node;
    if (SKIP.has(el.tagName.toUpperCase()) || el.hidden || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('data-no-read')) return;
    const display = getComputedStyle(el).display;
    if (el !== root && display === 'none') return;
    if (el !== root && el.getClientRects && !el.getClientRects().length && display !== 'contents') return;
    // blocks (by tag or by CSS) end a sentence; inline-blocks such as pills get a space
    const block = BLOCK.test(el.tagName.toUpperCase()) || !/^(inline|contents)/.test(display);
    const gap = !block && display !== 'inline' && display !== 'contents';
    if (block) parts.push('\n'); else if (gap) parts.push(' ');
    if (el.tagName === 'DETAILS' && !el.open) { const s = el.querySelector('summary'); if (s) walk(s); }
    else for (const k of el.childNodes) walk(k);
    if (block) parts.push('\n'); else if (gap) parts.push(' ');
  };
  walk(root);
  return parts.join('').split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map(s => /[.!?…:;]$/.test(s) ? s : s + '.').join(' ');
}

// Words a run timer says well: 81.37 -> "1 21 point 4", 4.2 -> "4.2".
export function sayTime(s, digits = 1) {
  if (s == null || !isFinite(s)) return '';
  s = Math.abs(s);
  const m = Math.floor(s / 60), r = (s - m * 60).toFixed(digits);
  return m ? `${m}:${r.padStart(digits ? 3 + digits : 2, '0')}` : `${r} seconds`;
}
export function sayDelta(d) {
  if (d == null || !isFinite(d)) return '';
  if (Math.abs(d) < 0.05) return 'dead even';
  return `${sayTime(Math.abs(d))} ${d > 0 ? 'behind' : 'ahead'}`;
}

// ------------------------------------------------------------------ Breeze TTS 2
let breeze = { ok: null, at: 0 };
const base = () => String(prefs.url || '').replace(/\/+$/, '');
function breezeAllowed() {
  if (prefs.engine === 'browser' || !base()) return false;
  try {
    const u = new URL(base());
    // An https page cannot call an http server (mixed content), except on this machine.
    if (location.protocol === 'https:' && u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return false;
  } catch { return false; }
  return true;
}
function withTimeout(ms, outer) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  if (outer) outer.addEventListener('abort', () => c.abort(), { once: true });
  return { signal: c.signal, done: () => clearTimeout(t) };
}
export async function checkBreeze(force = false) {
  if (!breezeAllowed()) { breeze = { ok: false, at: Date.now() }; return false; }
  if (!force && breeze.ok != null && Date.now() - breeze.at < (breeze.ok ? 300000 : 60000)) return breeze.ok;
  const t = withTimeout(prefs.timeoutMs);
  try { const r = await fetch(base() + '/health', { signal: t.signal, cache: 'no-store' }); breeze = { ok: r.ok, at: Date.now() }; }
  catch { breeze = { ok: false, at: Date.now() }; }
  finally { t.done(); }
  emit();
  return breeze.ok;
}
// Waits for the health check only the first time; after that a stale answer is
// re-checked in the background, so a down Breeze never delays a call-out mid-run.
async function useBreeze() {
  if (!breezeAllowed()) return false;
  if (breeze.ok == null) return checkBreeze();
  if (Date.now() - breeze.at >= (breeze.ok ? 300000 : 60000)) checkBreeze(true);
  return breeze.ok;
}
function wav(pcm, rate = 24000) {
  const n = pcm.byteLength, b = new ArrayBuffer(44), v = new DataView(b);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n, true);
  return new Blob([b, pcm], { type: 'audio/wav' });
}
async function synth(text, outer) {
  const t = withTimeout(prefs.synthTimeoutMs, outer);
  try {
    const body = { model: 'tts-1', input: text, response_format: 'pcm', seed: prefs.seed };
    if (prefs.breezeVoice) body.voice = prefs.breezeVoice;
    const r = await fetch(base() + '/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: t.signal });
    if (!r.ok) throw new Error('Breeze answered ' + r.status);
    const buf = await r.arrayBuffer();
    const riff = buf.byteLength > 4 && new TextDecoder().decode(buf.slice(0, 4)) === 'RIFF';
    return riff ? new Blob([buf], { type: 'audio/wav' }) : wav(buf);
  } finally { t.done(); }
}

// ------------------------------------------------------------------ engines
let audio = null, abort = null, gen = 0;
function playBlob(blob) {
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    audio.playbackRate = prefs.rate;
    const end = () => { URL.revokeObjectURL(url); audio = null; res(); };
    audio.onended = end; audio.onerror = end; audio.onpause = () => { if (audio && !audio.ended) end(); };
    audio.play().catch(end);
  });
}
let voices = [];
export function browserVoices() {
  try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch { voices = []; }
  return voices;
}
function speakBrowser(text) {
  return new Promise(res => {
    const synth = typeof window !== 'undefined' && window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return res();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = prefs.rate;
    const v = prefs.voice && browserVoices().find(x => x.name === prefs.voice);
    if (v) { u.voice = v; u.lang = v.lang; }
    let done = false;
    const end = () => { if (!done) { done = true; clearTimeout(guard); res(); } };
    u.onend = end; u.onerror = end;
    // Some engines never fire onend: give up after a generous estimate of the speaking time.
    const guard = setTimeout(end, 4000 + (text.length * 120) / (prefs.rate || 1));
    synth.speak(u);
  });
}

// ------------------------------------------------------------------ queue
let queue = [];  // [{ text, priority, source, last, resolve, blob? }]
let running = false;

export function speak(text, { priority = 'normal', source = null } = {}) {
  if (prefs.muted) return Promise.resolve(false);
  const parts = chunks(text);
  if (!parts.length) return Promise.resolve(false);
  if (priority === 'low' && (running || queue.length)) return Promise.resolve(false);
  return new Promise(resolve => {
    const items = parts.map((t, i) => ({ text: t, priority, source, last: i === parts.length - 1, resolve: i === parts.length - 1 ? resolve : null }));
    if (priority === 'high') {
      interrupt(q => q.priority === 'high');
      const firstNonHigh = queue.findIndex(q => q.priority !== 'high');
      queue.splice(firstNonHigh < 0 ? queue.length : firstNonHigh, 0, ...items);
    } else queue.push(...items);
    pump();
  });
}

// Silence what is speaking now and drop queued items (keeping those `keep` accepts).
function interrupt(keep = () => false) {
  gen++;
  const dropped = queue.filter(q => !keep(q));
  queue = queue.filter(keep);
  dropped.forEach(q => q.resolve && q.resolve(false));
  if (abort) { abort.abort(); abort = null; }
  if (audio) { const a = audio; audio = null; try { a.pause(); a.onended && a.onended(); } catch { /* gone */ } }
  try { window.speechSynthesis && speechSynthesis.cancel(); } catch { /* none */ }
}

export function stop() {
  interrupt();
  Object.assign(state, { speaking: false, engine: '', text: '', source: null });
  emit();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const item = queue.shift(), my = gen;
    Object.assign(state, { speaking: true, text: item.text, source: item.source });
    let engine = 'browser';
    if (prefs.engine !== 'browser' && await useBreeze()) {
      if (my !== gen) { item.resolve && item.resolve(false); continue; }
      try {
        abort = new AbortController();
        const blob = item.blob ? await item.blob : await synth(item.text, abort.signal);
        // fetch the next chunk while this one plays
        const nx = queue[0];
        if (nx && !nx.blob) { nx.blob = synth(nx.text, abort.signal); nx.blob.catch(() => { nx.blob = null; }); }
        if (my !== gen) { item.resolve && item.resolve(false); continue; }
        engine = 'breeze'; state.engine = engine; emit();
        log.push({ text: item.text, engine, priority: item.priority, source: item.source, at: Date.now() });
        await playBlob(blob);
      } catch (e) {
        if (my !== gen) { item.resolve && item.resolve(false); continue; }
        breeze = { ok: false, at: Date.now() };
        if (prefs.engine === 'breeze') { item.resolve && item.resolve(false); continue; }
        engine = 'browser';
      }
    }
    if (engine === 'browser') {
      if (prefs.engine === 'breeze') { item.resolve && item.resolve(false); continue; }
      state.engine = engine; emit();
      log.push({ text: item.text, engine, priority: item.priority, source: item.source, at: Date.now() });
      await speakBrowser(item.text);
    }
    if (my !== gen) { item.resolve && item.resolve(false); continue; }
    item.resolve && item.resolve(true);
  }
  running = false;
  Object.assign(state, { speaking: false, engine: '', text: '', source: null });
  emit();
}

// ------------------------------------------------------------------ read aloud
let reading = null;
export function readAloud(el, opts = {}) {
  if (!el) return Promise.resolve(false);
  if (reading === el && (state.speaking || queue.length)) { stop(); reading = null; return Promise.resolve(false); }
  const text = (opts.prefix ? opts.prefix + '. ' : '') + textOf(el);
  if (!text.trim()) return Promise.resolve(false);
  reading = el;
  el.classList.add('speak-reading');
  return speak(text, { priority: 'high', source: 'read' }).finally(() => { el.classList.remove('speak-reading'); if (reading === el) reading = null; });
}
export const isReading = () => !!reading && state.speaking;

// Repaint a control on every change; forget it once it has left the page.
function watch(el, paint) {
  const off = onChange(() => { if (el._seen && !el.isConnected) return off(); if (el.isConnected) el._seen = true; paint(); });
  paint();
}

// A 🔊 button: reads getEl()'s text; while reading it shows ⏹ and stops on click.
export function readButton(getEl, { className = 'speak-btn', label = 'Read aloud' } = {}) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = className;
  const paint = () => {
    const on = isReading();
    b.textContent = on ? '⏹' : '🔊';
    b.title = on ? 'Stop reading (Ctrl+Shift+Esc)' : `${label}${prefs.muted ? ' (voice is muted)' : ''}`;
    b.setAttribute('aria-label', on ? 'Stop reading' : label);
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
    b.classList.toggle('muted', !!prefs.muted);
  };
  b.addEventListener('click', () => {
    if (isReading()) { stop(); return; }
    if (prefs.muted) { setMuted(false); }
    readAloud(typeof getEl === 'function' ? getEl() : getEl);
  });
  watch(b, paint);
  return b;
}

// A button that flips one feature toggle: "🔊 Call-outs" / "🔇 Call-outs".
export function toggleButton(key, label, dflt = true, { className = 'btn speak-toggle' } = {}) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = className; b.dataset.speakToggle = key;
  const paint = () => {
    const on = enabled(key, dflt);
    b.textContent = `${on ? '🔊' : '🔇'} ${label}`;
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? `${label}: on (click to turn off)` : prefs.muted ? `${label}: all speech is muted (click to unmute)` : `${label}: off (click to turn on)`;
    b.classList.toggle('on', on);
  };
  b.addEventListener('click', () => {
    if (prefs.muted) { setPrefs({ muted: false, toggles: { [key]: true } }); return; }
    const on = !enabled(key, dflt);
    setToggle(key, on);
    if (!on && state.source === key) stop();
  });
  watch(b, paint);
  return b;
}
// Say something only when that feature's toggle is on.
export function callout(key, text, { priority = 'high', dflt = true } = {}) {
  if (!enabled(key, dflt)) return Promise.resolve(false);
  return speak(text, { priority, source: key });
}

// ------------------------------------------------------------------ settings UI
const CSS = `.spk-panel{display:grid;gap:10px;font-size:14px;min-width:min(340px,80vw)}
.spk-panel label{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.spk-panel .spk-col{flex-direction:column;align-items:stretch;gap:4px}
.spk-panel input[type=text],.spk-panel select{font:inherit;padding:6px 8px;border-radius:6px;border:1px solid currentColor;background:transparent;color:inherit;min-width:0;width:100%;box-sizing:border-box}
.spk-panel select option{color:#111}
.spk-panel .spk-note{opacity:.75;font-size:12.5px;margin:0}
.spk-panel .spk-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.speak-reading{outline:2px dashed color-mix(in srgb,currentColor 35%,transparent);outline-offset:4px}`;
function injectCss() {
  if (document.getElementById('speak-css')) return;
  const s = document.createElement('style'); s.id = 'speak-css'; s.textContent = CSS; document.head.append(s);
}

// toggles: [[key, label, default], ...] for this page's features.
export function settingsPanel({ toggles = [] } = {}) {
  injectCss();
  const mk = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k in e && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v); } kids.flat().forEach(k => k != null && e.append(k)); return e; };
  const p = prefs;
  const status = mk('p', { class: 'spk-note', 'data-speak-status': '' });
  const paintStatus = () => {
    const b = breeze.ok;
    status.textContent = prefs.engine === 'browser' ? 'Using this browser\'s voice.'
      : !breezeAllowed() ? 'Breeze cannot be reached from this page (an https page cannot call an http address); the browser voice speaks.'
      : b == null ? 'Breeze TTS 2: not checked yet.' : b ? 'Breeze TTS 2 is answering. Its voice is used.' : 'Breeze TTS 2 is not answering; the browser voice speaks instead.';
  };
  const voiceSel = mk('select', { 'aria-label': 'Browser voice', onchange: e => setPrefs({ voice: e.target.value }) });
  const fillVoices = () => {
    const vs = browserVoices();
    voiceSel.replaceChildren(mk('option', { value: '' }, 'System default'), ...vs.map(v => mk('option', { value: v.name, selected: v.name === prefs.voice }, `${v.name} (${v.lang})`)));
  };
  fillVoices();
  try { window.speechSynthesis && speechSynthesis.addEventListener('voiceschanged', fillVoices); } catch { /* none */ }
  const rateOut = mk('output', {}, p.rate.toFixed(2) + '×');
  const panel = mk('div', { class: 'spk-panel' },
    mk('label', {}, mk('input', { type: 'checkbox', checked: !!p.muted, 'data-speak': 'mute', onchange: e => setMuted(e.target.checked) }), 'Mute all speech'),
    toggles.map(([key, label, dflt = true]) => mk('label', {}, mk('input', { type: 'checkbox', checked: p.toggles[key] ?? dflt, 'data-speak': key, onchange: e => setToggle(key, e.target.checked) }), label)),
    mk('label', { class: 'spk-col' }, 'Voice engine',
      mk('select', { 'aria-label': 'Voice engine', 'data-speak': 'engine', onchange: e => { setPrefs({ engine: e.target.value }); checkBreeze(true).then(paintStatus); } },
        [['auto', 'Breeze TTS 2 on Ganesha, else this browser'], ['breeze', 'Breeze TTS 2 only'], ['browser', 'This browser only']].map(([v, l]) => mk('option', { value: v, selected: p.engine === v }, l)))),
    mk('label', { class: 'spk-col' }, 'Breeze TTS 2 address',
      mk('input', { type: 'text', value: p.url, spellcheck: false, 'data-speak': 'url', placeholder: 'http://buddhafield:8137', onchange: e => { setPrefs({ url: e.target.value.trim() }); checkBreeze(true).then(paintStatus); } })),
    mk('label', { class: 'spk-col' }, 'Breeze voice (a name from its voices folder, blank = default)',
      mk('input', { type: 'text', value: p.breezeVoice, spellcheck: false, 'data-speak': 'breezeVoice', onchange: e => setPrefs({ breezeVoice: e.target.value.trim() }) })),
    mk('label', { class: 'spk-col' }, 'Browser voice', voiceSel),
    mk('label', {}, 'Speed', mk('input', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(p.rate), 'data-speak': 'rate', 'aria-label': 'Speaking speed',
      oninput: e => { rateOut.textContent = (+e.target.value).toFixed(2) + '×'; }, onchange: e => setPrefs({ rate: +e.target.value }) }), rateOut),
    mk('div', { class: 'spk-row' },
      mk('button', { type: 'button', class: 'btn sm', onclick: () => speak('This is how I sound. Press Control Shift Escape to stop me at any time.', { priority: 'high', source: 'test' }) }, '▶ Test voice'),
      mk('button', { type: 'button', class: 'btn sm', onclick: () => stop() }, '⏹ Stop'),
      mk('button', { type: 'button', class: 'btn sm', onclick: () => checkBreeze(true).then(paintStatus) }, 'Check Breeze')),
    status,
    mk('p', { class: 'spk-note' }, 'Ctrl+Shift+Esc stops speech anywhere.'));
  paintStatus();
  checkBreeze().then(paintStatus);
  return panel;
}

// ------------------------------------------------------------------ keys
if (typeof document !== 'undefined' && !window.__speakKeys) {
  window.__speakKeys = true;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && e.ctrlKey && e.shiftKey) { stop(); }
  }, true);
  window.addEventListener('pagehide', () => stop());
}
