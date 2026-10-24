import { test, expect } from '@playwright/test';
import { mountRoom } from './harness.js';
const base = process.env.BASE_PATH || '/borey-89/';
const frame = (page, name) => page.frameLocator('#' + name);

test('GitHub Pages subpath serves manifest, bundled assets and icons', async ({ page, request }) => {
  const manifest = await (await request.get('manifest.json')).json();
  expect(manifest.manifest_version).toBe(1); expect(manifest.action.popover).toBe(base); expect(manifest.icon).toBe(base + 'icon.svg');
  expect((await request.get(manifest.icon)).status()).toBe(200);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await expect(page.locator('#sheet')).toBeVisible(); expect(errors).toEqual([]);
  await expect(page.locator('#connectionStatus')).toContainText('ЛОКАЛЬНАЯ ПРОБА');
  await expect(page.locator('#accessCode, #secret, #gmPanel')).toHaveCount(0);
});

test('existing design at 360px: tabs, counters, symptoms, inventory, name, notes, tasks and four professions', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await page.goto(base);
  await page.locator('[data-change="health:-1"]').click(); await page.locator('[data-change="stress:1"]').click();
  await expect(page.locator('#hpValue')).toHaveText('3 / 4'); await expect(page.locator('#stressValue')).toHaveText('1 / 6');
  await page.getByLabel('Озноб', { exact: true }).check();
  await page.locator('[data-tab="gear"]').click(); await page.locator('#itemInput').fill('<img src=x onerror=alert(1)>'); await page.locator('#addItem button').click();
  await expect(page.locator('#itemList')).toContainText('<img src=x onerror=alert(1)>'); await expect(page.locator('#itemList img')).toHaveCount(0);
  await page.locator('#itemList .item').last().locator('button').click();
  await page.locator('[data-tab="dossier"]').click(); await page.locator('#name').fill('Иванов Иван');
  await page.locator('[data-tab="notes"]').click(); await page.locator('#notesText').fill('Найдена записка'); await page.locator('#tasksText').fill('Открыть шлюз');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено в этом браузере (проба)');
  for (let slot=1;slot<4;slot++) { await page.locator('#role').selectOption(String(slot)); await expect(page.locator('#notesText')).toHaveValue(''); }
  await page.locator('#role').selectOption('0'); await expect(page.locator('#notesText')).toHaveValue('Найдена записка');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(page.locator('#hpValue')).toHaveText('3 / 4');
  await page.locator('[data-tab="dossier"]').click(); await expect(page.locator('#name')).toHaveValue('Иванов Иван');
  await page.locator('[data-tab="notes"]').click(); await expect(page.locator('#tasksText')).toHaveValue('Открыть шлюз');
  page.once('dialog',d=>d.accept()); await page.locator('#reset').click(); await expect(page.locator('#notesText')).toHaveValue('');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено в этом браузере (проба)');
});

test('real SDK protocol: per-player sheets, GM subscription, reload persistence and modal under Pages subpath', async ({ page }) => {
  await mountRoom(page, base);
  const alice=frame(page,'alice'), bob=frame(page,'bob'), gm=frame(page,'gm');
  await expect(alice.locator('#sheet')).toBeVisible(); await expect(gm.locator('#ownerControl')).toBeVisible(); await expect(bob.locator('#ownerControl')).toBeHidden();
  await alice.locator('[data-tab="notes"]').click(); await alice.locator('#notesText').fill('Запись Алисы');
  await expect(alice.locator('#saveStatus')).toHaveText('Сохранено в комнате Owlbear');
  await bob.locator('[data-tab="notes"]').click(); await expect(bob.locator('#notesText')).toHaveValue('');
  await gm.locator('#owner').selectOption('alice'); await gm.locator('[data-tab="notes"]').click(); await expect(gm.locator('#notesText')).toHaveValue('Запись Алисы');
  await gm.locator('[data-tab="status"]').click(); await gm.locator('[data-change="health:-1"]').click(); await expect(gm.locator('#saveStatus')).toHaveText('Сохранено в комнате Owlbear');
  await expect(alice.locator('#hpValue')).toHaveText('3 / 4');
  await alice.locator('#role').selectOption('2'); await alice.locator('#notesText').fill('Электрик'); await expect(alice.locator('#saveStatus')).toHaveText('Сохранено в комнате Owlbear');
  await alice.locator('#role').selectOption('0'); await expect(alice.locator('#notesText')).toHaveValue('Запись Алисы');
  await bob.locator('#notesText').fill('Запись Боба'); await expect(bob.locator('#saveStatus')).toHaveText('Сохранено в комнате Owlbear');
  await page.evaluate(() => { const f=document.querySelector('#alice'); f.src=f.src; });
  await expect(alice.locator('#sheet')).toBeVisible(); await alice.locator('[data-tab="notes"]').click(); await expect(alice.locator('#notesText')).toHaveValue('Запись Алисы');
  await alice.locator('#openWindow').click(); const modal=frame(page,'modal'); await expect(modal.locator('#sheet')).toBeVisible(); await expect(modal.locator('#hpValue')).toHaveText('3 / 4');
  const url=await page.locator('#modal').getAttribute('src'); expect(new URL(url).pathname).toBe(base);
  const data=await page.evaluate(()=>window.metadata); expect(Object.keys(data)).toHaveLength(3);
  for(const value of Object.values(data)) expect(Object.keys(value.character).sort()).toEqual(['health','items','name','notes','stress','symptoms','tasks']);
});

test('SDK write failures preserve drafts, and remote edits during typing trigger conflict recovery', async ({ page }) => {
  await mountRoom(page,base); const alice=frame(page,'alice'); await expect(alice.locator('#sheet')).toBeVisible();
  await page.evaluate(()=>{window.failWrites=true;});
  await alice.locator('[data-tab="notes"]').click(); await alice.locator('#notesText').fill('Черновик без связи');
  await expect(alice.locator('#conflictActions')).toBeVisible(); await expect(alice.locator('#notesText')).toHaveValue('Черновик без связи');
  await page.evaluate(()=>{window.failWrites=false;}); await alice.locator('#retrySave').click(); await expect(alice.locator('#saveStatus')).toHaveText('Сохранено в комнате Owlbear');
  await alice.locator('#notesText').fill('Новый черновик');
  await page.evaluate(()=>{
    const key=Object.keys(metadata).find(k=>metadata[k].ownerId==='alice');
    publish({[key]:{...metadata[key],revision:'competing-edit',character:{...metadata[key].character,notes:'Изменение ведущего'}}});
  });
  await expect(alice.locator('#conflictActions')).toBeVisible(); await expect(alice.locator('#notesText')).toHaveValue('Новый черновик');
  const download=page.waitForEvent('download'); await alice.locator('#exportDraft').click(); expect((await download).suggestedFilename()).toBe('borey89-draft.json');
  page.once('dialog',d=>d.accept()); await alice.locator('#reloadRemote').click(); await expect(alice.locator('#notesText')).toHaveValue('Изменение ведущего');
});
