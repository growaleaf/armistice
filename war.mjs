// ARMISTICE — pure core. No DOM, no WebAudio, no Date.now(), no Math.random().
// Every random input is a seed or an injected roll. Deterministic given the same inputs.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export const MAX_YEARS = 20;
export const FRONT_MIN = 0;
export const FRONT_MAX = 100;

const BASE_RECRUIT_RATE = 0.22;
const ESCALATION_RATE = 0.14;
const BASE_ECON_GROWTH = 0.10;
const UPKEEP_RATE = 0.018;
const CLASH_COMMIT = 0.5;
const CASUALTY_RATE = 0.12;
const FRONT_PUSH_SCALE = 190;
const CASUALTY_NOISE = 0.35;
const MOMENTUM_RATE = 0.34;

export const LAW_POOL = [
  {
    id: 'CONSCRIPTION_CAP',
    name: 'Conscription Caps',
    desc: 'No nation may levy more than half its usual harvest of soldiers this year.',
  },
  {
    id: 'WINTER_TRUCE',
    name: 'Winter Truce',
    desc: 'Both armies stand down at the front for one season. No ground taken. No graves dug.',
  },
  {
    id: 'ARMS_TAX',
    name: 'Arms Tax',
    desc: 'A tithe on every treasury spent toward war, equally levied on both sides.',
  },
  {
    id: 'SUPPLY_LIMITS',
    name: 'Supply Limits',
    desc: 'Convoys are capped. Neither army may grow past what its wagons can feed.',
  },
];

const LAW_IDS = LAW_POOL.map((l) => l.id);

export function createInitialState(seed) {
  const rng = mulberry32(seed);
  let bias = (rng() - 0.5) * 44; // deterministic per-seed asymmetry, drives who eventually breaks
  // Momentum makes front=50 an unstable equilibrium — but a near-zero seed bias
  // takes many seasons to diverge from it. Floor the magnitude so every seed
  // resolves within the same bounded number of seasons (see REQUIRED TESTS).
  const BIAS_FLOOR = 5;
  if (Math.abs(bias) < BIAS_FLOOR) bias = bias >= 0 ? BIAS_FLOOR : -BIAS_FLOOR;
  return {
    year: 0,
    front: 50,
    A: { army: 100, economy: 40 + bias },
    B: { army: 100, economy: 40 - bias },
    suffering: 0,
    laws: {}, // persistent law id -> stack count
    truceActive: false,
    history: [],
  };
}

function conscriptionFactor(state) {
  const n = state.laws.CONSCRIPTION_CAP || 0;
  return 1 / (1 + 0.9 * n);
}

function armsTaxFactor(state) {
  const n = state.laws.ARMS_TAX || 0;
  return 1 / (1 + 0.9 * n);
}

function supplyCap(state) {
  const n = state.laws.SUPPLY_LIMITS || 0;
  if (n === 0) return Infinity;
  return Math.max(90, 260 - n * 35);
}

