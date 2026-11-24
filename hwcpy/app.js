// HW CPY in the browser: PracticeKit and CWKit (Swift, compiled to WebAssembly) parses the practice files and plans and
// renders each item; this file plays it. The Morse and courtesy tone are scheduled on the AudioContext
// clock; speech uses the Web Speech API, and the replay is scheduled when the speech ends.
// ?v=… when published (publish-web.sh stamps it), so the engine and wasm match this page.
const VERSION = new URL(import.meta.url).searchParams.get('v') ?? '';
const v = VERSION ? `?v=${VERSION}` : '';
const engineReady = import(`./engine.js${v}`).then(({ createEngine }) => createEngine(fetch(`hwcpy.wasm${v}`)));

// ?debug: an event log on the page (a phone has no console), and no service worker, so the newest files load.
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugLines = [];
/// ?keepaudio: leave the page's audio running while the voice speaks, rather than suspending it. An
/// experiment for iPhone (2026-11-24): suspending may let the audio output power down, so the voice
/// starts late or clipped.
const KEEP_AUDIO = new URLSearchParams(location.search).has('keepaudio');
function debug(message) {
  if (!DEBUG) return;
  const line = `${new Date().toISOString().slice(11, 23)} ${message}`;
  debugLines.unshift(line);
  debugLines.length = Math.min(debugLines.length, 80);
  let box = document.getElementById('debugLog');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'debugLog';
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:38vh;overflow:auto;margin:0;padding:6px 8px calc(6px + env(safe-area-inset-bottom));font:11px/1.3 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.82);color:#9f9;z-index:100;white-space:pre-wrap';
    document.body.append(box);
  }
  box.textContent = debugLines.join('\n');
}

if (VERSION && !DEBUG && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { });
}

// MARK: Usage counts (GoatCounter, anonymous, no cookies, nothing stored on the device)

// As in Mock QSO: sent straight to GoatCounter's counting address rather than through its count.js, which always
// adds the page's ?… part. Only the fields below are sent. Not counted on localhost or with ?debug (which logs
// instead); visit the page with #nocount once to stop counting your own visits (#count to start again).
const COUNTER = 'https://g3ajm.goatcounter.com/count';
const counting = (() => {
  try {
    if (location.hash === '#nocount') localStorage.setItem('hwcpy.nocount', '1');
    if (location.hash === '#count') localStorage.removeItem('hwcpy.nocount');
    if (localStorage.getItem('hwcpy.nocount') === '1') return false;
  } catch { }
  return !/^(localhost|127\.|\[::1\])/.test(location.hostname) && location.protocol === 'https:';
})();
function count(fields) {
  const q = new URLSearchParams({ ...fields, s: String(screen.width), rnd: Math.random().toString(36).slice(2) });
  if (DEBUG) { (window.hwcpyCounts ??= []).push(Object.fromEntries(q)); console.info('count', Object.fromEntries(q)); return; }
  if (!counting) return;
  try { fetch(`${COUNTER}?${q}`, { mode: 'no-cors', credentials: 'omit', keepalive: true, referrerPolicy: 'no-referrer' }); } catch { }
}
/// A visit: the page's path and title, and where the visitor came from if it was another site.
function countVisit() {
  let from = '';
  try { if (document.referrer && new URL(document.referrer).origin !== location.origin) from = new URL(document.referrer).origin; } catch { }
  count({ p: location.pathname, t: 'HW CPY', ...(from ? { r: from } : {}) });
}
/// Counts an event, e.g. "set/builtin/Words". Only fixed labels are sent: never the text of a set or the name of a file.
function track(event) {
  count({ p: `hwcpy/${event}`, t: event, e: 'true' });
}

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, val] of Object.entries(props)) {
    if (k === 'class') node.className = val;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), val);
    else if (k in node && typeof val !== 'string') node[k] = val;
    else node.setAttribute(k, val);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};

/// replaceChildren, leaving out nulls.
const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((c) => c != null));

// MARK: Storage (this browser only)

const store = {
  get(key, fallback) {
    try { const s = localStorage.getItem(`hwcpy.${key}`); return s == null ? fallback : JSON.parse(s); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`hwcpy.${key}`, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(`hwcpy.${key}`); } catch { } },
};

// MARK: Settings: the apps' PlaybackSettings keys and defaults

const DEFAULT_ABBREVIATIONS = [
  ['ABT', 'about'], ['AGN', 'again'], ['ANT', 'antenna'], ['BK', 'back'], ['BTU', 'back to you'],
  ['CFM', 'confirm'], ['CPY', 'copy'], ['CUL', 'see you later'], ['DE', 'from'], ['DX', 'D X'],
  ['ES', 'and'], ['FB', 'fine business'], ['FER', 'for'], ['GA', 'good afternoon'],
  ['GE', 'good evening'], ['GM', 'good morning'], ['GN', 'good night'], ['HR', 'here'],
  ['HW', 'how'], ['NR', 'number'], ['OM', 'old man'], ['OP', 'operator'], ['PSE', 'please'],
  ['PWR', 'power'], ['R', 'roger'], ['RPT', 'report'], ['RST', 'R S T'], ['SRI', 'sorry'],
  ['TNX', 'thanks'], ['TU', 'thank you'], ['UR', 'your'], ['VY', 'very'], ['WX', 'weather'],
  ['XYL', 'wife'], ['YL', 'young lady'],
].map(([abbreviation, expansion]) => ({ abbreviation, expansion }));

const DEFAULTS = {
  wpm: 25, spacingMode: 'standard', overallWPM: 15, intervalTraining: false,
  toneHz: 700, riseMs: 4, fallMs: 4,
  shuffle: false, cwPlaysBeforeSpeech: 1, pauseAfterMorse: 1, replayCWAfterSpeech: true, pauseAfterSpeaking: 1,
  pauseBetweenItems: 2, morseVolume: 1, courtesyToneVolume: 1, hideTextUntilSpoken: false,
  playSpeech: true, speechVolume: 1, speechLanguage: '',
  useAbbreviations: false, abbreviations: DEFAULT_ABBREVIATIONS, spaceBeforePunctuation: false,
  silentBackgroundTone: false, padCWAudio: false,
};
const settings = { ...DEFAULTS, ...store.get('settings', {}) };
let sessionMinutes = store.get('sessionMinutes', 0);
let appearance = store.get('appearance', 'system');

