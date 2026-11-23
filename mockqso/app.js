// Mock QSO on the web: the page, playback (Web Audio) and the over list. QSOs are generated and
// rendered by QSOKit compiled to WebAssembly (worker.js → engine.js → mockqso.wasm), so a seed gives
// the same QSO here as in the Mac and iPhone apps.

const $ = (id) => document.getElementById(id);

// MARK: Settings (the apps' JSON keys), kept in localStorage

const KINDS = [
  ['General', [['ragchew', 'Ragchew'], ['shortQSO', 'Short QSO'], ['dxPileup', 'DX pile-up']]],
  ['Portable', [['pota', 'POTA activation'], ['sota', 'SOTA activation']]],
  ['Contests', [['cqww', 'CQ World Wide'], ['wpx', 'CQ WPX'], ['iaru', 'IARU HF Championship'],
    ['arrlDX', 'ARRL International DX'], ['cwt', 'CWops CWT'], ['sst', 'K1USN Slow Speed Test (SST)'],
    ['mst', 'ICWC Medium Speed Test (MST)'], ['rsgb80', 'RSGB 80m Club Championship']]],
];
const SUMMARIES = {
  ragchew: 'A conversational contact: reports, names, QTH, rig, weather and more. Length varies.',
  shortQSO: 'A brief contact: report, name, QTH, then 73.',
  pota: 'A park activator works several hunters. Exchange: RST, often state or region.',
  sota: 'A summit activator works chasers, sometimes summit-to-summit.',
  dxPileup: 'A rare DX station works a pile-up, often split, with 5NN TU contacts.',
  cqww: 'Exchange: 5NN and CQ zone.', wpx: 'Exchange: 5NN and serial number.',
  iaru: 'Exchange: 5NN and ITU zone, or society for HQ stations.',
  arrlDX: 'W/VE send 5NN and state or province; DX send 5NN and power.',
  cwt: 'Exchange: name and CWops number (or state/country for non-members).',
  sst: 'Friendly and slow (20 WPM and under). Exchange: name and state, province or country.',
  mst: 'Medium speed. Exchange: name and serial number.', rsgb80: 'Exchange: 5NN and serial number.',
};
/// A gentle start: clean computer sending with no band noise. Real fists and band conditions are in Settings.
const DEFAULTS = {
  kind: 'ragchew', myCall: '', myName: '', myQTH: '', includeMe: 'sometimes', wpm: 20, farnsworth: false, effectiveWPM: 12,
  sending: 'computer', tone: 650, noise: 'off', qrn: false, qrm: false, qsb: false, contacts: 5,
  sameTone: false,
};
/// Settings that change the QSO being heard (re-rendered with the same seed); the rest apply to the next.
const RECEIVER = ['wpm', 'farnsworth', 'effectiveWPM', 'tone', 'sameTone', 'noise', 'qrn', 'qrm', 'qsb'];

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: not remembered */ }
  if (addressReady) writeAddress();
}

/// What the current QSO was made with, besides the seed: the settings the generator draws from (receiver
/// settings such as speed and noise don't change the contact) and when it took place (GM/GA/GE, years licensed).
let made = { generator: {}, date: Date.now() };
let shared = false; // the QSO came from a link, so the address keeps it
const GENERATOR_KEYS = ['kind', 'sending', 'contacts', 'myCall', 'myName', 'myQTH', 'includeMe'];
const generatorSettings = () => Object.fromEntries(GENERATOR_KEYS.map((k) => [k, settings[k]]));
let addressReady = false; // set once settings and the text mode are loaded
let settings = { ...DEFAULTS, ...load('mockqso.settings', {}) };
const REVEAL = ['always', 'afterEachOver', 'hidden'];
const REVEAL_TITLES = { always: 'Always', afterEachOver: 'After each over', hidden: 'Off' };
const DEBUG = new URLSearchParams(location.search).has('debug');
let revealMode = load('mockqso.reveal', 'afterEachOver');
if (!REVEAL.includes(revealMode)) revealMode = 'afterEachOver';

// MARK: Settings in the address, so a set-up can be bookmarked or shared

