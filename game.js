import {
  mulberry32,
  createInitialState,
  draftLaws,
  enactLaw,
  simSeason,
  winner,
  sufferingIndex,
  buildShareText,
  MAX_YEARS,
} from './war.mjs';

const SIDE_A_NAME = 'Ostrun';
const SIDE_B_NAME = 'Meridale';
const STORAGE_KEY = 'armistice_v1';
const SHARE_URL = 'http://armistice.defimagic.io';

const VERDICT_COPY = {
  A: `${SIDE_A_NAME} took the field. The war is over. The peace was never tried.`,
  B: `${SIDE_B_NAME} took the field. The war is over. The peace was never tried.`,
  DRAW: 'Both armies broke at once. There is no one left to accept a surrender.',
  ARMISTICE: 'Twenty years. Neither flag came down. That was the whole job.',
};

function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { bestYears: 0, gamesPlayed: 0 };
    const parsed = JSON.parse(raw);
    return {
      bestYears: Number(parsed.bestYears) || 0,
      gamesPlayed: Number(parsed.gamesPlayed) || 0,
    };
  } catch (e) {
    return { bestYears: 0, gamesPlayed: 0 };
  }
}

function saveGame(save) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch (e) {
    /* storage unavailable — play continues without persistence */
  }
}

function dailySeed(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return y * 372 + m * 31 + d;
}

function randomSeed() {
  return Math.floor(Date.now() % 1000000);
}

const el = {};
function q(id) {
  return document.getElementById(id);
}

function showScreen(name) {
  for (const key of ['title', 'howto', 'play', 'end']) {
    el['screen-' + key].classList.toggle('hidden', key !== name);
  }
}

function fmt(n) {
  return Math.round(n).toLocaleString();
}

const app = {
  seed: null,
  state: null,
  drafted: null,
  simRng: null,
  draftRng: null,
  save: loadSave(),
};

function startGame(seed) {
  app.seed = seed;
  app.state = createInitialState(seed);
  app.simRng = mulberry32(seed ^ 0x9e3779b9);
  app.draftRng = mulberry32(seed ^ 0x1234abcd);
  app.drafted = draftLaws(app.state, app.draftRng);
  showScreen('play');
  renderPlay();
}

function resolveSeason() {
  app.state = simSeason(app.state, app.simRng());
  const w = winner(app.state);
  if (w) {
    endGame(w);
    return;
  }
  app.drafted = draftLaws(app.state, app.draftRng);
  renderPlay();
}

function enact(lawId) {
  app.state = enactLaw(app.state, lawId);
  resolveSeason();
}

function endGame(w) {
  app.save.gamesPlayed += 1;
  if (app.state.year > app.save.bestYears) app.save.bestYears = app.state.year;
  saveGame(app.save);
  showScreen('end');
  renderEnd(w);
}

function renderPlay() {
  const s = app.state;
  el['front-fill'].style.width = s.front + '%';
  el['front-marker'].style.left = s.front + '%';
  el['year-count'].textContent = s.year;
  el['years-left'].textContent = Math.max(0, MAX_YEARS - s.year);
  el['suffering-count'].textContent = fmt(sufferingIndex(s));

  el['a-army'].style.width = Math.min(100, s.A.army / 3) + '%';
  el['b-army'].style.width = Math.min(100, s.B.army / 3) + '%';
  el['a-econ'].style.width = Math.min(100, s.A.economy / 1.5) + '%';
  el['b-econ'].style.width = Math.min(100, s.B.economy / 1.5) + '%';
  el['a-army-num'].textContent = fmt(s.A.army);
  el['b-army-num'].textContent = fmt(s.B.army);
  el['a-econ-num'].textContent = fmt(s.A.economy);
  el['b-econ-num'].textContent = fmt(s.B.economy);

  el['law-cards'].innerHTML = '';
  for (const law of app.drafted) {
    const card = document.createElement('button');
    card.className = 'law-card';
    card.type = 'button';
    card.innerHTML = `<span class="law-name">${law.name}</span><span class="law-desc">${law.desc}</span>`;
    card.addEventListener('click', () => enact(law.id));
    el['law-cards'].appendChild(card);
  }
}

function renderEnd(w) {
  el['end-headline'].textContent =
    w === 'ARMISTICE' ? 'The Armistice Holds' : w === 'DRAW' ? 'Mutual Collapse' : `${w === 'A' ? SIDE_A_NAME : SIDE_B_NAME} Wins`;
  el['end-copy'].textContent = VERDICT_COPY[w] || '';
  el['end-years'].textContent = app.state.year;
  el['end-suffering'].textContent = fmt(sufferingIndex(app.state));
  el['end-best'].textContent = app.save.bestYears;
  el['end-share'].value = buildShareText(app.seed, app.state, SHARE_URL);
}

function wireUI() {
  const ids = [
    'screen-title', 'screen-howto', 'screen-play', 'screen-end',
    'btn-play-random', 'btn-play-daily', 'btn-howto', 'btn-howto-back',
    'btn-play-again', 'btn-end-title', 'front-fill', 'front-marker',
    'year-count', 'years-left', 'suffering-count',
    'a-army', 'b-army', 'a-econ', 'b-econ',
    'a-army-num', 'b-army-num', 'a-econ-num', 'b-econ-num',
    'law-cards', 'end-headline', 'end-copy', 'end-years', 'end-suffering',
    'end-best', 'end-share', 'btn-copy-share', 'best-years-title',
  ];
  for (const id of ids) el[id] = q(id);

  el['btn-play-random'].addEventListener('click', () => startGame(randomSeed()));
  el['btn-play-daily'].addEventListener('click', () => startGame(dailySeed()));
  el['btn-howto'].addEventListener('click', () => showScreen('howto'));
  el['btn-howto-back'].addEventListener('click', () => showScreen('title'));
  el['btn-play-again'].addEventListener('click', () => showScreen('title'));
  el['btn-end-title'].addEventListener('click', () => showScreen('title'));
  el['btn-copy-share'].addEventListener('click', () => {
    el['end-share'].select();
    try {
      document.execCommand('copy');
    } catch (e) {
      /* clipboard unavailable — text is already selected for manual copy */
    }
  });

  el['best-years-title'].textContent = app.save.bestYears;
  showScreen('title');
}

function installDevHook() {
  const params = new URLSearchParams(location.search);
  if (params.get('dev') !== '1') return;
  window.__g = {
    getState: () => app.state,
    getDrafted: () => app.drafted,
    startGame: (seed) => startGame(seed != null ? seed : 12345),
    enactFirst: () => {
      if (!app.drafted || !app.drafted.length) return false;
      enact(app.drafted[0].id);
      return true;
    },
    enactLaw: (lawId) => {
      enact(lawId);
      return true;
    },
    playToEnd: (seed) => {
      startGame(seed != null ? seed : 12345);
      let guard = 0;
      while (winner(app.state) === null && guard < MAX_YEARS + 2) {
        if (app.drafted && app.drafted.length) enact(app.drafted[0].id);
        guard++;
      }
      return winner(app.state);
    },
    goto: (screenName) => showScreen(screenName),
    screens: ['title', 'howto', 'play', 'end'],
  };
}

wireUI();
installDevHook();