function saveSettings() { store.set('settings', settings); }
function applyAppearance() {
  if (appearance === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = appearance;
}
applyAppearance();

/// Interval-training speeds, fastest first: three steps up to 1.5 × WPM, rounded down (as CWKit).
const intervalSpeeds = () => [3, 2, 1, 0].map((step) => Math.floor(settings.wpm + settings.wpm * 0.5 * step / 3));

function speedSummary() {
  if (settings.intervalTraining) { const s = intervalSpeeds(); return `Intervals ${s[0]}–${s[3]} WPM`; }
  const c = Math.trunc(settings.wpm), o = Math.trunc(Math.min(settings.overallWPM, settings.wpm));
  if (o >= c || settings.spacingMode === 'standard') return `${c} WPM`;
  return settings.spacingMode === 'farnsworth' ? `${c}/${o} WPM` : `${c} WPM · words ${o}`;
}

// MARK: Library: recent sets and where each was left, files added in this browser

/// { key, name, source: 'builtin:<id>' | 'file:<id>', location?, lastUsed, lastItem, count }
let library = store.get('library', []);
function saveLibrary() { store.set('library', library); }
function entry(key) { return library.find((e) => e.key === key); }

let catalog = null; // { categories } from sets/catalog.json
const catalogReady = fetch(`sets/catalog.json${v}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalogue ${r.status}`))))
  .then((c) => {
    const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
    for (const cat of c.categories) {
      cat.sets.sort(byName);
      for (const g of cat.groups) g.sets.sort(byName);
    }
    catalog = c;
    return c;
  });

let wholeBlob = null; // sets.bin, when the server doesn't do range requests
/// A built-in set's text: its bytes from sets.bin (a range request where the server allows it), inflated.
async function builtInText(set) {
  let bytes;
  if (wholeBlob) {
    bytes = wholeBlob.slice(set.offset, set.offset + set.length);
  } else {
    const r = await fetch(`sets/sets.bin${v}`, { headers: { Range: `bytes=${set.offset}-${set.offset + set.length - 1}` } });
    if (!r.ok) throw new Error(`The built-in set “${set.name}” couldn't be loaded.`);
    const buffer = await r.arrayBuffer();
    if (r.status === 206 && buffer.byteLength === set.length) bytes = buffer;
    else { wholeBlob = buffer; bytes = buffer.slice(set.offset, set.offset + set.length); }
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function findBuiltIn(id) {
  for (const cat of catalog?.categories ?? []) {
    for (const s of cat.sets) if (s.id === id) return { set: s, location: cat.name };
    for (const g of cat.groups) for (const s of g.sets) if (s.id === id) return { set: s, location: `${cat.name} › ${g.name}` };
  }
  return null;
}

// MARK: Library views

let tab = store.get('tab', 'recent');
let openGroups = new Set(store.get('openGroups', []));

function showTab(name) {
  tab = name;
  store.set('tab', name);
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
  renderLibrary();
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));

const fmt = new Intl.NumberFormat('en-GB');

function setRow(name, sub, onclick, extra) {
  return el('button', { class: 'row', onclick },
    el('span', { class: 'name' }, name, sub ? el('div', { class: 'sub' }, sub) : null), extra ?? null);
}

function progressText(e) {
  if (!e?.count) return null;
  return `${fmt.format(Math.min(e.lastItem + 1, e.count))} of ${fmt.format(e.count)}`;
}

function renderLibrary() {
  if (tab === 'recent') {
    const panel = document.querySelector('[data-panel="recent"]');
    const recent = [...library].sort((a, b) => b.lastUsed - a.lastUsed);
    fill(panel, recent.length
      ? el('div', { class: 'list' }, recent.map((e) => setRow(e.name, [e.location, progressText(e)].filter(Boolean).join(' · '), () => openEntry(e.key))))
      : el('div', { class: 'empty' }, 'Sets you open appear here, with where you left off. Choose one from Built-in, or open your own file from Added.'));
  } else if (tab === 'added') {
    const files = library.filter((e) => e.source.startsWith('file:')).sort((a, b) => a.name.localeCompare(b.name));
    fill($('addedList'), files.length
      ? el('div', { class: 'list' }, files.map((e) => setRow(e.name, progressText(e), () => openEntry(e.key),
        el('span', {
          class: 'icon-btn remove', role: 'button', 'aria-label': `Remove ${e.name}`, tabindex: '0',
          onclick: (ev) => { ev.stopPropagation(); removeEntry(e.key); },
        }, '✕'))))
      : null);
  } else {
    renderBuiltIn();
  }
}

function renderBuiltIn() {
  const host = $('builtinList');
  if (!catalog) return;
  const query = $('search').value.trim().toLowerCase();
  if (query) {
    const words = query.split(/\s+/);
    const hits = [];
    for (const cat of catalog.categories) {
      const consider = (s, where) => { const n = s.name.toLowerCase(); if (words.every((w) => n.includes(w))) hits.push([s, where]); };
      for (const s of cat.sets) consider(s, cat.name);
      for (const g of cat.groups) for (const s of g.sets) consider(s, `${cat.name} › ${g.name}`);
    }
    fill(host, hits.length
      ? el('div', { class: 'list' }, hits.slice(0, 200).map(([s, where]) => setRow(s.name, where, () => openBuiltIn(s.id))))
      : el('div', { class: 'empty' }, 'No sets match.'));
    return;
  }
  const details = (key, summary, children) => {
    const d = el('details', {}, el('summary', {}, summary), children);
    d.open = openGroups.has(key);
    d.addEventListener('toggle', () => {
      if (d.open) openGroups.add(key); else openGroups.delete(key);
      store.set('openGroups', [...openGroups]);
    });
    return d;
  };
  const section = (title, kind) => [
    el('div', { class: 'section-title' }, title),
    el('div', { class: 'list' }, catalog.categories.filter((c) => c.section === kind).map((cat) => {
      const count = cat.sets.length + cat.groups.reduce((n, g) => n + g.sets.length, 0);
      return details(cat.name, [el('span', { class: 'name' }, cat.name), el('span', { class: 'count' }, fmt.format(count))], [
        ...cat.groups.map((g) => details(`${cat.name}›${g.name}`, [el('span', { class: 'name' }, g.name), el('span', { class: 'count' }, fmt.format(g.sets.length))],
          g.sets.map((s) => setRow(s.name, progressText(entry(`builtin:${s.id}`)), () => openBuiltIn(s.id))))),
        ...cat.sets.map((s) => setRow(s.name, progressText(entry(`builtin:${s.id}`)), () => openBuiltIn(s.id))),
      ]);
    })),
  ];
  fill(host, ...section('Practice sets', 'sets'), ...section('Courses', 'courses'));
}
$('search').addEventListener('input', () => renderBuiltIn());

$('openFile').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async () => {
  const file = $('fileInput').files?.[0];
  $('fileInput').value = '';
  if (!file) return;
  const text = await file.text();
  const id = `${file.name}:${text.length}`;
  const key = `file:${id}`;
  if (!store.set(`file.${id}`, text)) toast('This file is too big to keep in the browser; it plays now but won’t be remembered.');
  if (!entry(key)) library.push({ key, name: file.name.replace(/\.txt$/i, ''), source: key, lastUsed: Date.now(), lastItem: 0, count: 0 });
  track('set/your file');
  saveLibrary();
  await openEntry(key, text);
});

