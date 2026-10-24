import OBR from '@owlbear-rodeo/sdk';
import './style.css';
import { roles, symptoms, limits, makeCharacter, validateCharacter } from './model.js';
import { RoomStore, makeRecord, keyFor } from './room-store.js';

const $ = id => document.getElementById(id);
let mode = 'loading', gm = false, sheets = [], selected = 0, playerId = 'browser', playerName = 'Игрок', ownerId = 'browser';
let store, unsubscribe, dirty = false, blocked = false, saving = null, editVersion = 0, saveTimer, pendingRevision = null;
const localKey = 'borey89:static-demo:v2';
const current = () => sheets.find(s => s.slot === selected);
const status = text => { $('saveStatus').textContent = text; };
function controls(disabled) { $('role').disabled = $('owner').disabled = $('reset').disabled = disabled; }
controls(true);
function ownerOptions() {
  const owners = store?.owners() ?? new Map(); owners.set(playerId, playerName);
  $('owner').replaceChildren(...[...owners].map(([id, name]) => new Option((name || id) + (id === playerId ? ' (вы)' : ''), id)));
  $('owner').value = ownerId;
}
function showSheets() {
  $('sheet').hidden = false; controls(false);
  $('role').replaceChildren(...roles.map((name, slot) => new Option(name, String(slot))));
  $('role').value = String(selected);
  $('ownerControl').hidden = !gm;
  ownerOptions(); render();
}
function protectDraft(message) {
  blocked = true; status(message + ' Черновик оставлен в этом окне.'); $('conflictActions').hidden = false;
}
function changed() {
  dirty = true; editVersion++;
  if (blocked) { status('Есть несохранённый черновик. Скачайте его или повторите сохранение после исправления ошибки.'); return; }
  status('Есть несохранённые изменения…');
  clearTimeout(saveTimer); saveTimer = setTimeout(() => { void flush(); }, 350);
}
async function flush() {
  clearTimeout(saveTimer);
  if (saving) return saving;
  if (!dirty || blocked) return !blocked;
  const entry = current(), version = editVersion;
  if (mode === 'local') {
    try {
      if (!sheets.every(s => validateCharacter(s.character))) throw new Error('Недопустимые данные листа.');
      localStorage.setItem(localKey, JSON.stringify(sheets)); dirty = false; status('Сохранено в этом браузере (проба)'); return true;
    } catch (error) { protectDraft('Не удалось сохранить в браузере: ' + error.message); return false; }
  }
  let record;
  try { record = makeRecord(ownerId, ownerId === playerId ? playerName : store.owners().get(ownerId) || ownerId, selected, entry.character); }
  catch (error) { protectDraft(error.message); return false; }
  pendingRevision = record.revision;
  status('Сохранение в комнате Owlbear…');
  saving = (async () => {
    try {
      const saved = await store.save(record, entry.revision);
      entry.revision = saved.revision;
      if (version === editVersion && !blocked) { dirty = false; status('Сохранено в комнате Owlbear'); }
      return !blocked;
    } catch (error) { protectDraft(error.message); return false; }
    finally { saving = null; pendingRevision = null; if (dirty && !blocked) saveTimer = setTimeout(() => { void flush(); }, 100); }
  })();
  return saving;
}
function receiveRoomUpdate() {
  try {
    ownerOptions();
    const incoming = store.sheets(ownerId);
    const remote = incoming[selected];
    if (remote.revision === pendingRevision && pendingRevision !== null) return;
    if (dirty || saving || blocked) {
      if (remote.revision !== current().revision) protectDraft('Этот лист изменён в другом окне. Скачайте черновик перед загрузкой общей версии.');
      return;
    }
    if (remote.revision !== current().revision) { sheets = incoming; render(); status('Получены изменения комнаты'); }
    else sheets = incoming;
  } catch (error) { protectDraft(error.message); }
}
function render() {
  const entry = current();
  if (!entry) return;
  const s = entry.character;
  $('roleLabel').textContent = $('dossierRole').textContent = roles[selected];
  $('employeeNumber').textContent = 'Б-89-' + String(selected + 1).padStart(3, '0');
  for (const [id, key, max] of [['hp', 'health', 4], ['stress', 'stress', 6]]) {
    $(id + 'Value').textContent = s[key] + ' / ' + max;
    $(id + 'Bar').style.width = s[key] / max * 100 + '%';
  }
  $('condition').textContent = s.health === 0 ? 'Требуется помощь' : s.stress >= 4 ? 'Высокий стресс' : 'Состояние удовлетворительное';
  $('symptomChecks').replaceChildren(...symptoms.map((label, index) => {
    const row = document.createElement('label'); row.className = 'check';
    const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.symptom = index; check.checked = s.symptoms.includes(label);
    row.append(check, document.createTextNode(label)); return row;
  }));
  if (!s.items.length) $('itemList').textContent = 'Предметов пока нет.';
  else $('itemList').replaceChildren(...s.items.map((text, index) => {
    const row = document.createElement('div'); row.className = 'item';
    const label = document.createElement('span'); label.textContent = text;
    const remove = document.createElement('button'); remove.className = 'action'; remove.dataset.remove = index; remove.textContent = 'Убрать ×'; remove.setAttribute('aria-label', 'Убрать предмет ' + text);
    row.append(label, remove); return row;
  }));
  for (const [id, key] of [['name', 'name'], ['notesText', 'notes'], ['tasksText', 'tasks']]) {
    if ($(id).value !== s[key]) $(id).value = s[key];
  }
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-selected', String(b === button)); });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === button.dataset.tab));
}));
document.addEventListener('click', event => {
  if (!current()) return;
  const step = event.target.closest('[data-change]');
  if (step) {
    const [key, delta] = step.dataset.change.split(':');
    const target = current().character;
    if (!target || !Object.hasOwn(limits, key)) return;
    target[key] = Math.min(limits[key], Math.max(0, target[key] + Number(delta)));
    changed(); render();
  }
  const remove = event.target.closest('[data-remove]');
  if (remove) { current().character.items.splice(Number(remove.dataset.remove), 1); changed(); render(); }
});
document.addEventListener('change', event => {
  const checkbox = event.target.closest('[data-symptom]');
  if (checkbox && current()) {
    const value = symptoms[Number(checkbox.dataset.symptom)], s = current().character;
    s.symptoms = checkbox.checked ? [...new Set([...s.symptoms, value])] : s.symptoms.filter(x => x !== value); changed();
  }
});
$('addItem').addEventListener('submit', event => {
  event.preventDefault(); const value = $('itemInput').value.trim();
  if (!value || !current()) return;
  if (current().character.items.length >= 40) { status('Максимум 40 предметов.'); return; }
  current().character.items.push(value); $('itemInput').value = ''; changed(); render();
});
for (const [id, key, max] of [['name', 'name', 200], ['notesText', 'notes', 2000], ['tasksText', 'tasks', 1500]]) {
  $(id).maxLength = max;
  $(id).addEventListener('input', event => { if (current()) { current().character[key] = event.target.value; changed(); } });
}
$('role').addEventListener('change', async event => {
  const next = Number(event.target.value);
  $('role').disabled = true;
  while (dirty && !blocked) await flush();
  if (!blocked) {
    try { if (mode === "room") sheets = store.sheets(ownerId); selected = next; render(); }
    catch (error) { status(error.message); }
  }
  $('role').value = String(selected); $('role').disabled = sheets.length === 1;
});
$('reset').addEventListener('click', () => {
  if (current() && confirm('Сбросить карточку «' + roles[selected] + '»? ')) {
    current().character = makeCharacter(selected); changed(); render();
  }
});
$('owner').addEventListener('change', async event => {
  const next = event.target.value; controls(true);
  while (dirty && !blocked) await flush();
  if (!blocked) {
    try { const incoming = store.sheets(next); ownerId = next; sheets = incoming; render(); }
    catch (error) { status(error.message); }
  }
  $('owner').value = ownerId; controls(false);
});
$('exportDraft').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ slot: selected, character: current().character }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'borey89-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('retrySave').addEventListener('click', async () => {
  blocked = false; $('conflictActions').hidden = true; await flush();
});
$('reloadRemote').addEventListener('click', async () => {
  if (!confirm('Заменить несохранённый черновик сохранённой версией? Перед этим скачайте нужные правки.')) return;
  try {
    if (saving) await saving;
    if (mode === 'room') { await store.load(); sheets = store.sheets(ownerId); }
    else sheets = readLocal();
    dirty = blocked = false; $('conflictActions').hidden = true; render(); status('Сохранённая версия загружена');
  } catch (error) { status(error.message); }
});
$('openWindow').addEventListener('click', async () => {
  if (!OBR.isAvailable) { status('Отдельное окно доступно внутри Owlbear Rodeo.'); return; }
  while (dirty && !blocked) await flush();
  if (dirty || blocked) return;
  try {
    const url = new URL(import.meta.env.BASE_URL, location.origin);
    url.searchParams.set('window', '1'); url.searchParams.set('slot', selected); url.searchParams.set('owner', ownerId);
    await OBR.modal.open({ id: 'borey89.sheet', url: url.href, width: 1040, height: 800 });
  } catch (error) { status('Не удалось открыть окно: ' + error.message); }
});
if (new URLSearchParams(location.search).has('window')) $('openWindow').hidden = true;
window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) void flush(); });
function readLocal() {
  const initial = () => roles.map((_, slot) => ({ slot, revision: null, character: makeCharacter(slot) }));
  const raw = localStorage.getItem(localKey);
  if (!raw) return initial();
  const saved = JSON.parse(raw);
  if (!Array.isArray(saved) || saved.length !== 4 || !saved.every((s, slot) => s.slot === slot && validateCharacter(s.character))) throw new Error('Локальное сохранение имеет неизвестный формат. Оно не перезаписано.');
  return saved.map(s => ({ slot: s.slot, revision: null, character: s.character }));
}
async function initialize() {
  $('retryConnection').hidden = true;
  if (OBR.isAvailable) {
    [playerId, playerName, gm] = await Promise.all([OBR.player.getId(), OBR.player.getName(), OBR.player.getRole().then(role => role === 'GM')]);
    ownerId = playerId; mode = 'room';
    store = new RoomStore(OBR.room); await store.load();
    const requestedOwner = new URLSearchParams(location.search).get('owner');
    if (gm && store.owners().has(requestedOwner)) ownerId = requestedOwner;
    sheets = store.sheets(ownerId);
    unsubscribe?.(); unsubscribe = store.subscribe(receiveRoomUpdate);
    $('connectionStatus').textContent = `Owlbear Rodeo · ${gm ? 'Ведущий: выберите игрока' : 'Ваши листы'} · данные общие для комнаты`;
  } else {
    mode = 'local'; gm = false;
    try { sheets = readLocal(); }
    catch (error) {
      sheets = roles.map((_, slot) => ({ slot, revision: null, character: makeCharacter(slot) }));
      protectDraft(error.message);
    }
    $('connectionStatus').textContent = 'ЛОКАЛЬНАЯ ПРОБА · только этот браузер. В Owlbear сохранение и синхронизация работают через SDK комнаты.';
  }
  const slot = Number(new URLSearchParams(location.search).get('slot'));
  selected = Number.isInteger(slot) && slot >= 0 && slot < 4 ? slot : 0;
  showSheets(); if (!blocked) status('Лист загружен. Выберите профессию.');
}
function initWithError() {
  initialize().catch(error => { status('Не удалось загрузить лист: ' + error.message); $('retryConnection').hidden = false; });
}
$('retryConnection').addEventListener('click', initWithError);
if (OBR.isAvailable) OBR.onReady(initWithError); else initWithError();