// e.g. ?kind=pota&wpm=25&fw=15&noise=high&qrm=1&text=off. Only settings that differ from the defaults are
// written. Your callsign is left out, so a shared link doesn't put your call in other people's QSOs.
const KIND_VALUES = KINDS.flatMap(([, kinds]) => kinds.map(([value]) => value));
const TEXT_PARAMS = { always: 'always', afterEachOver: 'after', hidden: 'off' };
const NUMBERS = { wpm: ['wpm', 5, 50], tone: ['tone', 300, 1000], contacts: ['n', 1, 20] };
const CHOICES = { sending: ['ops', ['mixed', 'computer', 'expert', 'good', 'average', 'beginner']], noise: ['noise', ['off', 'low', 'medium', 'high']] };
const SWITCHES = { qrn: 'qrn', qrm: 'qrm', qsb: 'qsb', sameTone: 'onetone' };
const ADDRESS_KEYS = ['kind', 'wpm', 'fw', 'tone', 'n', 'ops', 'noise', 'qrn', 'qrm', 'qsb', 'onetone', 'text', 'qso'];
let sharedQSO = null; // { seed, date, generator } from a QSO link, loaded once the page is ready

function readAddress() {
  const q = new URLSearchParams(location.search);
  if (!ADDRESS_KEYS.some((k) => q.has(k))) return false;
  // A link is a whole set-up: anything it leaves out is the default. Your callsign stays as it is.
  settings = { ...DEFAULTS, myCall: settings.myCall, myName: settings.myName, myQTH: settings.myQTH, includeMe: settings.includeMe };
  const number = (k, lo, hi) => {
    const v = Number(q.get(k));
    return q.has(k) && q.get(k) !== '' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
  };
  if (q.has('kind')) {
    const k = q.get('kind');
    if (k === 'any') settings.kind = null; else if (KIND_VALUES.includes(k)) settings.kind = k;
  }
  for (const [key, [param, lo, hi]] of Object.entries(NUMBERS)) settings[key] = number(param, lo, hi) ?? settings[key];
  for (const [key, [param, values]] of Object.entries(CHOICES)) if (values.includes(q.get(param))) settings[key] = q.get(param);
  for (const [key, param] of Object.entries(SWITCHES)) if (q.has(param)) settings[key] = q.get(param) !== '0';
  const overall = number('fw', 3, 49);
  if (overall !== undefined) { settings.farnsworth = true; settings.effectiveWPM = Math.min(overall, settings.wpm - 1); }
  const text = Object.keys(TEXT_PARAMS).find((mode) => TEXT_PARAMS[mode] === q.get('text'));
  if (text) revealMode = text;
  sharedQSO = readQSO(q);
  return true;
}

/// An exact QSO: ?qso=<seed>&at=<UTC yyyymmddhh>, plus call= and me= when the sender's callsign could be in it.
function readQSO(q) {
  if (!/^\d{1,20}$/.test(q.get('qso') ?? '')) return null;
  const value = BigInt(q.get('qso'));
  if (value === 0n || value >= 1n << 64n) return null;
  const at = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(q.get('at') ?? '');
  const date = at ? Date.UTC(+at[1], +at[2] - 1, +at[3], +at[4]) : Date.now();
  // The sender's callsign (or none) for this QSO only: it decides some of the draws. Yours is left alone.
  const call = (q.get('call') ?? '').toUpperCase();
  const me = ['never', 'sometimes', 'always'].includes(q.get('me')) ? q.get('me') : 'sometimes';
  const name = (q.get('name') ?? '').toUpperCase(), qth = (q.get('qth') ?? '').toUpperCase().trim();
  const people = /^[A-Z0-9/]{3,12}$/.test(call)
    ? { myCall: call, myName: /^[A-Z]{1,12}$/.test(name) ? name : '', myQTH: /^[A-Z0-9 ]{1,20}$/.test(qth) ? qth : '', includeMe: me }
    : { myCall: '', myName: '', myQTH: '', includeMe: 'never' };
  return { seed: value, date, generator: { kind: settings.kind, sending: settings.sending, contacts: settings.contacts, ...people } };
}

const utcStamp = (ms) => new Date(ms).toISOString().slice(0, 13).replace(/\D/g, '');

/// A link to the QSO being heard: its settings, seed and time, and the callsign it was made with, if any.
function qsoLink() {
  const q = addressParams(made.generator);
  q.delete('text'); // when to show the text is up to whoever opens it
  q.delete('debug');
  q.set('qso', seed.toString());
  q.set('at', utcStamp(made.date));
  if (made.generator.myCall && made.generator.includeMe !== 'never') {
    q.set('call', made.generator.myCall);
    if (made.generator.myName) q.set('name', made.generator.myName);
    if (made.generator.myQTH) q.set('qth', made.generator.myQTH);
    q.set('me', made.generator.includeMe);
  }
  return `${location.origin}${location.pathname}?${q}`;
}