function removeEntry(key) {
  const e = entry(key);
  if (!e || !confirm(`Remove “${e.name}” from this browser?`)) return;
  library = library.filter((x) => x.key !== key);
  saveLibrary();
  store.remove(`file.${key.slice(5)}`);
  if (current?.key === key) closeSet();
  renderLibrary();
}

async function openBuiltIn(id) {
  await catalogReady;
  const found = findBuiltIn(id);
  if (!found) return;
  const key = `builtin:${id}`;
  track(`set/builtin/${found.location.split(' › ')[0]}`);
  if (!entry(key)) library.push({ key, name: found.set.name, location: found.location, source: key, lastUsed: Date.now(), lastItem: 0, count: 0 });
  await openEntry(key);
}

// MARK: The player

let engine = null;
let current = null; // { key, name, items, order, position }
let playing = false;
let phase = 'idle'; // idle | sending | speaking | replaying | between
let sendingPlay = 1;
let revealed = false;
let autoPause = false;
let gate = null; // auto-paused: { rest: steps, samples } waiting for play
let run = 0; // bumped on every stop, so a superseded loop ends
let itemStartedAt = 0;
let sessionPlayed = 0, sessionMark = 0, sessionEnded = false;
let errorText = '';

async function openEntry(key, text) {
  const e = entry(key);
  if (!e) return;
  stop();
  // A big set takes a moment to read: say so, and let the page draw before the work starts.
  showPlayer(true);
  $('setName').textContent = e.name;
  fill($('phraseArea'), el('div', { class: 'empty' }, 'Loading…'));
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    engine ??= await engineReady;
    if (text == null) {
      if (e.source.startsWith('builtin:')) {
        await catalogReady;
        const found = findBuiltIn(e.source.slice(8));
        if (!found) throw new Error('This set is no longer built in.');
        text = await builtInText(found.set);
      } else {
        text = store.get(`file.${e.source.slice(5)}`, null);
        if (text == null) throw new Error('This file isn’t stored in this browser any more. Open it again from Added.');
      }
    }
    const items = engine.parse(text);
    if (!items.some((i) => i.kind === 'drill')) throw new Error('No words or phrases were found in this file.');
    e.count = items.length;
    e.lastUsed = Date.now();
    e.lastItem = Math.min(e.lastItem ?? 0, items.length - 1);
    saveLibrary();
    current = { key, name: e.name, items, order: [], position: 0 };
    current.order = makeOrder(e.lastItem);
    current.position = Math.max(0, current.order.indexOf(e.lastItem));
    store.set('open', key);
    errorText = '';
    showPlayer(true);
    render();
    updateMediaSession();
  } catch (err) {
    toast(err.message ?? String(err));
    if (!current) showPlayer(false);
    render();
  }
  renderLibrary();
}

function closeSet() {
  stop();
  current = null;
  store.remove('open');
  showPlayer(false);
  render();
}

function showPlayer(show) {
  if (show) { $('library').setAttribute('hidden-narrow', ''); $('player').removeAttribute('hidden-narrow'); }
  else { $('player').setAttribute('hidden-narrow', ''); $('library').removeAttribute('hidden-narrow'); }
  document.body.classList.toggle('in-player', show); // shows the back arrow in the header on a phone
}
$('back').addEventListener('click', () => {
  // Leaving the player pauses it, as in the apps.
  if (playing) pause();
  showPlayer(false);
  renderLibrary();
});

/// Groups that keep spoken hints and courtesy tones with the drill they lead into (PracticeOrder.groups).
function groups(items) {
  const out = []; let cur = [];
  items.forEach((item, i) => { cur.push(i); if (item.kind === 'drill') { out.push(cur); cur = []; } });
  if (cur.length) out.push(cur);
  return out;
}
function makeOrder(startIndex) {
  const items = current?.items ?? [];
  if (!settings.shuffle) return items.map((_, i) => i);
  const all = groups(items);
  const first = all.findIndex((g) => g.includes(startIndex));
  const lead = first >= 0 ? all.splice(first, 1) : [];
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return [...lead, ...all].flat();
}

// MARK: Audio

let ctx = null, cwGain = null, courtesyGain = null, background = null;
const scheduled = new Set();
const timers = new Set();

function audio() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'playback' });
    cwGain = ctx.createGain(); cwGain.connect(ctx.destination);
    courtesyGain = ctx.createGain(); courtesyGain.connect(ctx.destination);
    // The Morse is rendered at this rate, so the page itself never resamples it.
    debug(`audio at ${ctx.sampleRate} Hz, latency ${((ctx.baseLatency ?? 0) * 1000).toFixed(0)} ms`);
    // Safari suspends or interrupts the audio (when speech takes over the audio session, a call comes in,
    // or the page is hidden). While playing, ask for it back; if that fails, pause properly rather than
    // carrying on in silence.
    ctx.addEventListener('statechange', () => {
      debug(`audio ${ctx.state} at ${ctx.currentTime.toFixed(2)}`);
      // While the voice speaks the page's audio is suspended on purpose (see the loop); leave it be.
      if (!playing || speechHoldsAudio || ctx.state === 'running' || ctx.state === 'closed') return;
      ctx.resume().then(() => debug(`audio resumed: ${ctx.state}`), (err) => debug(`resume failed: ${err}`));
      setTimeout(() => {
        if (playing && !speechHoldsAudio && ctx.state !== 'running') {
          pause();
          showError('The browser stopped the sound. Press play to carry on.');
        }
      }, 3000);
    });
  }
  cwGain.gain.value = settings.morseVolume;
  courtesyGain.gain.value = settings.courtesyToneVolume;
  return ctx;
}

/// True while the voice speaks: the page's audio is suspended so the speech has the iPhone's audio to
/// itself. With both active, iOS interrupts one or both (the speech is cancelled and the page's audio
/// stops).
let speechHoldsAudio = false;