// draftLaws: pick 3 of the 4 pool entries via a Fisher-Yates shuffle seeded by rng().
export function draftLaws(state, rng) {
  const pool = LAW_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

// enactLaw: pure — returns a new state with the chosen law applied.
export function enactLaw(state, lawId) {
  if (!LAW_IDS.includes(lawId)) return state;
  const next = {
    ...state,
    A: { ...state.A },
    B: { ...state.B },
    laws: { ...state.laws },
  };
  if (lawId === 'WINTER_TRUCE') {
    next.truceActive = true;
  } else {
    next.laws[lawId] = (next.laws[lawId] || 0) + 1;
  }
  return next;
}

// simSeason: advances the war exactly one year. rngRoll in [0,1) is caller-supplied
// (mulberry32 output) and only ever perturbs casualty noise texture, never whether
// or when a breakthrough happens — that's driven by the deterministic seed-bias +
// escalation, so tests can assert bounded breakthrough timing.
export function simSeason(state, rngRoll) {
  const roll = typeof rngRoll === 'number' ? rngRoll : 0.5;
  const cf = conscriptionFactor(state);
  const at = armsTaxFactor(state);
  const cap = supplyCap(state);
  const recruitMult = 1 + state.year * ESCALATION_RATE;

  const next = {
    ...state,
    A: { ...state.A },
    B: { ...state.B },
  };

  // Recruitment
  const growA = next.A.economy * BASE_RECRUIT_RATE * recruitMult * cf;
  const growB = next.B.economy * BASE_RECRUIT_RATE * recruitMult * cf;
  next.A.army = clamp(next.A.army + growA, 0, cap);
  next.B.army = clamp(next.B.army + growB, 0, cap);

  // Economy: grows, minus upkeep of standing army, minus arms tax drag, plus/minus
  // a momentum term — the side currently pushing the front holds captured supply
  // lines and territory, which funds it further. This is what makes an unchecked
  // war unstable: any lead, however small, compounds toward a breakthrough.
  // warIntensity: how hard both nations are pressing the war this season.
  // CONSCRIPTION_CAP and ARMS_TAX each throttle it — laws that restrain either
  // recruitment or war spending directly slow how fast the front can move,
  // not just the raw troop/treasury numbers.
  const warIntensity = cf * at;
  const momentumA = ((state.front - 50) / 50) * MOMENTUM_RATE * warIntensity;
  const momentumB = ((50 - state.front) / 50) * MOMENTUM_RATE * warIntensity;
  next.A.economy = Math.max(
    1,
    next.A.economy + next.A.economy * (BASE_ECON_GROWTH * at + momentumA) - next.A.army * UPKEEP_RATE
  );
  next.B.economy = Math.max(
    1,
    next.B.economy + next.B.economy * (BASE_ECON_GROWTH * at + momentumB) - next.B.army * UPKEEP_RATE
  );

  // Clash — skipped entirely on a truce season
  if (!state.truceActive) {
    const committedA = next.A.army * CLASH_COMMIT;
    const committedB = next.B.army * CLASH_COMMIT;
    const totalCommitted = committedA + committedB + 1;
    const strengthRatio = (committedA - committedB) / totalCommitted;
    const frontDelta = strengthRatio * FRONT_PUSH_SCALE * warIntensity;
    next.front = clamp(next.front + frontDelta, FRONT_MIN, FRONT_MAX);

    const noise = 1 + (roll - 0.5) * CASUALTY_NOISE;
    const casA = committedA * CASUALTY_RATE * noise;
    const casB = committedB * CASUALTY_RATE * noise;
    next.A.army = clamp(next.A.army - casA, 0, cap);
    next.B.army = clamp(next.B.army - casB, 0, cap);
    next.suffering = state.suffering + (casA + casB) * 1.0;
  } else {
    // Truce still costs — hunger, displacement, the slow grind of standing armies.
    next.suffering = state.suffering + (next.A.army + next.B.army) * 0.01;
  }

  next.truceActive = false;
  next.year = state.year + 1;
  next.history = [...state.history, { year: state.year, front: next.front, suffering: next.suffering }];

  return next;
}

export function winner(state) {
  if (state.front <= FRONT_MIN) return 'B';
  if (state.front >= FRONT_MAX) return 'A';
  if (state.A.army <= 0 && state.B.army > 0) return 'B';
  if (state.B.army <= 0 && state.A.army > 0) return 'A';
  if (state.A.army <= 0 && state.B.army <= 0) return 'DRAW';
  if (state.year >= MAX_YEARS) return 'ARMISTICE';
  return null;
}

export function sufferingIndex(state) {
  return Math.round(state.suffering);
}

// Share text: "🕊️ ARMISTICE seed N · peace held Y years · suffering S · <url>"
// buildShareText/parseShareText round-trip the three numbers embedded in it.
export function buildShareText(seed, state, url) {
  return `\u{1F54A}️ ARMISTICE seed ${seed} · peace held ${state.year} years · suffering ${sufferingIndex(state)} · ${url}`;
}

export function parseShareText(text) {
  const m = /seed (\d+) .* peace held (\d+) years .* suffering (\d+)/.exec(text);
  if (!m) return null;
  return { seed: Number(m[1]), years: Number(m[2]), suffering: Number(m[3]) };
}

// runBaseline: simulate with no laws ever enacted. Pure given seed.
export function runBaseline(seed, maxYears = MAX_YEARS) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  let state = createInitialState(seed);
  while (!winner(state) && state.year < maxYears) {
    state = simSeason(state, rng());
  }
  return state;
}

// runWithPolicy: simulate letting policyFn choose which drafted law (or null) to
// enact each round. policyFn(state, draftedLaws) -> lawId | null. Pure given seed
// and a pure policyFn.
export function runWithPolicy(seed, policyFn, maxYears = MAX_YEARS) {
  const simRng = mulberry32(seed ^ 0x9e3779b9);
  const draftRng = mulberry32(seed ^ 0x1234abcd);
  let state = createInitialState(seed);
  while (!winner(state) && state.year < maxYears) {
    const drafted = draftLaws(state, draftRng);
    const chosen = policyFn(state, drafted);
    if (chosen) state = enactLaw(state, chosen);
    state = simSeason(state, simRng());
  }
  return state;
}