/// Settings as address parameters; `generator` (a QSO's own) takes the place of the current ones if given.
function addressParams(generator = {}) {
  const s = { ...settings, ...generator };
  const q = new URLSearchParams();
  if (s.kind !== DEFAULTS.kind) q.set('kind', s.kind ?? 'any');
  for (const [key, [param]] of Object.entries(NUMBERS)) if (s[key] !== DEFAULTS[key]) q.set(param, s[key]);
  if (s.farnsworth) q.set('fw', s.effectiveWPM);
  for (const [key, [param]] of Object.entries(CHOICES)) if (s[key] !== DEFAULTS[key]) q.set(param, s[key]);
  for (const [key, param] of Object.entries(SWITCHES)) if (s[key] !== DEFAULTS[key]) q.set(param, s[key] ? '1' : '0');
  if (revealMode !== 'afterEachOver') q.set('text', TEXT_PARAMS[revealMode]);
  if (DEBUG) q.set('debug', '1');
  return q;
}

function writeAddress() {
  // While a shared QSO is loaded the address stays its link (with any receiver changes), so reloading keeps it.
  const q = shared ? new URL(qsoLink()).searchParams : addressParams();
  if (shared && revealMode !== 'afterEachOver') q.set('text', TEXT_PARAMS[revealMode]);
  const search = q.toString();
  try { history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`); } catch { }
}

if (readAddress()) { save('mockqso.settings', settings); save('mockqso.reveal', revealMode); }
addressReady = true;
writeAddress();

// MARK: Rendering in the worker

// "?v=…" when published (scripts/publish-web.sh stamps it on app.js): the worker, engine and wasm load with the
// same stamp, so after an update a browser never mixes new files with cached old ones.
const VERSION = new URL(import.meta.url).search;
const worker = new Worker(new URL(`worker.js${VERSION}`, import.meta.url), { type: 'module' });

// Offline: a published copy (stamped with a version) keeps itself in a service worker's cache. Not while
// working on the page locally (unstamped), so edits always show.
if (VERSION && 'serviceWorker' in navigator && !new URLSearchParams(location.search).has('debug')) {
  navigator.serviceWorker.register(new URL('sw.js', import.meta.url), { scope: './' }).catch(() => { });
}
let nextRequest = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const done = pending.get(data.id);
  pending.delete(data.id);
  if (data.error) done.reject(new Error(data.error)); else done.resolve(data);
};
function render(seed) {
  const id = ++nextRequest;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // `kind: null` is "Any"; the date sets the UTC hour (GM/GA/GE) and year.
    // The QSO's own generator settings and time, so re-rendering it (or a shared link) gives the same contact.
    // All stations on the receiver tone (zero-beat) is the engine's spreadPitch off.
    const merged = { ...settings, ...made.generator, spreadPitch: !settings.sameTone };
    worker.postMessage({ id, settings: { ...merged, kind: merged.kind || null }, seed: seed.toString(), date: made.date });
  });
}
function randomSeed() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(words[0]) << 32n | BigInt(words[1])) || 1n;
}

// MARK: Playback (Web Audio)

let audio;            // AudioContext, made on the first tap (iOS Safari needs a user gesture)
let buffer;           // AudioBuffer of the current QSO
let source;           // the playing AudioBufferSourceNode, if any
let startedAt = 0;    // audio.currentTime when playback (re)started
let offset = 0;       // position in the QSO when playback (re)started, or while paused

function ensureAudio() {
  if (!audio) {
    // Play through the ringer switch on iPhone, as a media app does (Safari 16.4+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { }
    audio = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audio.state === 'suspended') audio.resume();
}
const isPlaying = () => !!source;
const duration = () => (buffer ? buffer.duration : 0);
const currentTime = () => (source ? Math.min(duration(), offset + audio.currentTime - startedAt) : offset);
/// How far behind the audio clock the sound reaches the ears: the browser's own buffering plus the output device
/// (tens of ms on built-in speakers, 150-250 ms on Bluetooth headphones). Safari doesn't report the device part.
const latency = () => (audio ? (audio.baseLatency || 0) + (audio.outputLatency || 0) : 0);
/// The point in the QSO being heard now: what the highlight, over list and scrubber follow.
const heardTime = () => (source ? Math.max(offset, currentTime() - latency()) : offset);

function play() {
  if (!buffer) return;
  ensureAudio();
  if (offset >= duration() - 0.05) offset = 0;
  source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  const s = source;
  s.onended = () => {
    if (source !== s) return; // stopped for a seek or pause
    source = null;
    offset = duration();
    update();
  };
  startedAt = audio.currentTime;
  s.start(0, offset);
  update();
}
function pause() {
  if (!source) return;
  offset = heardTime(); // carry on from what was heard
  const s = source;
  source = null;
  s.stop();
  update();
}
function seek(time) {
  const wasPlaying = isPlaying();
  if (wasPlaying) { const s = source; source = null; s.stop(); }
  offset = Math.max(0, Math.min(duration(), time));
  if (wasPlaying) play(); else update();
}

// MARK: QSO

let qso;        // info from the engine: stations, overs, summary…
let seed;
let busy = false;

// MARK: Usage counts (GoatCounter, anonymous, no cookies, nothing stored on the device)

// Sent straight to GoatCounter's counting address rather than through its count.js, which always adds the page's
// ?… part, and that can hold a callsign, name and QTH. Only the fields below are sent. Not counted on localhost or
// with ?debug (which logs instead); visit the page with #nocount once to stop counting your own visits.
const COUNTER = 'https://g3ajm.goatcounter.com/count';
const counting = (() => {
  try {
    if (location.hash === '#nocount') localStorage.setItem('mockqso.nocount', '1');
    if (location.hash === '#count') localStorage.removeItem('mockqso.nocount');
    if (localStorage.getItem('mockqso.nocount') === '1') return false;
  } catch { }
  return !/^(localhost|127\.|\[::1\])/.test(location.hostname) && location.protocol === 'https:';
})();
function count(fields) {
  const q = new URLSearchParams({ ...fields, s: String(screen.width), rnd: Math.random().toString(36).slice(2) });
  if (DEBUG) { (window.mockqsoCounts ??= []).push(Object.fromEntries(q)); console.info('count', Object.fromEntries(q)); return; }
  if (!counting) return;
  try { fetch(`${COUNTER}?${q}`, { mode: 'no-cors', credentials: 'omit', keepalive: true, referrerPolicy: 'no-referrer' }); } catch { }
}
/// A visit: the page's path and title, and where the visitor came from if it was another site.
function countVisit() {
  let from = '';
  try { if (document.referrer && new URL(document.referrer).origin !== location.origin) from = new URL(document.referrer).origin; } catch { }
  count({ p: location.pathname, t: 'Mock QSO', ...(from ? { r: from } : {}) });
}
/// Counts an event, e.g. "qso/pota". Only these fixed labels are sent: never a callsign, name, QTH or seed.
function track(event) {
  count({ p: `mockqso/${event}`, t: event, e: 'true' });
}
const device = () => (matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse');
function trackNewQSO() {
  const band = Math.floor(settings.wpm / 5) * 5;
  track(`qso/${settings.kind ?? 'any'}`);
  track(`speed/${band}-${band + 4} wpm${settings.farnsworth ? ' farnsworth' : ''}`);
  const on = [settings.sending !== 'computer' && 'fists', settings.noise !== 'off' && `noise ${settings.noise}`,
    settings.qrn && 'qrn', settings.qrm && 'qrm', settings.qsb && 'qsb'].filter(Boolean);
  track(`conditions/${on.length ? on.join(' + ') : 'clean'}`);
  track(`text/${revealMode}`);
}
function trackRender(millis) {
  const bucket = millis < 1000 ? 'under 1 s' : millis < 3000 ? '1-3 s' : 'over 3 s';
  track(`render/${device()}/${bucket}`);
}

async function newQSO() {
  ensureAudio(); // inside the tap, so playback can start once the QSO is ready
  pause();
  seed = randomSeed();
  made = { generator: generatorSettings(), date: Date.now() };
  if (shared) { shared = false; writeAddress(); }
  trackNewQSO();
  await load_(seed, 0, true, true);
}

/// Renders `seed` with the current settings and loads it, at `at` seconds (scaled if the length changed).
async function load_(s, at, autoplay, counted = false) {
  busy = true;
  setStatus('');
  update();
  try {
    const { info, samples } = await render(s);
    if (s !== seed) return; // a newer QSO was asked for meanwhile
    const previous = duration();
    qso = info;
    buffer = audio ? audio.createBuffer(1, samples.length, info.sampleRate)
      : new AudioBuffer({ length: samples.length, sampleRate: info.sampleRate, numberOfChannels: 1 });
    buffer.copyToChannel(samples, 0);
    offset = previous > 0 ? Math.min(at * info.duration / previous, info.duration) : 0;
    buildOvers();
    if (DEBUG) setStatus(`Seed ${info.seed} · rendered in ${(info.renderMillis / 1000).toFixed(2)} s · output latency ${Math.round(latency() * 1000)} ms`);
    if (counted) trackRender(info.renderMillis);
    if (autoplay) play();
  } catch (error) {
    setStatus(`Couldn't make a QSO: ${error.message}`);
    track('error/render');
  } finally {
    busy = false;
    update();
  }
}

