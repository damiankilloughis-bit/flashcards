/* Flashcards — vanilla JS, no build step. All progress lives in localStorage. */
(() => {
'use strict';

// ---------- storage ----------
const K = {
  settings: 'fc.settings',
  imported: 'fc.imported',          // [{id,title,topic,short,order,count,cards,imported:true}]
  misses:   'fc.misses',            // {"deckId|cardId": {deckId,deckTitle,cardId,term,def,count,first,last}}
  prog: id => 'fc.progress.' + id,  // {status:{cardId:'known'|'unknown'}, round:{...}}
};
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem(k); },
};

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 1800); }

// ---------- state ----------
const S = {
  manifest: [],        // built-in decks (from decks/index.json)
  deck: null,          // current full deck {id,title,cards}
  byId: {},            // cardId -> card for current deck
  prog: null,          // current deck progress
  view: 'home',
  settings: Object.assign({ shuffle: true, defFirst: false }, LS.get(K.settings, {})),
  flipped: false,
  animating: false,
  lastRoute: '#/',
};
window.__fc = S; // handy for debugging / tests

function saveSettings() { LS.set(K.settings, S.settings); syncSettingInputs(); }
function syncSettingInputs() {
  ['#opt-shuffle', '#opt-shuffle-2'].forEach(s => $(s).checked = !!S.settings.shuffle);
  ['#opt-deffirst', '#opt-deffirst-2'].forEach(s => $(s).checked = !!S.settings.defFirst);
}

const importedDecks = () => LS.get(K.imported, []);
const allDeckMetas = () => S.manifest.concat(importedDecks().map(d => ({ ...d, cards: undefined })));

function loadProgress(id) {
  const p = LS.get(K.prog(id), null) || {};
  p.status = p.status || {};
  p.round = p.round || null;
  return p;
}
function saveProgress() { S.prog.updated = Date.now(); LS.set(K.prog(S.deck.id), S.prog); }

// ---------- misses ----------
function getMisses() { return LS.get(K.misses, {}); }
function addMiss(card) {
  const m = getMisses(), key = S.deck.id + '|' + card.id, now = Date.now();
  const e = m[key] || { deckId: S.deck.id, deckTitle: S.deck.title, cardId: card.id, term: card.term, def: card.def, count: 0, first: now };
  e.count++; e.last = now; e.term = card.term; e.def = card.def;
  m[key] = e; LS.set(K.misses, m); updateMissBadge();
}
function removeMiss(card) {
  const m = getMisses(), key = S.deck.id + '|' + card.id, e = m[key];
  if (!e) return;
  if (--e.count <= 0) delete m[key];
  LS.set(K.misses, m); updateMissBadge();
}
function updateMissBadge() { const n = Object.keys(getMisses()).length; $('#miss-badge').textContent = n ? n : ''; }

// ---------- views / routing ----------
function show(view) {
  S.view = view;
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
  $('#study-menu').hidden = true;
  if (view !== 'study') $('#toast').hidden = true;
  window.scrollTo(0, 0);
}
async function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/deck\/(.+)$/);
  if (m) { await openDeck(decodeURIComponent(m[1])); S.lastRoute = h; return; }
  if (h === '#/misses') { renderMisses(); show('misses'); return; }
  if (h === '#/import') { show('import'); $('#imp-status').textContent = ''; return; }
  S.lastRoute = '#/';
  renderHome(); show('home');
}
window.addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const n = e.target.closest('[data-nav]');
  if (n) { e.preventDefault(); location.hash = n.dataset.nav; }
});