/// Resumes the audio; resolves true once it is running, or false after `timeout` ms. (WebKit can report
/// the context running before resume()'s promise settles, so the state change counts too.)
function resumeAudio(timeout = 2000) {
  if (ctx.state === 'running') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      ctx.removeEventListener('statechange', onChange);
      resolve(ctx.state === 'running');
    };
    const onChange = () => { if (ctx.state === 'running') finish(); };
    ctx.addEventListener('statechange', onChange);
    ctx.resume().then(finish, () => { });
    setTimeout(finish, timeout);
  });
}

/// Must run in a tap's handler: iOS only lets audio and speech start from a user gesture. Resolves once
/// it is safe to start the Morse: on an iPhone, speech starting takes over the audio session and can cut
/// off sound that is already playing, so the silent unlock utterance has to finish first.
function unlockAudio() {
  // "playback": iOS treats it as media (plays with the silent switch on, and on the lock screen).
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { }
  const c = audio();
  if (c.state !== 'running') c.resume().catch(() => { });
  if (!('speechSynthesis' in window) || unlockAudio.spoke) return Promise.resolve();
  unlockAudio.spoke = true;
  return new Promise((resolve) => {
    // Empty, not a space: Chrome can hang its whole queue on an utterance of only whitespace.
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    const done = () => { debug('speech unlocked'); setTimeout(resolve, 150); };
    u.onend = done;
    u.onerror = done;
    setTimeout(resolve, 800); // some engines send no events for an empty utterance
    speechSynthesis.speak(u);
  });
}

function play(samples, offset, count, when, gain) {
  const buffer = ctx.createBuffer(1, Math.max(1, count), ctx.sampleRate);
  buffer.copyToChannel(samples.subarray(offset, offset + count), 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  src.start(when);
  debug(`sound ${(count / ctx.sampleRate).toFixed(2)} s at ${when.toFixed(2)} (now ${ctx.currentTime.toFixed(2)}, ${ctx.state})`);
  src.onended = () => { scheduled.delete(src); debug(`sound ended at ${ctx.currentTime.toFixed(2)}`); };
  scheduled.add(src);
}

function updateBackground() {
  const want = playing && settings.silentBackgroundTone;
  if (want && !background) {
    const c = audio();
    const buffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.0001; // about −80 dBFS
    background = c.createBufferSource();
    background.buffer = buffer; background.loop = true;
    background.connect(c.destination);
    background.start();
  } else if (!want && background) {
    try { background.stop(); } catch { }
    background = null;
  }
}

/// Runs `fn` when the AudioContext clock reaches `time`.
function at(time, fn, token) {
  const id = setTimeout(() => { timers.delete(id); if (token === run) fn(); }, Math.max(0, (time - ctx.currentTime) * 1000));
  timers.add(id);
}
const until = (time, token) => new Promise((resolve) => at(time, resolve, token));

// MARK: Speech

let voices = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const list = speechSynthesis.getVoices();
  if (list.length === voices.length) return; // WebKit fires voiceschanged again after each getVoices()
  voices = list;
  if ($('settings').open) renderSettings();
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

function voiceFor(language) {
  if (!language) return null;
  return voices.find((x) => x.lang.replace('_', '-') === language && x.localService)
    ?? voices.find((x) => x.lang.replace('_', '-') === language) ?? null;
}

/// Apple's voices read a lone capital as "capital E"; a lone lower-case letter is read as the letter.
const speakable = (text) => (/^\s*\p{Lu}\s*$/u.test(text) ? text.trim().toLowerCase() : text);

// Chrome can lose an utterance's end event if nothing holds on to it.
const speaking = new Set();
function speak(text, token) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text.trim()) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(speakable(text));
    const voice = voiceFor(settings.speechLanguage);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else if (settings.speechLanguage) u.lang = settings.speechLanguage;
    u.volume = settings.speechVolume;
    speaking.add(u);
    let done = false;
    const finish = () => { if (done) return; done = true; speaking.delete(u); clearTimeout(limit); resolve(); };
    // Some engines never send `end` (or are stopped in the background); don't hang the player. The limit
    // runs from the voice starting (6 s to start at all); a paused engine gets one nudge, then the
    // utterance is cleared, so it can't linger and hold up the next.
    const check = (nudged) => {
      debug(`speech gave no end event (speaking ${speechSynthesis.speaking}, paused ${speechSynthesis.paused}, pending ${speechSynthesis.pending})`);
      if (!nudged && speechSynthesis.paused) {
        speechSynthesis.resume();
        limit = setTimeout(() => check(true), 2000);
        return;
      }
      speechSynthesis.cancel();
      finish();
    };
    let limit = setTimeout(() => check(false), 6000);
    const restartLimit = () => {
      clearTimeout(limit);
      limit = setTimeout(() => check(false), 4000 + text.length * 200 / Math.max(0.5, u.rate));
    };
    u.onstart = () => { debug(`speech started: "${u.text}"`); restartLimit(); };
    u.onend = () => { debug('speech ended'); finish(); };
    u.onerror = (e) => { debug(`speech error: ${e.error}`); finish(); };
    if (token !== run) { finish(); return; }
    // Anything still queued (an utterance whose end never came) would hold this one up.
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
  });
}

// MARK: The loop

const LEAD = 0.06; // seconds between deciding and hearing, so buffers start on time

/// Plays from the current position until stopped. `singleSend`: the first item's Morse just once.
/// How long before the speech the page hands the audio to the voice. On an iPhone the switch takes a
/// moment, and a voice starting straight after it lost its first sound ("when" heard as "hen").
const HANDOVER = 0.5;

/// Resolves at `when` (performance.now() time), unless the loop is superseded first.
function sleepUntil(when, token) {
  return new Promise((resolve) => {
    const id = setTimeout(() => { timers.delete(id); resolve(); }, Math.max(0, when - performance.now()));
    timers.add(id);
    if (token !== run) { clearTimeout(id); resolve(); }
  });
}

