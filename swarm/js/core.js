// Picks the swarm runtime: Agent A's core when it is published into the site as swarm/js/core-live.js
// (must export createSwarm with the API described in core-stub.js / docs/SWARM-API.md), else the stub.
import * as stub from './core-stub.js';

let impl = stub, source = 'stub';
export async function runtime() {
  try {
    // swarm/data/runtime.json says whether core-live.js is published (so no 404 is logged while it is not).
    const flag = await fetch('swarm/data/runtime.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {});
    if (flag.live) {
      const live = await import('./core-live.js');
      if (typeof live.createSwarm === 'function') { impl = live; source = 'live'; }
    }
  } catch { /* no live core published yet: keep the stub */ }
  return { createSwarm: impl.createSwarm, source };
}
export const STATES = stub.STATES;