// ---------- home ----------
function renderHome() {
  const metas = allDeckMetas();
  const groups = new Map();
  metas.forEach(d => { const t = d.topic || 'Other'; if (!groups.has(t)) groups.set(t, []); groups.get(t).push(d); });
  let html = '';
  if (!metas.length) html = '<div class="empty-note">No decks yet. Run build_decks.py or use Import.</div>';
  for (const [topic, decks] of groups) {
    decks.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title));
    html += `<div class="topic">${esc(topic)}</div>`;
    for (const d of decks) {
      const p = loadProgress(d.id);
      const vals = Object.values(p.status);
      const k = vals.filter(v => v === 'known').length, u = vals.filter(v => v === 'unknown').length;
      let sub = 'Not started';
      if (p.round) {
        const r = p.round;
        if (k === d.count) sub = 'All known ✓';
        else if (r.pos >= r.queue.length) sub = `Round ${r.n} done · ${u} still learning`;
        else sub = `Round ${r.n} · card ${r.pos + 1} of ${r.queue.length}`;
      }
      const pk = d.count ? (k / d.count * 100) : 0, pu = d.count ? (u / d.count * 100) : 0;
      html += `<button class="deck" data-deck="${esc(d.id)}">
        <div class="row"><span class="name">${esc(d.short || d.title)}</span><span class="count"><span class="deck-count">${d.count}</span> cards${d.imported ? ` <span class="deck-del" data-del="${esc(d.id)}" title="Delete imported deck">✕</span>` : ''}</span></div>
        <div class="sub">${esc(sub)} · ${k} known</div>
        <div class="bar"><div class="k" style="width:${pk}%"></div><div class="u" style="width:${pu}%"></div></div>
      </button>`;
    }
  }
  $('#deck-list').innerHTML = html;
  updateMissBadge();
}
$('#deck-list').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    if (confirm('Delete this imported deck and its progress?')) {
      LS.set(K.imported, importedDecks().filter(d => d.id !== del.dataset.del));
      LS.del(K.prog(del.dataset.del)); renderHome();
    }
    return;
  }
  const b = e.target.closest('[data-deck]');
  if (b) location.hash = '#/deck/' + encodeURIComponent(b.dataset.deck);
});

// ---------- deck / rounds ----------
async function fetchDeck(id) {
  const imp = importedDecks().find(d => d.id === id);
  if (imp) return imp;
  const meta = S.manifest.find(d => d.id === id);
  if (!meta) throw new Error('Unknown deck ' + id);
  const r = await fetch('decks/' + meta.file, { cache: 'no-cache' });
  if (!r.ok) throw new Error('Failed to load deck ' + id);
  return r.json();
}
async function openDeck(id) {
  let deck;
  try { deck = (S.deck && S.deck.id === id) ? S.deck : await fetchDeck(id); }
  catch (err) { toast(err.message); location.hash = '#/'; return; }
  S.deck = deck;
  S.byId = Object.fromEntries(deck.cards.map(c => [c.id, c]));
  S.prog = loadProgress(id);
  // Drop stale ids (deck edited since progress was saved)
  if (S.prog.round && S.prog.round.queue.some(cid => !S.byId[cid])) S.prog.round = null;
  if (!S.prog.round) { startRound(deck.cards.map(c => c.id), S.settings.shuffle, 1); }
  $('#study-deck-title').textContent = deck.short || deck.title;
  $('#study-deck-title').title = deck.title;
  $('#sum-deck-title').textContent = deck.short || deck.title;
  if (roundDone()) { renderSummary(); show('summary'); }
  else { renderCard(); show('study'); }
}
function startRound(ids, doShuffle, n) {
  S.prog.round = { n, queue: doShuffle ? shuffle(ids) : ids.slice(), pos: 0, known: [], unknown: [], history: [] };
  saveProgress();
}
const roundDone = () => S.prog.round.pos >= S.prog.round.queue.length;
const curCard = () => S.byId[S.prog.round.queue[S.prog.round.pos]];

function commitSwipe(dir) {
  const r = S.prog.round; if (roundDone()) return;
  const card = curCard();
  r.history.push({ id: card.id, dir, prev: S.prog.status[card.id] ?? null });
  if (dir === 'right') { S.prog.status[card.id] = 'known'; r.known.push(card.id); }
  else { S.prog.status[card.id] = 'unknown'; r.unknown.push(card.id); addMiss(card); }
  r.pos++;
  saveProgress();
  if (roundDone()) { renderSummary(); show('summary'); }
  else renderCard();
}
function undo() {
  if (S.animating) return;
  const r = S.prog && S.prog.round;
  if (!r || !r.history.length) { toast('Nothing to undo'); return; }
  const h = r.history.pop();
  r.pos--;
  const list = h.dir === 'right' ? r.known : r.unknown;
  const i = list.lastIndexOf(h.id); if (i >= 0) list.splice(i, 1);
  if (h.prev == null) delete S.prog.status[h.id]; else S.prog.status[h.id] = h.prev;
  if (h.dir === 'left') removeMiss(S.byId[h.id]);
  saveProgress();
  if (S.view !== 'study') show('study');
  renderCard();
  // animate back in from the side it left
  const shell = $('#card-cur'), sign = h.dir === 'right' ? 1 : -1;
  shell.style.transition = 'none';
  shell.style.transform = `translateX(${sign * window.innerWidth}px) rotate(${sign * 20}deg)`;
  void shell.offsetWidth;
  shell.style.transition = 'transform .3s ease-out';
  shell.style.transform = '';
  toast('Undone');
}

