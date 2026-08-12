// ARMISTICE headless tests. `node test.mjs` — exit 0 = green.
import {
  mulberry32,
  clamp,
  createInitialState,
  draftLaws,
  enactLaw,
  simSeason,
  winner,
  sufferingIndex,
  runBaseline,
  runWithPolicy,
  buildShareText,
  parseShareText,
  LAW_POOL,
  MAX_YEARS,
} from './war.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(name);
  }
}

// ---------------------------------------------------------------------------
// 1. mulberry32 determinism: same seed -> same sequence
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  check('mulberry32 deterministic for same seed', JSON.stringify(seqA) === JSON.stringify(seqB));
}

// 2. mulberry32 differs across seeds
{
  const a = mulberry32(1)();
  const b = mulberry32(2)();
  check('mulberry32 differs across seeds', a !== b);
}

// 3. createInitialState is deterministic for a given seed
{
  const s1 = createInitialState(7);
  const s2 = createInitialState(7);
  check('createInitialState deterministic', JSON.stringify(s1) === JSON.stringify(s2));
}

// 4. simSeason is deterministic given the same state + rngRoll
{
  const s0 = createInitialState(3);
  const a = simSeason(s0, 0.5);
  const b = simSeason(s0, 0.5);
  check('simSeason deterministic given same input', JSON.stringify(a) === JSON.stringify(b));
}

// 5. simSeason input state is not mutated (pure function)
{
  const s0 = createInitialState(3);
  const snapshot = JSON.parse(JSON.stringify(s0));
  simSeason(s0, 0.5);
  check('simSeason does not mutate input state', JSON.stringify(s0) === JSON.stringify(snapshot));
}

// 6. runBaseline is fully deterministic for a fixed seed
{
  const r1 = runBaseline(11);
  const r2 = runBaseline(11);
  check('runBaseline deterministic for fixed seed', JSON.stringify(r1) === JSON.stringify(r2));
}

// 7. REQUIRED: with NO laws, one side wins within 8 seasons across 50 seeds — the war is real
{
  let allResolved = true;
  const unresolved = [];
  for (let seed = 1; seed <= 50; seed++) {
    const final = runBaseline(seed, 8);
    const w = winner(final);
    if (w !== 'A' && w !== 'B') {
      allResolved = false;
      unresolved.push(seed);
    }
  }
  check(
    `no-law baseline resolves (A or B wins) within 8 seasons, all 50 seeds (unresolved: ${unresolved.join(',')})`,
    allResolved
  );
}

// 8. REQUIRED: each law measurably shifts outcome (year and/or suffering) vs baseline
{
  const lawIds = LAW_POOL.map((l) => l.id);
  let allShift = true;
  const failedLaws = [];
  for (const lawId of lawIds) {
    const policy = (state, drafted) => {
      const found = drafted.find((l) => l.id === lawId);
      return found ? found.id : drafted[0] ? drafted[0].id : null;
    };
    let anyDiffered = false;
    for (let seed = 1; seed <= 5; seed++) {
      const base = runBaseline(seed, MAX_YEARS);
      const withLaw = runWithPolicy(seed, policy, MAX_YEARS);
      if (base.year !== withLaw.year || sufferingIndex(base) !== sufferingIndex(withLaw)) {
        anyDiffered = true;
      }
    }
    if (!anyDiffered) {
      allShift = false;
      failedLaws.push(lawId);
    }
  }
  check(`every law measurably shifts outcome vs baseline on fixed seeds (failed: ${failedLaws.join(',')})`, allShift);
}

// 9. REQUIRED: a known-good law sequence extends stalemate >= 2x baseline on 10 seeds
{
  const goodPolicy = (state, drafted) => {
    const prefer = ['ARMS_TAX', 'CONSCRIPTION_CAP', 'SUPPLY_LIMITS', 'WINTER_TRUCE'];
    for (const id of prefer) {
      const found = drafted.find((l) => l.id === id);
      if (found) return found.id;
    }
    return drafted[0] ? drafted[0].id : null;
  };
  let allExtend = true;
  const shortfalls = [];
  for (let seed = 1; seed <= 10; seed++) {
    const base = runBaseline(seed, MAX_YEARS);
    const good = runWithPolicy(seed, goodPolicy, MAX_YEARS);
    const ratio = good.year / base.year;
    if (ratio < 2) {
      allExtend = false;
      shortfalls.push(`seed${seed}:${ratio.toFixed(2)}x`);
    }
  }
  check(`good law sequence extends stalemate >=2x baseline, 10 seeds (shortfalls: ${shortfalls.join(',')})`, allExtend);
}

// 10. REQUIRED: suffering is monotonic non-decreasing under escalation (any policy)
{
  let allMonotonic = true;
  for (let seed = 1; seed <= 10; seed++) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    let state = createInitialState(seed);
    let prev = state.suffering;
    while (!winner(state) && state.year < MAX_YEARS) {
      state = simSeason(state, rng());
      if (state.suffering < prev - 1e-9) {
        allMonotonic = false;
        break;
      }
      prev = state.suffering;
    }
  }
  check('suffering is monotonic non-decreasing across full games, 10 seeds', allMonotonic);
}

// 11. REQUIRED: bounds on all state vars hold across full games
{
  let allInBounds = true;
  for (let seed = 1; seed <= 15; seed++) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    let state = createInitialState(seed);
    while (!winner(state) && state.year < MAX_YEARS) {
      state = simSeason(state, rng());
      const inBounds =
        state.front >= 0 &&
        state.front <= 100 &&
        state.A.army >= 0 &&
        state.B.army >= 0 &&
        state.A.economy >= 0 &&
        state.B.economy >= 0 &&
        state.suffering >= 0 &&
        Number.isFinite(state.front) &&
        Number.isFinite(state.A.army) &&
        Number.isFinite(state.B.army);
      if (!inBounds) {
        allInBounds = false;
        break;
      }
    }
  }
  check('all state vars stay in bounds across full games, 15 seeds', allInBounds);
}

