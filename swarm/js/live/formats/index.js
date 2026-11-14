// Built by scripts/build-swarm.mjs from swarm/formats/index.browser.mjs. Do not edit here.
// Browser build of the format library: same exports as index.mjs, but formats come from fetch
// (site/swarm/data/formats/) or from registerFormat(), never from the file system.
// scripts/build-swarm.mjs copies this file over formats/index.js in the published core.
import { validateFormat } from './schema.js';
import { expandEdges, formatNodes, sideOf } from './wiring.js';
import { renderFormatSVG } from './render.js';

const cache = new Map();
let base = 'swarm/data/formats/';
let index = null;

export function setFormatBase(url) { base = url; }

// Hands the library a format object already loaded elsewhere (the Swarm page passes the spec it fetched).
export function registerFormat(f) {
  if (cache.get(f.id) === f) return f;
  const v = validateFormat(f);
  if (!v.ok) throw new Error(`format ${f.id} invalid: ${v.errors.join('; ')}`);
  cache.set(f.id, f);
  return f;
}
async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }

export async function loadIndex() { if (!index) index = (await getJSON(base + 'index.json')).formats; return index; }
export function listFormats() { if (!index) throw new Error('listFormats: await loadIndex() first in the browser'); return index; }
export function loadFormatSync(id) {
  if (!cache.has(id)) throw new Error(`format ${id} is not loaded: await loadFormat('${id}') or registerFormat() first`);
  return cache.get(id);
}
export async function loadFormat(id) {
  if (cache.has(id)) return cache.get(id);
  return registerFormat(await getJSON(`${base}${id}.json`));
}
export function renderFormat(format, nodes = formatNodes(format), edges = expandEdges(nodes, format.wiring), opts) {
  return renderFormatSVG(format, nodes, edges, opts);
}
export { validateFormat, expandEdges, formatNodes, sideOf, renderFormatSVG };