/// A receiver setting changed: render the same QSO again and carry on from the same place.
async function rerender() {
  if (!qso) return;
  const wasPlaying = isPlaying();
  const at = heardTime();
  pause();
  await load_(seed, at, wasPlaying);
}

function previousOver() {
  const now = heardTime();
  const target = [...qso.overs].reverse().find((o) => o.start < now - 1.5)?.start ?? 0;
  seek(Math.max(0, target - 0.3));
}
function nextOver() {
  const now = heardTime();
  const next = qso.overs.find((o) => o.start > now + 0.1);
  if (next) seek(Math.max(0, next.start - 0.3));
}

// MARK: The over list

const colour = (station) => `var(--s${station % 8})`;
let rows = []; // per over: { el, call, text, pieces, state }

/// The over's text in pieces, each character or prosign numbered in sending order (MorseDisplay.symbolPieces).
function symbolPieces(text) {
  const pieces = [];
  let count = 0;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (/\s/.test(ch)) { pieces.push({ text: ch, symbol: null }); i++; continue; }
    const close = ch === '<' ? text.indexOf('>', i) : -1;
    if (close > i) { pieces.push({ text: text.slice(i + 1, close), symbol: count++, prosign: true }); i = close + 1; }
    else { pieces.push({ text: ch, symbol: count++ }); i++; }
  }
  return pieces;
}