async function loop(token, { singleSend = false, resumeGate = null } = {}) {
  let t = ctx.currentTime + LEAD;
  let first = true;
  /// When the last Morse or courtesy tone ends (AudioContext time): the hand-over can't start before it.
  let soundEnd = t;
  /// Seconds taken from the next pause, because taking the audio back after the speech took that long.
  let catchUp = 0;
  while (token === run && current) {
    const index = current.order[current.position];
    let steps, samples;
    if (resumeGate) {
      ({ rest: steps, samples } = resumeGate);
      // Play gives the answer at once, without the pause after the Morse.
      while (steps.length && steps[0].type === 'silence') steps = steps.slice(1);
      resumeGate = null;
    } else {
      try {
        ({ steps, samples } = engine.plan(index, settings, ctx.sampleRate, first && singleSend));
      } catch (err) { showError(err.message); stop(); return; }
      const startAt = t;
      at(startAt, () => { itemStartedAt = performance.now(); revealed = false; markPosition(); setPhase('idle'); }, token);
      if (first) { itemStartedAt = performance.now(); revealed = false; markPosition(); }
    }
    first = false;
    // Auto-pause stops after the last send before the speech.
    const lastSend = autoPause ? steps.findLastIndex((s) => s.type === 'morse' && !s.replay) : -1;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (token !== run) return;
      if (s.type === 'morse') {
        play(samples, s.offset, s.count, t, cwGain);
        const play_ = s.play;
        at(t, () => setPhase(s.replay ? 'replaying' : 'sending', play_), token);
        t += s.count / ctx.sampleRate;
        soundEnd = t;
        if (i === lastSend && steps.slice(i + 1).some((x) => x.type === 'speech' || x.type === 'morse')) {
          await until(t, token);
          if (token !== run) return;
          gate = { rest: steps.slice(i + 1), samples };
          playing = false;
          noteSession();
          render();
          updateMediaSession();
          return;
        }
      } else if (s.type === 'courtesy') {
        play(samples, s.offset, s.count, t, courtesyGain);
        t += s.count / ctx.sampleRate;
        soundEnd = t;
      } else if (s.type === 'silence') {
        // The pause before next starts after the last sound of the item.
        if (!steps.slice(i).some((x) => x.type === 'morse' || x.type === 'speech')) at(t, () => setPhase('between'), token);
        const used = Math.min(catchUp, s.seconds);
        catchUp -= used;
        t += s.seconds - used;
      } else if (s.type === 'speech') {
        // Hand the audio to the voice (see speechHoldsAudio) during the silence before it, so the switch
        // is over when the voice starts; then wait out the rest of that silence.
        await until(Math.max(soundEnd, t - HANDOVER), token);
        if (token !== run) return;
        // At least a moment on an iPhone, even when the speech follows straight on (after auto-pause).
        const speakAt = performance.now() + Math.max(Math.max(0, t - ctx.currentTime), IOS ? 0.3 : 0) * 1000;
        speechHoldsAudio = true;
        if (!KEEP_AUDIO) {
          await ctx.suspend().catch(() => { });
          debug(`audio ${ctx.state} for the speech`);
        }
        await sleepUntil(speakAt, token);
        if (token !== run) return;
        setPhase('speaking');
        revealed = true;
        render();
        const speechCalled = performance.now();
        await speak(s.text, token);
        const spokenAt = performance.now();
        debug(`speech took ${((spokenAt - speechCalled) / 1000).toFixed(2)} s from speak() to its end`);
        speechHoldsAudio = false;
        if (token !== run) return;
        if (!(await resumeAudio())) {
          if (token !== run) return;
          debug(`after the speech the audio is ${ctx.state}`);
          pause();
          showError('The browser stopped the sound. Press play to carry on.');
          return;
        }
        if (token !== run) return;
        t = ctx.currentTime + LEAD;
        soundEnd = t;
        // Taking the audio back takes a while on an iPhone (about 0.8 s): count it as part of the pause
        // that follows, so the gap is the one set.
        catchUp = (performance.now() - spokenAt) / 1000;
        if (catchUp > 0.05) debug(`taking the audio back took ${catchUp.toFixed(2)} s`);
      }
    }
    // Next item, unless the session's time is up.
    if (sessionMinutes > 0 && sessionUsed() >= sessionMinutes * 60) {
      await until(t, token);
      if (token !== run) return;
      sessionEnded = true;
      track(`session/${sessionMinutes} min finished`);
      next(false);
      pause();
      return;
    }
    if (current.position + 1 >= current.order.length) {
      await until(t, token);
      if (token !== run) return;
      pause();
      setPhase('idle');
      toast('That’s the end of the set.');
      return;
    }
    // Plan the next item while this one's pause runs, then carry on from the same clock.
    await until(t - 0.5, token);
    if (token !== run) return;
    current.position += 1;
  }
}

function setPhase(p, play = 1) {
  phase = p;
  sendingPlay = play;
  if (p === 'speaking' || p === 'replaying' || p === 'between') revealed = true;
  render();
}

function markPosition() {
  const e = current && entry(current.key);
  if (!e) return;
  e.lastItem = current.order[current.position];
  e.lastUsed = Date.now();
  saveLibrary();
  render();
  updateMediaSession();
}

function sessionUsed() { return sessionPlayed + (playing ? (performance.now() - sessionMark) / 1000 : 0); }
function noteSession() { if (sessionMark) sessionPlayed += (performance.now() - sessionMark) / 1000; sessionMark = 0; }

function start({ singleSend = false } = {}) {
  if (!current || !engine) return;
  // iPhone and iPad Safari mute the voice in silent mode (the Morse still plays), and a page can't tell.
  if (IOS && settings.playSpeech && !store.get('silentHintShown', false)) {
    store.set('silentHintShown', true);
    toast('If you can’t hear the voice, turn off silent mode.');
  }
  const resumeGate = gate;
  // Stop anything still going first: cancelling speech after unlocking would cancel the unlock.
  halt();
  const unlocked = unlockAudio();
  errorText = '';
  if (sessionEnded) { sessionEnded = false; sessionPlayed = 0; }
  if (!playing && !resumeGate && !singleSend) {
    const band = Math.floor(settings.wpm / 5) * 5;
    track(`play/${band}-${band + 4} wpm${settings.spacingMode !== 'standard' ? ` ${settings.spacingMode}` : ''}${settings.intervalTraining ? ' intervals' : ''}`);
    track(`speech/${settings.playSpeech ? 'on' : 'off'}`);
  }
  playing = true;
  sessionMark = performance.now();
  updateBackground();
  render();
  updateMediaSession();
  const token = run;
  const go = () => { if (token === run) loop(token, { singleSend, resumeGate }); };
  unlocked.then(() => resumeAudio()).then(go);
}

/// Stops sound and the loop; keeps the position.
function halt() {
  run += 1;
  for (const src of scheduled) { try { src.stop(); } catch { } }
  scheduled.clear();
  for (const id of timers) clearTimeout(id);
  timers.clear();
  if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
  gate = null;
  speechHoldsAudio = false;
}

function pause() {
  noteSession();
  halt();
  playing = false;
  updateBackground();
  setPhase('idle');
  updateMediaSession();
}
const stop = pause;

function togglePlay() { if (playing) pause(); else start(); }