// 12. draftLaws returns exactly 3 distinct laws from the 4-law pool
{
  const state = createInitialState(1);
  const rng = mulberry32(99);
  const drafted = draftLaws(state, rng);
  const ids = drafted.map((l) => l.id);
  const uniqueIds = new Set(ids);
  check('draftLaws returns exactly 3 laws', drafted.length === 3);
  check('draftLaws returns 3 distinct laws', uniqueIds.size === 3);
}

// 13. draftLaws is deterministic given the same rng state
{
  const state = createInitialState(1);
  const a = draftLaws(state, mulberry32(5));
  const b = draftLaws(state, mulberry32(5));
  check('draftLaws deterministic for same seed', JSON.stringify(a) === JSON.stringify(b));
}

// 14. enactLaw is pure — does not mutate input state, stacks persistent laws
{
  const s0 = createInitialState(1);
  const snapshot = JSON.parse(JSON.stringify(s0));
  const s1 = enactLaw(s0, 'CONSCRIPTION_CAP');
  check('enactLaw does not mutate input', JSON.stringify(s0) === JSON.stringify(snapshot));
  check('enactLaw stacks persistent law to 1', s1.laws.CONSCRIPTION_CAP === 1);
  const s2 = enactLaw(s1, 'CONSCRIPTION_CAP');
  check('enactLaw stacks persistent law to 2', s2.laws.CONSCRIPTION_CAP === 2);
}

// 15. enactLaw WINTER_TRUCE sets a one-shot flag, consumed by the next simSeason
{
  const s0 = createInitialState(1);
  const s1 = enactLaw(s0, 'WINTER_TRUCE');
  check('WINTER_TRUCE sets truceActive', s1.truceActive === true);
  const beforeFront = s1.front;
  const s2 = simSeason(s1, 0.5);
  check('WINTER_TRUCE truce season does not move the front', s2.front === beforeFront);
  check('WINTER_TRUCE flag consumed after one season', s2.truceActive === false);
}

// 16. winner() every verdict path
{
  const frontZero = { ...createInitialState(1), front: 0 };
  const frontHundred = { ...createInitialState(1), front: 100 };
  const armyAZero = { ...createInitialState(1), A: { army: 0, economy: 40 }, B: { army: 50, economy: 40 } };
  const armyBZero = { ...createInitialState(1), A: { army: 50, economy: 40 }, B: { army: 0, economy: 40 } };
  const bothZero = { ...createInitialState(1), A: { army: 0, economy: 40 }, B: { army: 0, economy: 40 } };
  const stalemate = { ...createInitialState(1), year: MAX_YEARS };
  const ongoing = createInitialState(1);
  check('winner: front<=0 -> B', winner(frontZero) === 'B');
  check('winner: front>=100 -> A', winner(frontHundred) === 'A');
  check('winner: A army 0 -> B', winner(armyAZero) === 'B');
  check('winner: B army 0 -> A', winner(armyBZero) === 'A');
  check('winner: both armies 0 -> DRAW', winner(bothZero) === 'DRAW');
  check('winner: year>=MAX_YEARS -> ARMISTICE', winner(stalemate) === 'ARMISTICE');
  check('winner: ongoing game -> null', winner(ongoing) === null);
}

// 17. sufferingIndex is a non-negative integer
{
  const state = { ...createInitialState(1), suffering: 42.7 };
  check('sufferingIndex rounds to integer', sufferingIndex(state) === 43);
  check('sufferingIndex non-negative on fresh state', sufferingIndex(createInitialState(1)) >= 0);
}

// 18. share text round-trip
{
  for (let seed = 1; seed <= 5; seed++) {
    const state = runBaseline(seed, MAX_YEARS);
    const text = buildShareText(seed, state, 'http://armistice.defimagic.io');
    const parsed = parseShareText(text);
    check(
      `share text round-trips for seed ${seed}`,
      parsed && parsed.seed === seed && parsed.years === state.year && parsed.suffering === sufferingIndex(state)
    );
  }
}

// 19. clamp behaves correctly at and beyond bounds
{
  check('clamp below range', clamp(-5, 0, 100) === 0);
  check('clamp above range', clamp(150, 0, 100) === 100);
  check('clamp within range', clamp(50, 0, 100) === 50);
}

// 20. LAW_POOL has exactly 4 laws with unique ids and non-empty descriptions
{
  const ids = LAW_POOL.map((l) => l.id);
  check('LAW_POOL has exactly 4 laws', LAW_POOL.length === 4);
  check('LAW_POOL ids are unique', new Set(ids).size === 4);
  check(
    'LAW_POOL entries all have name and desc',
    LAW_POOL.every((l) => typeof l.name === 'string' && l.name.length > 0 && typeof l.desc === 'string' && l.desc.length > 0)
  );
}

// 21. SUPPLY_LIMITS caps army growth
{
  let state = createInitialState(2);
  state = enactLaw(state, 'SUPPLY_LIMITS');
  state = enactLaw(state, 'SUPPLY_LIMITS');
  state = enactLaw(state, 'SUPPLY_LIMITS');
  const rng = mulberry32(2 ^ 0x9e3779b9);
  for (let i = 0; i < 15 && !winner(state); i++) {
    state = simSeason(state, rng());
  }
  check('SUPPLY_LIMITS keeps armies under the cap', state.A.army <= 260 - 3 * 35 + 1e-6 && state.B.army <= 260 - 3 * 35 + 1e-6);
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED:', failures.join(' | '));
  process.exit(1);
}
process.exit(0);
