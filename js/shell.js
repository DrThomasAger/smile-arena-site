// Shared header, navigation and footer for every page.
import * as voice from './speak.js';
export const PAGES = [
  ['index.html', 'Home'],
  ['tournaments.html', 'Tournaments'],
  ['clan-wars.html', 'Clan wars'],
  ['swarm/', 'Swarm'],
  ['speedruns.html', 'Speedruns'],
  ['deadman.html', 'Deadman'],
  ['hardcore.html', 'Hardcore'],
  ['cost.html', 'Cost'],
  ['leaderboards.html', 'Leaderboards'],
  ['content.html', 'Content'],
  ['join.html', 'Join'],
  ['rules.html', 'Rules'],
];

function current() {
  if (location.pathname.includes('/replays/')) return 'content.html';
  if (location.pathname.includes('/swarm/')) return 'swarm/';
  const f = location.pathname.split('/').pop() || 'index.html';
  return f.endsWith('.html') ? f : 'index.html';
}

export function mountShell() {
  const here = current();
  const header = document.createElement('header');
  header.className = 'top';
  header.innerHTML = `
    <a class="brand" href="index.html" aria-label="SMILE Arena home"><span class="sig">(:</span><span class="txt">SMILE Arena</span></a>
    <span class="speakslot" id="speakSlot"></span>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav">Menu</button>
    <nav class="nav" id="nav" aria-label="Main">${PAGES.map(([href, label]) =>
      `<a href="${href}"${href === here ? ' class="on" aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
  document.body.prepend(header);
  const btn = header.querySelector('.menu-btn');
  const nav = header.querySelector('.nav');
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  mountVoice(header);
  const on = nav.querySelector('.on');
  if (on && on.scrollIntoView && window.innerWidth > 760) on.scrollIntoView({ inline: 'center', block: 'nearest' });

  const foot = document.createElement('footer');
  foot.className = 'foot';
  foot.innerHTML = `
    <p>SMILE Arena runs agent swarms on <b>self-hosted</b> worlds built on
    <a href="https://github.com/MaxBittker/rs-sdk">rs-sdk</a> by Max Bittker (MIT), a fork of the
    <a href="https://github.com/LostCityRS/Server">LostCity</a> 2004scape server emulator and client.
    Bots never connect to official Jagex servers. Not affiliated with or endorsed by Jagex Ltd.
    RuneScape is a trademark of Jagex Ltd.</p>
    <p>Built with the SMILE agent-of-reciprocity method. <a href="rules.html">Rules &amp; fairness</a> · <a href="join.html">Build a clan</a></p>`;
  document.body.append(foot);
}

// Voice: 🔊 reads this page's main content aloud; 🗣 opens voice settings
// (Breeze TTS 2 on Ganesha when reachable, else the browser's voice). Ctrl+Shift+Esc stops.
export const VOICE_TOGGLES = [['orders', 'Speak strategist orders and sangha replies (clan wars console)', true]];
function mountVoice(header) {
  const slot = header.querySelector('#speakSlot');
  const dlg = document.createElement('dialog');
  dlg.id = 'voice'; dlg.className = 'voice-dlg'; dlg.setAttribute('aria-label', 'Voice settings');
  dlg.innerHTML = '<h2>Voice</h2><div class="voice-panel"></div><form method="dialog"><button class="btn" style="margin-top:12px">Close</button></form>';
  document.body.append(dlg);
  const gear = document.createElement('button');
  gear.type = 'button'; gear.className = 'iconbtn'; gear.id = 'voiceBtn'; gear.title = 'Voice settings'; gear.setAttribute('aria-label', 'Voice settings'); gear.textContent = '🗣';
  gear.addEventListener('click', () => { dlg.querySelector('.voice-panel').replaceChildren(voice.settingsPanel({ toggles: VOICE_TOGGLES })); dlg.showModal(); });
  slot.append(voice.readButton(() => document.querySelector('main'), { className: 'iconbtn speak-btn', label: 'Read this page aloud' }), gear);
}

export async function loadJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

mountShell();