function buildOvers() {
  const list = $('overs');
  list.textContent = '';
  delete list.dataset.welcome;
  // Shown while no over is on the list yet (text hidden until each over ends).
  hintEl = document.createElement('p');
  hintEl.className = 'list-hint';
  hintEl.textContent = 'Overs appear here as they’re sent.';
  list.append(hintEl);
  rows = qso.overs.map((over) => {
    const el = document.createElement('div');
    el.className = 'over';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const call = document.createElement('span');
    call.className = 'call';
    call.style.color = colour(over.station);
    const text = document.createElement('span');
    text.className = 'text';
    el.append(call, text);
    const fromHere = () => seek(Math.max(0, over.start - 0.3));
    el.addEventListener('click', fromHere);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fromHere(); }
    });
    list.append(el);
    return { el, call, text, over, pieces: symbolPieces(over.lines), spans: null, state: '' };
  });
  stationsEl = document.createElement('div');
  stationsEl.className = 'stations';
  stationsEl.innerHTML = '<h2>Stations</h2>';
  for (const s of qso.stations) {
    const row = document.createElement('div');
    const c = document.createElement('span');
    c.className = 'call';
    c.style.color = colour(s.id);
    c.textContent = s.call;
    const d = document.createElement('span');
    const town = s.town.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
    d.textContent = `${s.name}, ${town}, ${s.country}. ${s.skill} operator, ${s.keyType}, ${Math.trunc(s.wpm)} WPM${s.isUser ? ' (you)' : ''}.`;
    row.append(c, d);
    stationsEl.append(row);
  }
  list.append(stationsEl);
  lastCurrent = null;
}
let stationsEl, hintEl;
let lastCurrent = null;

function isVisible(over, t) {
  if (revealMode === 'always') return true;
  if (revealMode === 'hidden') return false;
  return t >= over.end || t >= duration() - 0.01;
}

/// Shows the over's text, highlighting the character being sent when `sending` is its index.
function setText(row, sending) {
  if (!row.spans) {
    row.text.textContent = '';
    row.spans = row.pieces.map((p) => {
      const span = document.createElement('span');
      span.textContent = p.text;
      if (p.prosign) span.className = 'ps';
      row.text.append(span);
      return span;
    });
  }
  row.pieces.forEach((p, i) => {
    const span = row.spans[i];
    const cls = (p.prosign ? 'ps ' : '') + (sending != null && p.symbol != null
      ? (p.symbol === sending ? 'now' : p.symbol > sending ? 'ahead' : '') : '');
    if (span.className !== cls.trim()) span.className = cls.trim();
    span.style.background = sending != null && p.symbol === sending ? `color-mix(in srgb, ${colour(row.over.station)} 45%, transparent)` : '';
  });
}