// ---------- card rendering ----------
function setFace(el, text, isTerm) {
  el.textContent = text;
  el.className = 'face-text' + (isTerm ? ' term' : '') + (text.length > 160 ? ' long' : '');
}
function renderCard() {
  const r = S.prog.round, card = curCard();
  const defFirst = !!S.settings.defFirst;
  setFace($('#front-text'), defFirst ? card.def : card.term, !defFirst);
  setFace($('#back-text'), defFirst ? card.term : card.def, defFirst);
  $('#front-label').textContent = defFirst ? 'Definition' : 'Term';
  $('#back-label').textContent = defFirst ? 'Term' : 'Definition';
  const inner = $('#card-inner');
  inner.classList.add('noanim'); inner.classList.remove('flipped'); S.flipped = false;
  void inner.offsetWidth; inner.classList.remove('noanim');
  document.querySelectorAll('.face-inner').forEach(f => f.scrollTop = 0);
  resetShell();
  const next = S.byId[r.queue[r.pos + 1]];
  $('#card-next').classList.toggle('empty', !next);
  if (next) setFace($('#next-text'), defFirst ? next.def : next.term, !defFirst);
  $('#cnt-known').textContent = r.known.length;
  $('#cnt-unknown').textContent = r.unknown.length;
  $('#progress-bar').style.width = (r.pos / r.queue.length * 100) + '%';
  $('#progress-label').textContent = `${r.pos + 1} / ${r.queue.length}`;
  const totalKnown = Object.values(S.prog.status).filter(v => v === 'known').length;
  $('#study-round').textContent = `Round ${r.n}${r.n > 1 ? ' · still-learning cards' : ''} · ${totalKnown}/${S.deck.cards.length} known`;
  $('#btn-undo').disabled = !r.history.length;
}
function flip() {
  if (S.animating) return;
  S.flipped = !S.flipped;
  $('#card-inner').classList.toggle('flipped', S.flipped);
}

// ---------- drag / swipe ----------
const shell = $('#card-cur');
const tint = document.createElement('div'); tint.className = 'tint'; shell.appendChild(tint);
const stampK = shell.querySelector('.stamp.know'), stampD = shell.querySelector('.stamp.dont');
let drag = null;

