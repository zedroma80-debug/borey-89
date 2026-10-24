import OBR from '@owlbear-rodeo/sdk';
import './style.css';
import { roles, symptoms, limits, makeCharacter, validateCharacter } from './model.js';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
let mode = 'login', gm = false, sheets = [], selected = 0, roomId = '', playerId = 'browser';
let token = '', storageKey = '', sessionKey = '', dirty = false, blocked = false, saving = null, editVersion = 0, saveTimer;
const current = () => sheets.find(s => s.slot === selected);
const status = text => { $('saveStatus').textContent = text; };
const storageRead = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
const storageWrite = (storage, key, value) => { try { value === null ? storage.removeItem(key) : storage.setItem(key, value); return true; } catch { return false; } };
const session = { get: key => { try { return storageRead(sessionStorage, key); } catch { return null; } }, set: (key, val) => { try { return storageWrite(sessionStorage, key, val); } catch { return false; } } };
function setControls(enabled) {
  $('role').disabled = !enabled;
  $('reset').disabled = !enabled;
}
setControls(false);

async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    ...options, cache: 'no-store', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token, 'X-OBR-Room': roomId } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({ error: 'Сервер недоступен или возвращает неверный ответ.' }));
  if (!response.ok) throw new Error(body.error || `Ошибка сервера: ${response.status}`);
  return body;
}
function showSheets() {
  $('sheet').hidden = false;
  $('loginForm').hidden = true;
  $('logout').hidden = false;
  $('role').replaceChildren(...sheets.map(s => new Option(roles[s.slot], String(s.slot))));
  if (!sheets.some(s => s.slot === selected)) selected = sheets[0].slot;
  $('role').value = String(selected);
  $('role').disabled = sheets.length === 1;
  $('reset').disabled = false;
  $('connectionStatus').textContent = mode === 'local'
    ? 'ЛОКАЛЬНАЯ ПРОБА · данные только в этом браузере; синхронизации и защиты между пользователями браузера нет.'
    : `Комната ${roomId} · ${gm ? 'Ведущий: все четыре дела' : 'Игрок: только своё дело'} · синхронизация каждые 2 секунды`;
  render();
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
  // No player-visible output derives from hidden values, including CSS or condition text.
  $('condition').textContent = s.health === 0 ? 'Требуется помощь' : s.stress >= 4 ? 'Высокий стресс' : 'Состояние удовлетворительное';
  $('gmPanel').classList.toggle('hidden', !gm);
  for (const key of ['cold', 'infection', 'hallucinations']) $(key + 'Value').textContent = gm ? entry.hidden[key] + ' / 10' : '';
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
  for (const [id, key] of [['name', 'name'], ['secret', 'secret'], ['notesText', 'notes'], ['tasksText', 'tasks']]) {
    if ($(id).value !== s[key]) $(id).value = s[key];
  }
}
function protectDraft(message) {
  blocked = true;
  status(message + ' Черновик оставлен в окне. Скачайте его перед выходом.');
  $('conflictActions').hidden = false;
  $('reloadRemote').textContent = mode === 'local' ? 'Повторить сохранение в браузере' : 'Загрузить серверную версию';
}
function changed() {
  dirty = true; editVersion++;
  if (blocked) { status('Есть несохранённые правки. Скачайте черновик или загрузите серверную версию.'); return; }
  status(mode === 'local' ? 'Сохранение в браузере…' : 'Есть несохранённые изменения…');
  clearTimeout(saveTimer); saveTimer = setTimeout(() => { void flush(); }, 450);
}
async function flush() {
  clearTimeout(saveTimer);
  if (saving) return saving;
  if (!dirty || blocked) return !blocked;
  if (mode === 'local') {
    let ok = false;
    try { ok = storageWrite(localStorage, storageKey, JSON.stringify(sheets)); } catch { /* storage denied */ }
    if (!ok) { protectDraft('Браузер запретил сохранение.'); return false; }
    dirty = false; status('Сохранено в этом браузере'); return true;
  }
  const entry = current(), snapshot = clone(entry), version = editVersion;
  status('Сохранение на сервере…');
  saving = (async () => {
    try {
      const saved = await api('/sheets/' + selected, { method: 'PATCH', body: JSON.stringify({ revision: snapshot.revision, character: snapshot.character, ...(gm ? { hidden: snapshot.hidden } : {}) }) });
      entry.revision = saved.revision;
      if (version === editVersion) { dirty = false; status('Сохранено в комнате'); }
      return true;
    } catch (error) { protectDraft(error.message); return false; }
    finally { saving = null; if (dirty && !blocked) saveTimer = setTimeout(() => { void flush(); }, 100); }
  })();
  return saving;
}
async function refresh() {
  if (mode !== 'online' || dirty || saving || blocked) return;
  const version = editVersion;
  try {
    const data = await api('/sheets');
    if (dirty || saving || blocked || version !== editVersion || mode !== 'online') return;
    const old = current()?.revision;
    sheets = data.sheets;
    if (old !== current()?.revision) { render(); status('Получены изменения из комнаты'); }
  } catch (error) { if (mode === 'online' && !dirty) status('Синхронизация приостановлена: ' + error.message); }
}
async function loadOnline() {
  const data = await api('/sheets');
  sheets = data.sheets; gm = data.role === 'GM'; mode = 'online'; dirty = false; blocked = false;
  $('conflictActions').hidden = true; showSheets(); status('Данные загружены из комнаты');
}
function startLocal() {
  mode = 'local'; gm = false; token = ''; dirty = false; blocked = false;
  sheets = roles.map((_, slot) => ({ slot, revision: 0, character: makeCharacter(slot) }));
  try {
    const saved = JSON.parse(storageRead(localStorage, storageKey) || 'null');
    if (Array.isArray(saved) && saved.length === 4 && saved.every((s, i) => s.slot === i && validateCharacter(s.character))) sheets = saved.map(s => ({ slot: s.slot, revision: 0, character: s.character }));
  } catch { status('Локальное сохранение повреждено; исходная запись сохранена в браузере.'); }
  showSheets(); status('Локальная проба. Первое изменение проверит доступность сохранения.');
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
    const target = ['health', 'stress'].includes(key) ? current().character : gm ? current().hidden : null;
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
  if (current().character.items.length >= 100) { status('Максимум 100 предметов.'); return; }
  current().character.items.push(value); $('itemInput').value = ''; changed(); render();
});
for (const [id, key, max] of [['name', 'name', 200], ['secret', 'secret', 10000], ['notesText', 'notes', 20000], ['tasksText', 'tasks', 10000]]) {
  $(id).maxLength = max;
  $(id).addEventListener('input', event => { if (current()) { current().character[key] = event.target.value; changed(); } });
}
$('role').addEventListener('change', async event => {
  const next = Number(event.target.value);
  $('role').disabled = true;
  while (dirty && !blocked) await flush();
  if (!blocked) { selected = next; render(); }
  $('role').value = String(selected); $('role').disabled = sheets.length === 1;
});
$('reset').addEventListener('click', () => {
  if (current() && confirm('Сбросить карточку «' + roles[selected] + '»? Скрытые показатели ведущего сохранятся.')) {
    current().character = makeCharacter(selected); changed(); render();
  }
});
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('loginForm').querySelector('button'); submit.disabled = true;
  try {
    if (!OBR.isAvailable) roomId = $('roomId').value.trim();
    if (!OBR.isAvailable) session.set('borey89:last-test-room', roomId);
    const result = await api('/login', { method: 'POST', body: JSON.stringify({ code: $('accessCode').value.trim(), roomId }) });
    token = result.token; session.set(sessionKeyForRoom(), token); $('accessCode').value = '';
    await loadOnline();
  } catch (error) { status(error.message); }
  finally { submit.disabled = false; }
});
$('localMode').addEventListener('click', startLocal);
function sessionKeyForRoom() { return 'borey89:session:v1:' + roomId + ':' + playerId; }
$('logout').addEventListener('click', async () => {
  if ((dirty || blocked) && !confirm('Есть несохранённый черновик. Выйти и потерять его?')) return;
  clearTimeout(saveTimer);
  if (saving) await saving;
  if (mode === 'online') {
    try { await api('/logout', { method: 'POST' }); } catch (error) { status('Не удалось отозвать сессию: ' + error.message); return; }
  }
  session.set(sessionKeyForRoom(), null); token = ''; sheets = []; mode = 'login'; gm = false; dirty = blocked = false;
  for (const id of ['name', 'secret', 'notesText', 'tasksText']) $(id).value = '';
  for (const id of ['coldValue', 'infectionValue', 'hallucinationsValue', 'itemList', 'symptomChecks']) $(id).replaceChildren();
  $('gmPanel').classList.add('hidden');
  $('sheet').hidden = true; $('loginForm').hidden = false; $('logout').hidden = true; $('conflictActions').hidden = true;
  setControls(false); status('Вы вышли.'); $('connectionStatus').textContent = 'Вход в комнату по персональному коду';
});
$('exportDraft').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(current(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'borey89-private-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('reloadRemote').addEventListener('click', async () => {
  if (mode === 'online' && !confirm('Заменить несохранённый черновик серверной версией? Перед этим скачайте нужные правки.')) return;
  try {
    if (mode === 'online') await loadOnline();
    else { blocked = false; $('conflictActions').hidden = true; await flush(); }
  } catch (error) { status(error.message); }
});
$('openWindow').addEventListener('click', async () => {
  if (!OBR.isAvailable) { status('Отдельное окно доступно внутри Owlbear Rodeo.'); return; }
  if (dirty && !await flush()) return;
  if (dirty || blocked) { status('Сначала сохраните изменения.'); return; }
  try { await OBR.modal.open({ id: 'borey89.sheet', url: '/?window=1', width: 1040, height: 800 }); }
  catch (error) { status('Не удалось открыть окно: ' + error.message); }
});
if (new URLSearchParams(location.search).has('window')) $('openWindow').hidden = true;
window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) void flush(); });
async function initialize() {
  if (OBR.isAvailable) { roomId = OBR.room.id; playerId = await OBR.player.getId(); }
  else roomId = session.get('borey89:last-test-room') || '';
  storageKey = 'borey89:local:v1:' + roomId + ':' + playerId;
  sessionKey = sessionKeyForRoom();
  $('roomId').value = roomId; $('roomId').readOnly = OBR.isAvailable;
  $('connectionStatus').textContent = OBR.isAvailable ? 'Owlbear Rodeo · комната ' + roomId : 'Проверка вне Owlbear Rodeo · для сетевой игры укажите ID комнаты';
  $('loginForm').hidden = false;
  token = session.get(sessionKey) || '';
  if (token) { try { await loadOnline(); } catch (error) { token = ''; session.set(sessionKey, null); status(error.message); } }
  setInterval(() => { void refresh(); }, 2000);
}
function initWithError() { initialize().catch(error => { status('Ошибка SDK: ' + error.message); $('loginForm').hidden = false; }); }
if (OBR.isAvailable) OBR.onReady(initWithError); else initWithError();