function updateOvers(t) {
  if (!qso) return;
  const playing = isPlaying();
  const current = playing || t > 0 ? [...qso.overs].reverse().find((o) => o.start <= t && t < o.end + 0.3) : null;
  for (const row of rows) {
    const { over } = row;
    const visible = isVisible(over, t);
    const heard = t >= over.start;
    const isCurrent = current?.id === over.id;
    // Overs not yet sent stay off the list, so it doesn't give away how long the QSO is.
    row.el.hidden = !(visible || heard);
    if (row.el.hidden) continue;
    row.el.classList.toggle('current', isCurrent);
    row.el.style.background = isCurrent ? `color-mix(in srgb, ${colour(over.station)} 12%, transparent)` : '';
    row.el.classList.toggle('unheard', !(heard || visible));
    row.call.textContent = visible ? over.call : '·····';
    if (visible) {
      const following = revealMode === 'always' && playing && isCurrent && t < over.end;
      let sending = null;
      if (following) {
        for (let i = over.symbolTimes.length - 1; i >= 0; i--) if (over.symbolTimes[i] <= t) { sending = i; break; }
      }
      const state = `text:${sending}`;
      if (row.state !== state) { setText(row, sending); row.state = state; }
    } else {
      const state = isCurrent ? 'sending' : 'hidden';
      if (row.state !== state) {
        row.spans = null;
        row.text.innerHTML = isCurrent ? '<span class="sending">Sending…</span>' : '<span class="hint">Text hidden</span>';
        row.state = state;
      }
    }
  }
  hintEl.hidden = rows.some((row) => !row.el.hidden);
  stationsEl.hidden = !(revealMode === 'always' || (revealMode === 'afterEachOver' && t >= duration() - 0.01));
  if (current && current.id !== lastCurrent) {
    lastCurrent = current.id;
    // Scroll the over list only: scrollIntoView would also scroll the page to the player.
    const scroller = $('scroller'), el = rows[current.id].el;
    const top = el.offsetTop - scroller.offsetTop - (scroller.clientHeight - el.offsetHeight) / 2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
}

// MARK: Controls

const PLAY = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 14.5v-9l6 4.5z';
const PAUSE = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9 8h2v8H9zm4 0h2v8h-2z';
const REVEAL_ICONS = {
  always: 'M12 5C7 5 2.7 8.1 1 12.5 2.7 16.9 7 20 12 20s9.3-3.1 11-7.5C21.3 8.1 17 5 12 5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  afterEachOver: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2zm2 5v2h5V9zm7 0v2h5V9zm-7 4v2h9v-2z',
  hidden: 'M2.3 3.7 3.7 2.3l18 18-1.4 1.4-3.4-3.4A11.4 11.4 0 0 1 12 20c-5 0-9.3-3.1-11-7.5a12 12 0 0 1 4.2-5.4zM12 5c5 0 9.3 3.1 11 7.5a12 12 0 0 1-3 4.4l-3.3-3.3A5 5 0 0 0 10.4 7.3L8.3 5.2C9.5 5.1 10.7 5 12 5z',
};

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const setStatus = (text) => { $('status').textContent = text; };
let scrubbing = false;

function speedText() {
  return settings.farnsworth ? `${settings.wpm}/${settings.effectiveWPM} WPM` : `${settings.wpm} WPM`;
}

function update() {
  const t = heardTime();
  const has = !!qso;
  $('playIcon').setAttribute('d', isPlaying() ? PAUSE : PLAY);
  $('play').title = isPlaying() ? 'Pause' : 'Play';
  $('play').setAttribute('aria-label', $('play').title);
  for (const id of ['replay', 'prev', 'next']) $(id).disabled = !has || busy;
  $('new').disabled = busy;
  $('play').disabled = busy;
  $('loading').hidden = !busy;
  $('listen').setAttribute('aria-busy', String(busy));
  $('position').disabled = !has;
  $('position').max = String(Math.max(duration(), 0.1));
  if (!scrubbing) $('position').value = String(t);
  $('position').setAttribute('aria-valuetext', `${fmt(scrubbing ? Number($('position').value) : t)} of ${fmt(duration())}`);
  $('effectiveWPM').disabled = !settings.farnsworth;
  $('myName').disabled = $('myQTH').disabled = !settings.myCall; // only used for your own station
  $('contactsRow').hidden = ['ragchew', 'shortQSO'].includes(settings.kind);
  $('now').textContent = fmt(scrubbing ? Number($('position').value) : t);
  $('total').textContent = fmt(duration());
  $('revealIcon').setAttribute('d', REVEAL_ICONS[revealMode]);
  $('reveal').title = `Show the text: ${REVEAL_TITLES[revealMode]} (click to change)`;
  $('reveal').setAttribute('aria-label', $('reveal').title);
  for (const label of $('revealLabel').children) label.classList.toggle('on', label.dataset.mode === revealMode);
  $('speed').textContent = speedText();
  $('speed').setAttribute('aria-label', `Speed settings: ${speedText()}`);
  if (qso) {
    const low = Math.trunc(Math.min(...qso.speeds)), high = Math.trunc(Math.max(...qso.speeds));
    const chars = low === high ? `${low} WPM` : `${low}–${high} WPM`;
    $('summary').textContent = `${qso.summary} ` + (qso.effectiveWPM
      ? `Characters at ${chars}, Farnsworth spacing for ${Math.trunc(qso.effectiveWPM)} WPM overall.`
      : `Operators send at ${chars}.`);
    updateOvers(t);
  } else {
    $('summary').textContent = `${settings.kind ? SUMMARIES[settings.kind] : 'A different kind of QSO each time.'} Press New QSO to start.`;
    // The welcome says whether QSOs will be clean or realistic, and where to change it.
    const clean = settings.sending === 'computer' && settings.noise === 'off' && !settings.qrn && !settings.qrm && !settings.qsb;
    const welcome = clean ? 'clean' : realism();
    if ($('overs').dataset.welcome !== welcome) {
      $('overs').dataset.welcome = welcome;
      $('overs').innerHTML = '<div class="empty"><img class="bubble" src="icon.png" alt="">'
        + '<p>Choose a kind of QSO and press <strong>New QSO</strong>. Copy what you hear.</p>'
        + (clean
          ? '<p class="gentle">To start with, QSOs are sent cleanly by computer, with no band noise. When you’re ready, '
            + 'try real operators’ fists, static and fading in <button type="button" class="inline-link" data-open-settings>Settings</button>.</p>'
          : `<p class="gentle">${realism()}. Change ${realism().includes(' are on') ? 'them' : 'it'} in `
            + '<button type="button" class="inline-link" data-open-settings>Settings</button>.</p>')
        + '</div>';
      $('overs').querySelector('[data-open-settings]').addEventListener('click', () => showSettings(true));
    }
  }
}

/// What makes the QSOs harder than clean computer sending, e.g. "Real operators' sending, noise and static are on".
function realism() {
  const on = [];
  if (settings.sending !== 'computer') on.push('real operators’ sending');
  if (settings.noise !== 'off') on.push('noise');
  if (settings.qrn) on.push('static');
  if (settings.qrm) on.push('other stations');
  if (settings.qsb) on.push('fading');
  const list = on.length > 1 ? `${on.slice(0, -1).join(', ')} and ${on.at(-1)}` : on[0];
  return `${list[0].toUpperCase()}${list.slice(1)} ${on.length > 1 ? 'are' : 'is'} on`;
}

function tick() {
  if (isPlaying()) update();
  requestAnimationFrame(tick);
}

// Kind menu.
const kind = $('kind');
kind.add(new Option('Any (surprise me)', ''));
for (const [group, kinds] of KINDS) {
  const g = document.createElement('optgroup');
  g.label = group;
  for (const [value, title] of kinds) g.append(new Option(title, value));
  kind.append(g);
}
kind.value = settings.kind ?? '';
kind.addEventListener('change', () => { settings.kind = kind.value || null; save('mockqso.settings', settings); update(); });

// Settings form.
for (const key of Object.keys(DEFAULTS)) {
  const el = $(key);
  if (!el || key === 'kind') continue;
  if (el.type === 'checkbox') el.checked = settings[key]; else el.value = settings[key];
  el.addEventListener('change', () => {
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (el.type === 'number') {
      v = Math.min(Number(el.max), Math.max(Number(el.min), Number.isFinite(v) ? v : DEFAULTS[key]));
      el.value = v;
    }
    if (key === 'myCall') { v = v.trim().toUpperCase(); el.value = v; }
    // Sent as it is on CW: capitals, letters only.
    if (key === 'myName') { v = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12); el.value = v; }
    if (key === 'myQTH') { v = v.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20); el.value = v; }
    settings[key] = v;
    if (key === 'myCall') settings.includeMe = settings.includeMe === 'never' && v ? 'sometimes' : settings.includeMe;
    // Overall speed stays below the character speed, as in the apps.
    if (settings.effectiveWPM >= settings.wpm) { settings.effectiveWPM = Math.max(3, settings.wpm - 1); $('effectiveWPM').value = settings.effectiveWPM; }
    save('mockqso.settings', settings);
    update();
    if (RECEIVER.includes(key)) rerender();
  });
}