function paintDrag(dx, dy) {
  const w = shell.offsetWidth || 360;
  const rot = Math.max(-18, Math.min(18, dx / 14));
  shell.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${rot}deg)`;
  const p = Math.min(1, Math.abs(dx) / (w * 0.35));
  stampK.style.opacity = dx > 0 ? p : 0;
  stampD.style.opacity = dx < 0 ? p : 0;
  tint.style.background = dx > 0 ? 'rgba(34,197,94,.45)' : 'rgba(239,68,68,.45)';
  tint.style.opacity = p * 0.8;
  const nx = $('#card-next');
  nx.style.transform = `scale(${0.94 + 0.06 * p}) translateY(${10 - 10 * p}px)`;
  nx.style.opacity = 0.55 + 0.45 * p;
}
function resetShell() {
  shell.style.transition = 'none'; shell.style.transform = ''; shell.style.opacity = '';
  stampK.style.opacity = 0; stampD.style.opacity = 0; tint.style.opacity = 0;
  const nx = $('#card-next'); nx.style.transform = ''; nx.style.opacity = '';
}
function snapBack() {
  shell.style.transition = 'transform .25s cubic-bezier(.3,1.4,.5,1)';
  shell.style.transform = '';
  stampK.style.opacity = 0; stampD.style.opacity = 0; tint.style.opacity = 0;
  const nx = $('#card-next'); nx.style.transform = ''; nx.style.opacity = '';
}
function flyOff(dir) {
  if (S.animating || S.view !== 'study' || roundDone()) return;
  S.animating = true;
  const sign = dir === 'right' ? 1 : -1;
  const cur = shell.style.transform ? null : paintDrag(sign * 60, 0); // give button presses a tilt + overlay
  stampK.style.opacity = dir === 'right' ? 1 : 0;
  stampD.style.opacity = dir === 'left' ? 1 : 0;
  tint.style.background = dir === 'right' ? 'rgba(34,197,94,.45)' : 'rgba(239,68,68,.45)';
  tint.style.opacity = 0.8;
  void shell.offsetWidth;
  shell.style.transition = 'transform .32s cubic-bezier(.4,.1,.8,.6), opacity .32s';
  shell.style.transform = `translate(${sign * (window.innerWidth + 200)}px, 40px) rotate(${sign * 28}deg)`;
  shell.style.opacity = '0.6';
  setTimeout(() => { S.animating = false; commitSwipe(dir); }, 320);
}

shell.addEventListener('pointerdown', e => {
  if (S.animating || (e.pointerType === 'mouse' && e.button !== 0)) return;
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, mode: null, t0: performance.now(), type: e.pointerType };
});
shell.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.dx = e.clientX - drag.x0; drag.dy = e.clientY - drag.y0;
  const ax = Math.abs(drag.dx), ay = Math.abs(drag.dy);
  if (!drag.mode) {
    // require clear horizontal intent; vertical movement = scroll the card text
    if (ax > 12 && ax > ay * 1.4) {
      drag.mode = 'h'; shell.style.transition = 'none';
      try { shell.setPointerCapture(e.pointerId); } catch {}
    } else if (ay > 12) { drag.mode = 'v'; }
  }
  if (drag.mode === 'h') { e.preventDefault(); paintDrag(drag.dx, drag.dy); }
});
function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (d.mode === 'h') {
    const w = shell.offsetWidth || 360, dt = Math.max(1, performance.now() - d.t0);
    const fast = Math.abs(d.dx) / dt > 0.65 && Math.abs(d.dx) > 50;
    if (!cancelled && (Math.abs(d.dx) > w * 0.3 || fast)) flyOff(d.dx > 0 ? 'right' : 'left');
    else snapBack();
  } else if (!d.mode && !cancelled && Math.abs(d.dx) < 12 && Math.abs(d.dy) < 12) {
    flip();
  }
}
shell.addEventListener('pointerup', e => endDrag(e, false));
shell.addEventListener('pointercancel', e => endDrag(e, true));
shell.addEventListener('dragstart', e => e.preventDefault());

$('#btn-know').addEventListener('click', () => flyOff('right'));
$('#btn-dont').addEventListener('click', () => flyOff('left'));
$('#btn-undo').addEventListener('click', undo);
$('#btn-undo-sum').addEventListener('click', undo);

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  if (S.view === 'study') {
    if (e.key === 'ArrowRight') { e.preventDefault(); flyOff('right'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); flyOff('left'); }
    else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); flip(); }
    else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
  } else if (S.view === 'summary') {
    if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
    else if (e.key === 'Enter' && !$('#btn-keep').hidden) { e.preventDefault(); keepGoing(); }
  }
});

// ---------- summary ----------
function renderSummary() {
  const r = S.prog.round;
  const totalKnown = Object.values(S.prog.status).filter(v => v === 'known').length;
  const allKnown = totalKnown === S.deck.cards.length;
  $('#sum-known').textContent = r.known.length;
  $('#sum-unknown').textContent = r.unknown.length;
  $('#sum-heading').textContent = allKnown ? 'All cards known! 🎉' : `Round ${r.n} complete`;
  $('#sum-overall').textContent = `Deck: ${totalKnown} of ${S.deck.cards.length} known`;
  $('#sum-missed-list').innerHTML = r.unknown.map(id => `<div>${esc(S.byId[id].term)}</div>`).join('');
  $('#btn-keep').hidden = r.unknown.length === 0;
  $('#btn-keep').textContent = `Keep going (${r.unknown.length} still learning)`;
  $('#btn-undo-sum').hidden = !r.history.length;
  $('#btn-restart').classList.toggle('green', allKnown);
}
function keepGoing() {
  const r = S.prog.round;
  if (!r.unknown.length) return;
  startRound(r.unknown, true, r.n + 1); // replay only still-learning cards, always reshuffled
  renderCard(); show('study');
}
function restartDeck() {
  if (!S.deck) return;
  S.prog.status = {};
  startRound(S.deck.cards.map(c => c.id), S.settings.shuffle, 1);
  renderCard(); show('study');
  toast('Deck restarted');
}
$('#btn-keep').addEventListener('click', keepGoing);
$('#btn-restart').addEventListener('click', restartDeck);
$('#btn-restart-menu').addEventListener('click', () => { if (confirm('Restart this deck? Known/unknown marks reset (misses list is kept).')) restartDeck(); });
$('#btn-menu').addEventListener('click', e => { e.stopPropagation(); $('#study-menu').hidden = !$('#study-menu').hidden; });
document.addEventListener('click', e => { if (!e.target.closest('#study-menu, #btn-menu')) $('#study-menu').hidden = true; });

// ---------- misses view ----------
function renderMisses() {
  const m = Object.values(getMisses());
  const sel = $('#miss-filter'), cur = sel.value || 'all';
  const decks = [...new Map(m.map(e => [e.deckId, e.deckTitle])).entries()];
  sel.innerHTML = `<option value="all">All decks (${m.length})</option>` +
    decks.map(([id, t]) => `<option value="${esc(id)}">${esc(t)} (${m.filter(e => e.deckId === id).length})</option>`).join('');
  sel.value = decks.some(([id]) => id === cur) ? cur : 'all';
  const list = m.filter(e => sel.value === 'all' || e.deckId === sel.value).sort((a, b) => b.last - a.last);
  $('#miss-list').innerHTML = list.length ? list.map(e => `<div class="miss">
      <span class="cnt">missed ×${e.count}</span><div class="t">${esc(e.term)}</div>
      <div class="d">${esc(e.def)}</div>
      <div class="m">${esc(e.deckTitle)} · last ${new Date(e.last).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
    </div>`).join('') : '<div class="empty-note">No misses. Cards you swipe left show up here.</div>';
  $('#btn-clear-misses').disabled = !list.length;
}
$('#miss-filter').addEventListener('change', renderMisses);
$('#btn-clear-misses').addEventListener('click', () => {
  const f = $('#miss-filter').value;
  if (!confirm(f === 'all' ? 'Clear the whole misses list?' : 'Clear misses for this deck?')) return;
  const m = getMisses();
  for (const k of Object.keys(m)) if (f === 'all' || m[k].deckId === f) delete m[k];
  LS.set(K.misses, m); updateMissBadge(); renderMisses();
});
$('#btn-misses-back').addEventListener('click', () => { location.hash = S.lastRoute || '#/'; });

// ---------- import ----------
function parseTSV(text) {
  const cards = [], bad = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const t = line.indexOf('\t');
    if (t < 0) { bad.push(i + 1); return; }
    const term = line.slice(0, t).trim(), def = line.slice(t + 1).trim();
    if (!term || !def) { bad.push(i + 1); return; }
    cards.push({ id: 'c' + cards.length, term, def });
  });
  return { cards, bad };
}
$('#btn-import').addEventListener('click', () => {
  const title = $('#imp-title').value.trim() || 'Imported deck';
  const topic = $('#imp-topic').value.trim() || 'Imported';
  const { cards, bad } = parseTSV($('#imp-text').value);
  if (!cards.length) { $('#imp-status').textContent = 'No cards found. Each line needs a TAB between term and definition.'; return; }
  const deck = { id: 'imp-' + Date.now().toString(36), title, topic, short: title, order: 999, count: cards.length, cards, imported: true };
  const list = importedDecks(); list.push(deck);
  try { LS.set(K.imported, list); } catch { $('#imp-status').textContent = 'Could not save (storage full?)'; return; }
  $('#imp-text').value = ''; $('#imp-title').value = '';
  toast(`Imported ${cards.length} cards` + (bad.length ? ` · skipped ${bad.length} line(s)` : ''));
  location.hash = '#/deck/' + encodeURIComponent(deck.id);
});

// ---------- settings ----------
function onShuffle(e) { S.settings.shuffle = e.target.checked; saveSettings(); }
function onDefFirst(e) { S.settings.defFirst = e.target.checked; saveSettings(); if (S.view === 'study' && S.prog && !roundDone()) renderCard(); }
['#opt-shuffle', '#opt-shuffle-2'].forEach(s => $(s).addEventListener('change', onShuffle));
['#opt-deffirst', '#opt-deffirst-2'].forEach(s => $(s).addEventListener('change', onDefFirst));

// ---------- boot ----------
async function boot() {
  syncSettingInputs();
  try {
    const r = await fetch('decks/index.json', { cache: 'no-cache' });
    S.manifest = (await r.json()).decks || [];
  } catch (err) { S.manifest = []; toast('Could not load decks/index.json'); }
  await route();
  document.documentElement.dataset.ready = '1';
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
})();