/// Moves to `position` in the play order, playing from there if playing.
function move(position) {
  if (!current || position < 0 || position >= current.order.length) return;
  const wasPlaying = playing;
  pause();
  current.position = position;
  revealed = false;
  markPosition();
  if (wasPlaying) start();
}
function next(resume = true) {
  if (!current) return;
  if (resume) move(current.position + 1);
  else if (current.position + 1 < current.order.length) { current.position += 1; markPosition(); }
}
/// Like a music app's Previous: sends this item's Morse once more, or, pressed within 2 s of an item
/// starting (or when not started), goes back to the one before.
function previous() {
  if (!current) return;
  const justStarted = !itemStartedAt || performance.now() - itemStartedAt < 2000;
  if (justStarted && current.position > 0) move(current.position - 1);
  else { pause(); start({ singleSend: true }); }
}

$('play').addEventListener('click', togglePlay);
$('next').addEventListener('click', () => next());
$('prev').addEventListener('click', previous);
$('slider').addEventListener('input', () => { $('where').textContent = whereText(Number($('slider').value)); });
$('slider').addEventListener('change', () => move(Number($('slider').value)));
$('shuffleBtn').addEventListener('click', () => {
  settings.shuffle = !settings.shuffle;
  if (settings.shuffle) track('shuffle/on');
  saveSettings();
  if (current) {
    // Keeps the current item; the new order applies from the next one.
    const index = current.order[current.position];
    current.order = makeOrder(index);
    current.position = current.order.indexOf(index);
  }
  render();
});
$('autoPauseBtn').addEventListener('click', () => {
  autoPause = !autoPause;
  if (autoPause) track('auto-pause/on');
  // Turned on while the Morse plays: send it again and stop before the answer.
  if (autoPause && playing && phase === 'sending') { pause(); start(); }
  render();
});
// The same saved setting as Settings ▸ Hide text until spoken; takes effect on the current item at once.
$('hideTextBtn').addEventListener('click', () => {
  settings.hideTextUntilSpoken = !settings.hideTextUntilSpoken;
  if (settings.hideTextUntilSpoken) track('hide-text/on');
  saveSettings();
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog') || !current) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') next();
  else if (e.key === 'ArrowLeft') previous();
});

// MARK: Rendering the player

const ICONS = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
};
const prosigns = (t) => t.replace(/<([A-Z]+)>/g, (_, p) => [...p].map((c) => c + '̅').join(''));

function whereText(position) {
  if (!current) return '';
  const n = current.order.length;
  let s = `${fmt.format(position + 1)} of ${fmt.format(n)}`;
  if (sessionMinutes > 0 && !sessionEnded) {
    const left = Math.max(0, sessionMinutes * 60 - sessionUsed());
    const total = Math.ceil(left);
    s += ` · ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} left`;
  }
  return s;
}

function render() {
  const has = !!current;
  $('setName').textContent = current?.name ?? '';
  $('setName').hidden = !current;
  for (const id of ['play', 'prev', 'next', 'slider', 'contentsBtn']) $(id).disabled = !has;
  if (has) $('next').disabled = current.position + 1 >= current.order.length;
  $('playIcon').innerHTML = playing ? ICONS.pause : ICONS.play;
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('shuffleBtn').setAttribute('aria-pressed', String(settings.shuffle));
  $('autoPauseBtn').setAttribute('aria-pressed', String(autoPause));
  $('hideTextBtn').setAttribute('aria-pressed', String(settings.hideTextUntilSpoken));
  $('speedBtn').textContent = speedSummary();
  $('error').hidden = !errorText;
  $('error').textContent = errorText;

  const badge = $('badge');
  if (sessionEnded) badge.textContent = 'Time’s up';
  else if (gate) badge.textContent = 'Paused';
  else if (!playing) badge.textContent = '';
  else badge.textContent = { sending: sendingPlay > 1 ? `Listen · ${sendingPlay}` : 'Listen', speaking: 'Speaking', replaying: 'Again', between: 'Next', idle: '' }[phase] ?? '';

  if (!has) {
    fill($('phraseArea'), el('div', { class: 'empty' }, 'Choose a practice set.'));
    $('where').textContent = '';
    $('slider').max = 0;
    return;
  }
  const item = current.items[current.order[current.position]];
  const area = $('phraseArea');
  if (item.kind === 'drill') {
    const hide = settings.hideTextUntilSpoken && !revealed;
    if (hide) {
      fill(area, el('div', { class: 'hidden-ear', 'aria-label': 'Text hidden until spoken' }));
      area.firstChild.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0"/><path d="M10 9a2 2 0 0 1 4 0"/></svg>';
    } else {
      const text = prosigns(item.display);
      fill(area, 
        el('div', { class: `phrase${text.length > 24 ? ' long' : ''}` }, text),
        item.spoken ? el('div', { class: 'spoken' }, item.spoken) : null,
        item.then ? el('div', { class: 'then mono' }, `Then ${prosigns(item.then)}`) : null);
    }
  } else if (item.kind === 'speech') {
    fill(area, el('div', { class: 'spoken' }, item.spoken));
  } else {
    fill(area, el('div', { class: 'spoken' }, '🔔'));
  }
  const slider = $('slider');
  slider.max = Math.max(0, current.order.length - 1);
  if (document.activeElement !== slider) slider.value = current.position;
  $('where').textContent = whereText(current.position);
}
setInterval(() => { if (playing && sessionMinutes > 0 && current) $('where').textContent = whereText(current.position); }, 1000);

function showError(message) { errorText = message; render(); }

let toastTimer = 0;
function toast(message) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 4000);
}

// MARK: Lock screen and headphone controls (Media Session API)

/// iPhone and iPad (iPadOS reports itself as a Mac, but has touch).
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
/// iPhone only: where Safari's voice is unreliable. On an iPad mini (6th gen) the owner found it works
/// well (2026-11-24), so the notes about late or clipped speech are for iPhone.
const IPHONE = /iPhone|iPod/.test(navigator.userAgent);
/// Lock-screen and media-key controls. Not on iOS: there the page registered as a media player treats
/// the voice as another player taking over, and iOS pauses the page or stalls the speech (seen on an
/// iPhone, 2026-11-24). It only ever showed the title there anyway, with no working buttons.
const MEDIA_SESSION = 'mediaSession' in navigator && !IOS;

