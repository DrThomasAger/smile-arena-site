// SMILE Arena cost model. Pure functions, shared by the site calculator and scripts/cost.mjs.
//
// Every number in DEFAULTS and PRICE_PRESETS is a user-editable placeholder.
// Foundation-model prices are Anthropic first-party API list prices as recorded
// 2026-10-06 (claude-api reference table; check https://www.anthropic.com/pricing
// before relying on them). Local-model and server prices are assumptions, not quotes.

export const PRICES_AS_OF = '2026-10-06';

// $ per million tokens. `cachedIn` is the price of a prompt-cache read.
export const PRICE_PRESETS = {
  'claude-haiku-5-5':  { label: 'Claude Haiku 5.5',  in: 0.10, out: 0.50,  cachedIn: 0.01, source: 'Anthropic API list price, 2026-10-06 (prompts up to 100K tokens; cache read assumed 0.1x)' },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', in: 2.00, out: 10.00, cachedIn: 0.20, source: 'Anthropic API list price, 2026-10-06' },
  'claude-opus-5-5':   { label: 'Claude Opus 5.5',   in: 4.00, out: 20.00, cachedIn: 0.20, source: 'Anthropic API list price, 2026-10-06' },
  'claude-fable-5-1':  { label: 'Claude Fable 5.1',  in: 10.00, out: 50.00, cachedIn: 1.00, source: 'Anthropic API list price, 2026-10-06 (cache read assumed 0.1x)' },
  'custom':            { label: 'Custom (edit below)', in: 1.00, out: 5.00, cachedIn: 0.10, source: 'your numbers' },
};

// The five SMILE tiers. Forbearance: the cheapest tier that can make the decision makes it.
export const TIERS = [
  { id: 't1', name: 'Deterministic', note: 'pure code: pathing, eat-at-HP, flee rules, formation keeping (~0.1 s)' },
  { id: 't2', name: 'Small local models', note: 'decision/classifier models: target pick, threat read' },
  { id: 't3', name: 'Local LLM (~27B)', note: 'short plans: regroup, which gate, who to heal' },
  { id: 't4', name: 'Big local model', note: 'DeepSeek-size: squad tactics when lower tiers disagree' },
  { id: 't5', name: 'Foundation model', note: 'cloud: novel situations nothing below can resolve' },
];

export const DEFAULTS = {
  agentsPerSide: 100,
  sides: 2,
  matchMinutes: 30,
  decisionsPerAgentPerMin: 10,          // one decision every ~10 game ticks (600 ms ticks)
  share: { t1: 85, t2: 10, t3: 3.5, t4: 1, t5: 0.5 }, // % of decisions per tier
  smallTokensIn: 300, smallTokensOut: 10,            // t2 decision
  llmTokensIn: 1500, llmTokensOut: 150,              // t3-t5 decision
  cacheHitShare: 70,                                 // % of foundation input served from prompt cache
  foundationModel: 'claude-haiku-5-5',
  foundation: { ...PRICE_PRESETS['claude-haiku-5-5'] },
  // Strategist translation: each human message to the sangha is turned into
  // sangha-wide intent + role sliders by one foundation-model call.
  strategistCallsPerMin: 2,
  strategistTokensIn: 6000, strategistTokensOut: 600,
  strategistModel: 'claude-opus-5-5',
  strategist: { ...PRICE_PRESETS['claude-opus-5-5'] },
  // Local inference, expressed as GPU rental $/h and batched throughput (tokens/s).
  gpu: {
    t2: { dollarsPerHour: 0.40, tokensPerSec: 20000 }, // small model on a consumer GPU
    t3: { dollarsPerHour: 0.40, tokensPerSec: 1500 },  // ~27B quantised, batched, one 24 GB GPU
    t4: { dollarsPerHour: 16.0, tokensPerSec: 5000 },  // DeepSeek-size on an 8-GPU node
  },
  // Servers: one LostCity world holds at most 2047 players; we plan 1000 per world.
  agentsPerWorld: 1000,
  vcpuPerWorld: 2,
  botsPerVcpu: 100,          // headless lite clients + swarm controller per vCPU
  dollarsPerVcpuHour: 0.04,
  cooperativeShare: 60,      // % of decisions that act on the sangha's shared intent
};

export function clone(o) { return JSON.parse(JSON.stringify(o)); }

const perM = (tokens, price) => (tokens / 1e6) * price;

export function localPricePerM(g) {
  // $ per million tokens when the GPU is kept busy.
  return g.tokensPerSec > 0 ? g.dollarsPerHour / (g.tokensPerSec * 3600) * 1e6 : 0;
}

