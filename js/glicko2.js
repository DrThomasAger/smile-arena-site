// Glicko-2 (Glickman, "Example of the Glicko-2 system", 2013). One call = one rating period.
export const DEFAULT_RATING = 1500, DEFAULT_RD = 350, DEFAULT_VOL = 0.06;
const SCALE = 173.7178;

export function newPlayer() { return { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL, games: 0 }; }

const g = phi => 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
const E = (mu, muj, phij) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/**
 * Update one player for one rating period.
 * @param p player {rating, rd, vol}
 * @param results [{rating, rd, score}] opponents as they were at the start of the period; score 1/0.5/0
 * @param tau system constant (0.3 to 1.2; smaller = volatility changes more slowly)
 */
export function updatePlayer(p, results, tau = 0.5) {
  const mu = (p.rating - 1500) / SCALE;
  const phi = p.rd / SCALE;
  if (!results.length) {
    const phiStar = Math.sqrt(phi * phi + p.vol * p.vol);
    return { ...p, rd: Math.min(phiStar * SCALE, DEFAULT_RD) };
  }
  let vInv = 0, deltaSum = 0;
  for (const r of results) {
    const muj = (r.rating - 1500) / SCALE, phij = r.rd / SCALE;
    const e = E(mu, muj, phij);
    vInv += g(phij) ** 2 * e * (1 - e);
    deltaSum += g(phij) * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;
  // Volatility: Illinois-algorithm root find (step 5 of the paper).
  const a = Math.log(p.vol * p.vol);
  const f = x => {
    const ex = Math.exp(x);
    return ex * (delta * delta - phi * phi - v - ex) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau);
  };
  let A = a, B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * tau) < 0) k++; B = a - k * tau; }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + (A - B) * fA / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA /= 2; }
    B = C; fB = fC;
  }
  const vol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * deltaSum;
  return { ...p, rating: muNew * SCALE + 1500, rd: phiNew * SCALE, vol, games: (p.games || 0) + results.length };
}

/**
 * Rate a list of periods. Each period is a list of games {a, b, score} (score for a: 1, 0.5, 0).
 * Multi-entrant events (speedrun races) should be expanded into pairwise games first (see pairwise()).
 */
export function ratePeriods(periods, tau = 0.5) {
  const players = new Map();
  const get = id => { if (!players.has(id)) players.set(id, newPlayer()); return players.get(id); };
  for (const games of periods) {
    const snap = new Map();
    for (const gm of games) { snap.set(gm.a, { ...get(gm.a) }); snap.set(gm.b, { ...get(gm.b) }); }
    const res = new Map();
    for (const gm of games) {
      const A = snap.get(gm.a), B = snap.get(gm.b);
      (res.get(gm.a) || res.set(gm.a, []).get(gm.a)).push({ rating: B.rating, rd: B.rd, score: gm.score });
      (res.get(gm.b) || res.set(gm.b, []).get(gm.b)).push({ rating: A.rating, rd: A.rd, score: 1 - gm.score });
    }
    for (const [id, p] of players) players.set(id, updatePlayer(p, res.get(id) || [], tau));
  }
  return players;
}

/** Expand a finishing order (best first) into pairwise games. */
export function pairwise(order) {
  const out = [];
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) out.push({ a: order[i], b: order[j], score: 1 });
  return out;
}