function updateMediaSession() {
  if (!MEDIA_SESSION) return;
  const ms = navigator.mediaSession;
  if (!current) { ms.metadata = null; ms.playbackState = 'none'; return; }
  const item = current.items[current.order[current.position]];
  const hide = settings.hideTextUntilSpoken && !revealed;
  const title = item.kind === 'drill' && !hide ? prosigns(item.display) : `${fmt.format(current.position + 1)} of ${fmt.format(current.order.length)}`;
  ms.metadata = new MediaMetadata({
    title, artist: current.name, album: 'HW CPY',
    artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
  ms.playbackState = playing ? 'playing' : 'paused';
}
if (MEDIA_SESSION) {
  const handlers = {
    play: () => { debug('media key: play'); if (!playing) start(); },
    // Handing the audio to the voice can make iOS send a pause of its own; ignore that one.
    pause: () => { debug(`media key: pause${speechHoldsAudio ? ' (ignored: speaking)' : ''}`); if (playing && !speechHoldsAudio) pause(); },
    nexttrack: () => { debug('media key: next'); next(); },
    previoustrack: () => { debug('media key: previous'); previous(); },
  };
  for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { } }
}

// MARK: Settings

function openSheet(id) { $(id).showModal(); }
for (const d of document.querySelectorAll('dialog.sheet')) {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}
$('settingsBtn').addEventListener('click', () => { renderSettings(); openSheet('settings'); });
$('speedBtn').addEventListener('click', () => { renderSettings(); openSheet('settings'); });
$('settings').addEventListener('close', () => render());

function changed() {
  saveSettings();
  if (ctx) { cwGain.gain.value = settings.morseVolume; courtesyGain.gain.value = settings.courtesyToneVolume; }
  updateBackground();
  render();
}

const label = (title, note) => el('div', { class: 'label' }, title, note ? el('small', {}, note) : null);

function stepper(title, note, key, { min, max, step = 1, format, disabled = false, get, set }) {
  const read = get ?? (() => settings[key]);
  const write = set ?? ((x) => { settings[key] = x; });
  const value = el('span', { class: 'value' }, format(read()));
  const bump = (d) => {
    const x = Math.round(Math.min(max(), Math.max(min, read() + d * step)) * 100) / 100;
    write(x);
    changed();
    renderSettings();
  };
  return el('div', { class: `field${disabled ? ' disabled' : ''}` }, label(title, note), value,
    el('span', { class: 'stepper' },
      el('button', { 'aria-label': `Decrease ${title}`, disabled: disabled || read() <= min, onclick: () => bump(-1) }, '−'),
      el('button', { 'aria-label': `Increase ${title}`, disabled: disabled || read() >= max(), onclick: () => bump(1) }, '+')));
}

function toggle(title, note, key, onchange) {
  const input = el('input', { type: 'checkbox', checked: !!settings[key], 'aria-label': title });
  input.addEventListener('change', () => { settings[key] = input.checked; changed(); onchange?.(); renderSettings(); });
  return el('label', { class: 'field' }, label(title, note), el('span', { class: 'switch' }, input, el('span')));
}

function picker(title, note, value, options, onchange) {
  const select = el('select', { 'aria-label': title }, options.map(([v2, text]) => el('option', { value: v2 }, text)));
  select.value = value;
  select.addEventListener('change', () => onchange(select.value));
  return el('label', { class: 'field' }, label(title, note), select);
}

function volume(title, key) {
  const out = el('output', {}, String(Math.round(settings[key] * 100)));
  const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(settings[key]), 'aria-label': title });
  input.addEventListener('input', () => { settings[key] = Number(input.value); out.textContent = String(Math.round(settings[key] * 100)); changed(); });
  return el('div', { class: 'field slider' }, label(title), out, input);
}

const seconds = (x) => `${x.toFixed(1)} s`;

function languages() {
  const codes = [...new Set(voices.map((x) => x.lang.replace('_', '-')))];
  const names = new Intl.DisplayNames(['en-GB'], { type: 'language' });
  return codes.map((c) => [c, (() => { try { return names.of(c); } catch { return c; } })()]).sort((a, b) => a[1].localeCompare(b[1]));
}

function renderSettings() {
  const form = $('settingsForm');
  const scroll = form.scrollTop;
  const sec = (title, ...fields) => [el('div', { class: 'section-title' }, title), el('div', { class: 'group' }, fields.filter(Boolean))];
  const langs = languages();
  if (settings.speechLanguage && !langs.some(([c]) => c === settings.speechLanguage)) langs.unshift([settings.speechLanguage, settings.speechLanguage]);
  fill(form, 
    ...sec('Speed',
      stepper('Character speed', null, 'wpm', { min: 5, max: () => 60, format: (x) => `${Math.trunc(x)} WPM` }),
      picker('Spacing', null, settings.spacingMode, [['standard', 'Standard'], ['farnsworth', 'Farnsworth'], ['wordsworth', 'Wordsworth']],
        (x) => { settings.spacingMode = x; changed(); renderSettings(); }),
      settings.spacingMode !== 'standard'
        ? stepper('Overall speed', null, 'overallWPM', { min: 2, max: () => Math.max(2, settings.wpm), get: () => Math.min(settings.overallWPM, settings.wpm), format: (x) => `${Math.trunc(x)} WPM` })
        : null,
      toggle('Interval training', `${intervalSpeeds().join(' / ')} WPM, then the replay at the fastest`, 'intervalTraining')),
    ...sec('Playback',
      stepper('CW plays before speech', null, 'cwPlaysBeforeSpeech', { min: 0, max: () => 5, format: String, disabled: settings.intervalTraining }),
      toggle('Replay CW after speech', null, 'replayCWAfterSpeech'),
      stepper('Pause after the Morse', 'Between repeats, and before the answer', 'pauseAfterMorse', { min: 0, max: () => 10, step: 0.5, format: seconds }),
      stepper('Pause before next', 'After the answer, before the next one starts', 'pauseBetweenItems', { min: 0, max: () => 10, step: 0.5, format: seconds }),
      picker('Session length', 'Playing time, then it stops after the current one', String(sessionMinutes),
        [['0', 'Off'], ...[5, 10, 15, 20, 30, 45, 60].map((m) => [String(m), `${m} minutes`])],
        (x) => { sessionMinutes = Number(x); store.set('sessionMinutes', sessionMinutes); sessionPlayed = 0; sessionEnded = false; if (playing) sessionMark = performance.now(); render(); }),
      toggle('Shuffle playback order', null, 'shuffle', () => { if (current) { const i = current.order[current.position]; current.order = makeOrder(i); current.position = current.order.indexOf(i); } }),
      toggle('Hide text until spoken', null, 'hideTextUntilSpoken'),
      volume('Morse volume', 'morseVolume'),
      volume('Courtesy tone volume', 'courtesyToneVolume')),
    ...sec('CW tone',
      stepper('Tone', null, 'toneHz', { min: 300, max: () => 1200, step: 10, format: (x) => `${x} Hz` }),
      stepper('Rise', null, 'riseMs', { min: 1, max: () => 20, format: (x) => `${x} ms` }),
      stepper('Fall', null, 'fallMs', { min: 1, max: () => 20, format: (x) => `${x} ms` })),
    ...sec('Speech',
      toggle('Play speech', IPHONE ? 'On iPhone the voice can start late or be clipped, and silent mode mutes it' : IOS ? 'Silent mode mutes the voice' : null, 'playSpeech'),
      volume('Speech volume', 'speechVolume'),
      picker('Language', langs.length ? null : 'This browser has no voices', settings.speechLanguage, [['', 'System'], ...langs],
        (x) => { settings.speechLanguage = x; changed(); })),
    ...sec('Replacements',
      toggle('Use abbreviations', 'Speak “TNX” as “thanks” when there’s no separate spoken text', 'useAbbreviations'),
      el('div', { class: 'field' }, el('button', { class: 'link-btn', onclick: () => { renderAbbreviations(); openSheet('abbreviations'); } }, 'Edit abbreviations…')),
      toggle('Add space before punctuation', 'Send “HW ?” rather than “HW?”', 'spaceBeforePunctuation')),
    ...sec('Appearance',
      picker('Appearance', null, appearance, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']],
        (x) => { appearance = x; store.set('appearance', x); applyAppearance(); })),
    ...sec('Advanced',
      toggle('Play silent background tone', 'For Bluetooth devices with latency', 'silentBackgroundTone'),
      toggle('Pad CW audio', 'For devices which clip CW starts and ends', 'padCWAudio')),
    credits(),
  );
  form.scrollTop = scroll;
}