function foundationCost(callsIn, callsOut, cacheHitShare, p) {
  const hit = Math.min(Math.max(cacheHitShare, 0), 100) / 100;
  return perM(callsIn * (1 - hit), p.in) + perM(callsIn * hit, p.cachedIn) + perM(callsOut, p.out);
}

/** Estimate one match. Returns totals, breakdown rows and SMILE-view numbers. */
export function estimate(input) {
  const p = { ...clone(DEFAULTS), ...clone(input || {}) };
  p.share = { ...DEFAULTS.share, ...(input && input.share) };
  p.gpu = { ...clone(DEFAULTS.gpu), ...(input && input.gpu) };
  const agents = p.agentsPerSide * p.sides;
  const hours = p.matchMinutes / 60;
  const decisions = agents * p.matchMinutes * p.decisionsPerAgentPerMin;
  const shareSum = Object.values(p.share).reduce((a, b) => a + Number(b || 0), 0) || 1;
  const n = id => decisions * Number(p.share[id] || 0) / shareSum;

  const rows = [];
  const t2Tok = n('t2') * (p.smallTokensIn + p.smallTokensOut);
  const t3Tok = n('t3') * (p.llmTokensIn + p.llmTokensOut);
  const t4Tok = n('t4') * (p.llmTokensIn + p.llmTokensOut);
  rows.push({ id: 't1', label: 'T1 deterministic', decisions: n('t1'), tokens: 0, cost: 0 });
  rows.push({ id: 't2', label: 'T2 small local models', decisions: n('t2'), tokens: t2Tok, cost: perM(t2Tok, localPricePerM(p.gpu.t2)) });
  rows.push({ id: 't3', label: 'T3 local LLM', decisions: n('t3'), tokens: t3Tok, cost: perM(t3Tok, localPricePerM(p.gpu.t3)) });
  rows.push({ id: 't4', label: 'T4 big local model', decisions: n('t4'), tokens: t4Tok, cost: perM(t4Tok, localPricePerM(p.gpu.t4)) });
  const t5In = n('t5') * p.llmTokensIn, t5Out = n('t5') * p.llmTokensOut;
  rows.push({ id: 't5', label: 'T5 foundation (' + (p.foundation.label || p.foundationModel) + ')', decisions: n('t5'), tokens: t5In + t5Out, cost: foundationCost(t5In, t5Out, p.cacheHitShare, p.foundation) });
  const sCalls = p.sides * p.matchMinutes * p.strategistCallsPerMin;
  const sIn = sCalls * p.strategistTokensIn, sOut = sCalls * p.strategistTokensOut;
  rows.push({ id: 'strategist', label: 'Strategist translation (' + (p.strategist.label || p.strategistModel) + ')', decisions: sCalls, tokens: sIn + sOut, cost: foundationCost(sIn, sOut, p.cacheHitShare, p.strategist) });

  const worlds = Math.max(1, Math.ceil(agents / Math.max(1, p.agentsPerWorld)));
  const worldVcpu = worlds * p.vcpuPerWorld;
  const clientVcpu = Math.ceil(agents / Math.max(1, p.botsPerVcpu));
  const vcpu = worldVcpu + clientVcpu;
  rows.push({ id: 'servers', label: `Servers (${worlds} world${worlds > 1 ? 's' : ''}, ${vcpu} vCPU)`, decisions: 0, tokens: 0, cost: vcpu * hours * p.dollarsPerVcpuHour });

  const total = rows.reduce((a, r) => a + r.cost, 0);
  const agentHours = agents * hours;
  const llmDecisions = n('t3') + n('t4') + n('t5');
  const cooperative = decisions * p.cooperativeShare / 100;
  return {
    params: p,
    agents, hours, decisions, worlds, vcpu, rows, total,
    perAgentHour: agentHours ? total / agentHours : 0,
    perDecision: decisions ? total / decisions : 0,
    forbearance: decisions ? (n('t1') + n('t2')) / decisions : 0,
    llmDecisions,
    cooperative,
    cooperationPerDollar: total ? cooperative / total : Infinity,
  };
}

/** The same parameters at 1000 v 1000 for one hour. */
export function per1000v1000Hour(input) {
  return estimate({ ...clone(input || {}), agentsPerSide: 1000, sides: 2, matchMinutes: 60 });
}

export function fmtUSD(x) {
  if (!isFinite(x)) return '—';
  if (x === 0) return '$0';
  if (Math.abs(x) < 0.01) return '$' + x.toFixed(4);
  if (Math.abs(x) < 100) return '$' + x.toFixed(2);
  return '$' + Math.round(x).toLocaleString('en-US');
}

export function fmtInt(x) { return Math.round(x).toLocaleString('en-US'); }