// Starting to listen puts Settings away; changing a setting while listening doesn't.
$('new').addEventListener('click', () => { showSettings(false); newQSO(); });
$('play').addEventListener('click', () => {
  if (isPlaying()) { pause(); return; }
  showSettings(false);
  if (!qso) { if (!busy) newQSO(); return; }
  play();
});
$('replay').addEventListener('click', () => seek(0) || (!isPlaying() && play()));
$('prev').addEventListener('click', previousOver);
$('next').addEventListener('click', nextOver);
$('reveal').addEventListener('click', cycleReveal);
function cycleReveal() {
  revealMode = REVEAL[(REVEAL.indexOf(revealMode) + 1) % REVEAL.length];
  save('mockqso.reveal', revealMode);
  for (const row of rows) row.state = '';
  update();
}
function showSettings(open) {
  $('settingsPanel').hidden = !open;
  $('settingsButton').setAttribute('aria-expanded', String(open));
}
$('settingsButton').addEventListener('click', () => showSettings($('settingsPanel').hidden));
$('settingsDone').addEventListener('click', () => { showSettings(false); $('settingsButton').focus(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settingsPanel').hidden) { showSettings(false); $('settingsButton').focus(); }
});
$('speed').addEventListener('click', () => {
  showSettings(true);
  $('wpm').focus();
});
$('position').addEventListener('input', () => { scrubbing = true; update(); });
$('position').addEventListener('change', () => { scrubbing = false; seek(Number($('position').value)); });
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target instanceof Element ? e.target : document.body;
  if (target.closest('input, select, textarea')) return;
  // Space and Enter keep their usual meaning on a focused button, link or Settings.
  if (e.code === 'Space' && !target.closest('button, summary, a, [role=button]')) { e.preventDefault(); $('play').click(); }
  else if (e.key === 'ArrowLeft' && qso && !busy) { e.preventDefault(); previousOver(); }
  else if (e.key === 'ArrowRight' && qso && !busy) { e.preventDefault(); nextOver(); }
  else if (e.key === 't' || e.key === 'T') cycleReveal();
});