/// About and licences, from the template in index.html, with the sets' source commit from the catalogue.
function credits() {
  const node = $('creditsTemplate').content.firstElementChild.cloneNode(true);
  const [hash, date] = (catalog?.commit ?? '').split(' ');
  if (hash && catalog?.source) {
    node.querySelector('[data-source]').href = `${catalog.source}/tree/${hash}`;
    node.querySelector('[data-commit-id]').textContent = `${hash.slice(0, 7)}${date ? ` (${date})` : ''}`;
  }
  return node;
}

function renderAbbreviations() {
  const list = $('abbrList');
  fill(list, ...settings.abbreviations.map((a, i) => {
    const abbr = el('input', { value: a.abbreviation, 'aria-label': 'Abbreviation', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
    const exp = el('input', { value: a.expansion, 'aria-label': 'Spoken as', autocomplete: 'off' });
    abbr.addEventListener('change', () => { a.abbreviation = abbr.value.trim().toUpperCase(); saveSettings(); });
    exp.addEventListener('change', () => { a.expansion = exp.value.trim(); saveSettings(); });
    return el('div', { class: 'abbr-row' }, abbr, el('span', { class: 'count' }, '→'), exp,
      el('button', { class: 'icon-btn', 'aria-label': `Remove ${a.abbreviation}`, onclick: () => { settings.abbreviations.splice(i, 1); saveSettings(); renderAbbreviations(); } }, '✕'));
  }));
}
$('abbrAdd').addEventListener('click', () => {
  settings.abbreviations = [{ abbreviation: '', expansion: '' }, ...settings.abbreviations];
  saveSettings();
  renderAbbreviations();
  $('abbrList').querySelector('input')?.focus();
});
$('abbrRestore').addEventListener('click', () => {
  if (!confirm('Restore the default abbreviations?')) return;
  settings.abbreviations = DEFAULT_ABBREVIATIONS.map((a) => ({ ...a }));
  saveSettings();
  renderAbbreviations();
});
$('contentsBtn').addEventListener('click', () => {
  if (!current) return;
  $('contentsTitle').textContent = current.name;
  const nowIndex = current.order[current.position];
  fill($('contentsList'), ...current.items.map((item, i) => el('button', {
    class: `row${i === nowIndex ? ' current' : ''}`,
    onclick: () => { $('contents').close(); move(current.order.indexOf(i)); },
  }, el('span', { class: 'n' }, String(i + 1)),
  el('span', { class: `name${item.kind === 'drill' ? '' : ' plain'}` }, item.kind === 'drill' ? prosigns(item.display) : item.kind === 'speech' ? `💬 ${item.spoken}` : '🔔 Courtesy tone'))));
  openSheet('contents');
  $('contentsList').querySelector('.current')?.scrollIntoView({ block: 'center' });
});

// MARK: Start-up

// Leaving Safari or locking the phone pauses, as the owner asked (2026-11-24): practice is for when
// you're looking at the page. Play carries on from the same item.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && (playing || gate)) {
    debug('page hidden: pausing');
    pause();
  }
});
window.addEventListener('pagehide', () => { if (playing || gate) pause(); });

// A phone has no console: show anything that goes wrong.
window.addEventListener('error', (e) => showError(`Something went wrong: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => showError(`Something went wrong: ${e.reason?.message ?? e.reason}`));

showTab(tab);
countVisit();
/// iPhone: Safari's voice can't be timed reliably (tested 2026-11-24: late starts, clipped or
/// lost words, whatever the page does with its own audio). Say so at the top of the library and of the
/// player (where a phone opens straight to, with the library hidden), until OK in either dismisses both.
/// When the two are side by side (wide screens), only the library's shows.
function iosNotice() {
  if (!IPHONE || store.get('iosNoticeDismissed', false)) return;
  const notes = [];
  const note = (extraClass) => {
    const node = el('div', { class: `notice ${extraClass}`, role: 'note' },
      el('p', {}, el('strong', {}, 'On iPhone'), ' the Morse plays exactly, but Safari’s voice can start late, be clipped, or skip a word now and then. It works best on a computer, an iPad or an Android phone.'),
      el('p', {}, 'If you can’t hear the voice at all, turn off silent mode.'),
      el('button', { class: 'link-btn', onclick: () => { store.set('iosNoticeDismissed', true); for (const n of notes) n.remove(); } }, 'OK'));
    notes.push(node);
    return node;
  };
  $('library').querySelector('.content').prepend(note(''));
  $('setName').after(note('player-notice'));
}
iosNotice();

const libraryCredits = () => $('library').querySelector('.content').append(credits());
catalogReady.then(() => { if (tab === 'builtin') renderBuiltIn(); renderLibrary(); libraryCredits(); })
  .catch(() => { fill($('builtinList'), el('div', { class: 'empty' }, 'The built-in sets couldn’t be loaded.')); libraryCredits(); });
engineReady.then((e) => { engine = e; })
  .catch((err) => showError(`HW CPY couldn’t start: ${err.message}`));
render();
// Reopen the set that was open, paused, where it was left.
const lastOpen = store.get('open', null);
if (lastOpen && entry(lastOpen)) openEntry(lastOpen);
