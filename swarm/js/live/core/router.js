// Built by scripts/build-swarm.mjs from swarm/core/router.mjs. Do not edit here.
// Tier router: forbearance. Every decision starts at tier 1 (deterministic) and climbs
// only when the tier below returns null ("I cannot decide this"), never above the node's
// own tier. Backends for tiers 2..5 are plugged in by the host; none ship here, so with
// nothing plugged in the swarm is fully deterministic and runs anywhere.
//   backend: async ({ node, context, prompt }) => decision | null
//   decision: { messages: [{to, kind, sections|text, orderId?}], action?: {...}, think?: string }
export const TIER_NAMES = { 1: 'Deterministic', 2: 'Small decision models', 3: 'Local LLM ~27B', 4: 'Big local model', 5: 'Foundation model' };

export class TierRouter {
  constructor({ deterministic } = {}) {
    this.backends = new Map();
    if (deterministic) this.backends.set(1, deterministic);
    this.stats = { calls: {}, escalations: 0, fallbacks: 0 };
    this.fallback = ({ node, context }) => ({ messages: context.reply ? [{ to: context.reply, kind: 'chat', sections: { Done: 'none', Blocked: `I could not decide "${context.question || ''}" at tier ${node.tier}. Try: hold lavas; scouts watch north; skillers fish.` } }] : [], action: null, think: 'fallback' });
  }
  use(tier, backend) { if (tier < 1 || tier > 5) throw new Error('tier must be 1..5'); this.backends.set(tier, backend); return this; }
  async decide(node, context) {
    const max = Math.max(1, Math.min(5, node.tier || 1));
    let climbed = false;
    for (let t = 1; t <= max; t++) {
      const b = this.backends.get(t);
      if (!b) continue;
      let d = null;
      try { d = await b({ node, context, prompt: node.prompt }); } catch (e) { d = null; node.transcript.push({ tick: context.tick, dir: 'think', text: `tier ${t} failed: ${e.message}` }); }
      this.stats.calls[t] = (this.stats.calls[t] || 0) + 1;
      if (d) { if (climbed) this.stats.escalations++; return { ...d, tier: t }; }
      climbed = true;
    }
    this.stats.fallbacks++;
    return { ...this.fallback({ node, context }), tier: 1 };
  }
}