// MARK: Share: a link to these settings, or to the exact QSO being heard

const settingsLink = () => {
  const q = addressParams();
  q.delete('debug');
  return `${location.origin}${location.pathname}${q.size ? `?${q}` : ''}`;
};
let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2200);
}
function showShareMenu(open) {
  $('shareMenu').hidden = !open;
  $('shareButton').setAttribute('aria-expanded', String(open));
  if (open) {
    $('shareQSO').hidden = !qso;
    $('shareSettings').focus();
  }
}
/// The share sheet on a phone; otherwise the link goes on the clipboard.
async function shareLink(url, what) {
  showShareMenu(false);
  try {
    if (matchMedia('(pointer: coarse)').matches && navigator.share) {
      await navigator.share({ title: `Mock QSO: ${what}`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast(`Link to ${what} copied`);
  } catch (error) {
    if (error?.name !== 'AbortError') toast('Couldn’t copy the link');
  }
}
$('shareButton').addEventListener('click', () => showShareMenu($('shareMenu').hidden));
$('shareSettings').addEventListener('click', () => { track('share/settings'); shareLink(settingsLink(), 'these settings'); });
$('shareQSO').addEventListener('click', () => { track('share/qso'); shareLink(qsoLink(), 'this QSO'); });
document.addEventListener('click', (e) => {
  if (!$('shareMenu').hidden && !e.target.closest('.share-wrap')) showShareMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('shareMenu').hidden) { showShareMenu(false); $('shareButton').focus(); }
});

update();
requestAnimationFrame(tick);
countVisit();

// Opened from a QSO link: make that exact QSO, ready to play (sound has to wait for a tap).
if (sharedQSO) {
  track('opened/shared qso');
  seed = sharedQSO.seed;
  made = { generator: sharedQSO.generator, date: sharedQSO.date };
  shared = true;
  writeAddress();
  load_(seed, 0, false).then(() => { if (qso && !DEBUG) setStatus('A shared QSO. Press play to hear it.'); });
}
