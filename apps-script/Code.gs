/**
 * 자산관리 백엔드 (Google Apps Script) — 'assetmanager' 구글시트에 바인딩해서 사용
 *
 * 설치:
 *  1) 시트 > 확장 프로그램 > Apps Script 에 이 파일 전체를 붙여넣고 저장
 *  2) 시트를 새로고침하면 상단에 [자산관리] 메뉴가 생김
 *     - 시트 초기화(탭 생성)  → 보안코드 설정  → (선택) 초기 데이터 입력
 *  3) 배포 > 새 배포 > 유형: 웹 앱
 *       실행 사용자: 나 / 액세스 권한: 모든 사용자
 *     나온 웹 앱 URL을 사이트 로그인 화면에 입력
 *
 * 보안: 모든 데이터 API는 보안코드로 받은 토큰이 있어야만 응답한다.
 *       보안코드는 해시로만 저장되고, 5회 실패하면 15분간 잠긴다.
 */

const TABS = {
  Settings: ['id', 'value', 'note'],
  Income:   ['id', 'name', 'owner', 'amount', 'kind', 'months', 'start', 'end', 'grow', 'retire_stop', 'pause_from', 'pause_to', 'note', 'active'],
  Expenses: ['id', 'name', 'category', 'amount', 'kind', 'months', 'start', 'end', 'inflate', 'variable', 'note', 'active'],
  Assets:   ['id', 'name', 'category', 'owner', 'value', 'rate', 'liquid', 'note', 'active'],
  Holdings: ['id', 'account', 'owner', 'name', 'sector', 'qty', 'avg_price', 'price', 'thesis', 'note', 'active'],
  Debts:    ['id', 'name', 'principal', 'rate', 'term', 'start', 'disburse', 'note', 'active'],
  Events:   ['id', 'date', 'name', 'amount', 'category', 'certain', 'note', 'active'],
  Ledger:   ['id', 'date', 'type', 'amount', 'category', 'who', 'pay', 'memo'],
};
const NUM_COLS = ['amount', 'value', 'rate', 'qty', 'avg_price', 'price', 'principal', 'term'];
const MONTH_COLS = ['start', 'end', 'pause_from', 'pause_to'];
const FAIL_LIMIT = 5;
const LOCK_SECONDS = 900;
const TOKEN_SECONDS = 6 * 3600;

function isNumCol_(tab, col) {
  if (tab === 'Settings') return false;
  return NUM_COLS.indexOf(col) >= 0;
}

/* ---------- 메뉴 / 초기화 ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('자산관리')
    .addItem('① 시트 초기화(탭 생성)', 'initSheets')
    .addItem('② 보안코드 설정', 'promptPin')
    .addItem('③ 초기 데이터 입력 (Seed.gs 필요)', 'runSeed')
    .addToUi();
}

function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    const headers = TABS[name];
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#eef2f7');
    sh.setFrozenRows(1);
    headers.forEach(function (h, i) {
      if (!isNumCol_(name, h) && !(name === 'Settings' && h === 'value')) {
        sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
      }
    });
  });
  SpreadsheetApp.getUi().alert('탭 생성 완료. 다음: [자산관리 > 보안코드 설정]');
}

function runSeed() {
  if (typeof seed !== 'function') {
    SpreadsheetApp.getUi().alert('Seed.gs 가 없습니다. 초기 데이터 없이 사이트에서 직접 입력해도 됩니다.');
    return;
  }
  seed();
}

/* ---------- 보안코드 ---------- */

function hash_(pin, salt) {
  let h = salt + ':' + pin;
  for (let i = 0; i < 300; i++) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8);
    h = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }
  return h;
}

function setPin_(pin) {
  if (!pin || String(pin).length < 8) throw new Error('보안코드는 8자 이상이어야 합니다.');
  const salt = Utilities.getUuid();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('PIN_SALT', salt);
  props.setProperty('PIN_HASH', hash_(String(pin), salt));
}

function promptPin() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('보안코드 설정', '새 보안코드를 입력하세요 (8자 이상, 영문+숫자 권장).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try {
    setPin_(r.getResponseText().trim());
    ui.alert('보안코드가 설정되었습니다.');
  } catch (e) {
    ui.alert(String(e.message));
  }
}

function checkPin_(pin) {
  const cache = CacheService.getScriptCache();
  if (cache.get('locked')) throw new Error('시도 횟수 초과. 15분 후 다시 시도하세요.');
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('PIN_SALT');
  const stored = props.getProperty('PIN_HASH');
  if (!salt || !stored) throw new Error('보안코드가 아직 설정되지 않았습니다. 시트 메뉴에서 설정하세요.');
  if (hash_(String(pin || ''), salt) === stored) {
    cache.remove('fails');
    const token = Utilities.getUuid() + Utilities.getUuid();
    cache.put('tok_' + token, '1', TOKEN_SECONDS);
    return token;
  }
  const fails = Number(cache.get('fails') || 0) + 1;
  cache.put('fails', String(fails), LOCK_SECONDS);
  if (fails >= FAIL_LIMIT) cache.put('locked', '1', LOCK_SECONDS);
  throw new Error('보안코드가 올바르지 않습니다. (' + fails + '/' + FAIL_LIMIT + ')');
}

function requireToken_(token) {
  if (!token || !CacheService.getScriptCache().get('tok_' + token)) throw new Error('AUTH');
}

/* ---------- 웹 앱 엔드포인트 ---------- */

function doGet() {
  return ContentService.createTextOutput('asset-manager api ok');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    out = route_(req);
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  if (req.action === 'login') return { ok: true, token: checkPin_(req.pin) };
  requireToken_(req.token);
  switch (req.action) {
    case 'all':   return { ok: true, data: readAll_() };
    case 'save':  return { ok: true, id: saveRow_(req.tab, req.row) };
    case 'del':   deleteRow_(req.tab, req.id); return { ok: true };
    case 'logout': CacheService.getScriptCache().remove('tok_' + req.token); return { ok: true };
    default: throw new Error('unknown action');
  }
}

/* ---------- 시트 읽기/쓰기 ---------- */

function sheet_(tab) {
  if (!TABS[tab]) throw new Error('unknown tab');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (!sh) throw new Error('탭이 없습니다: ' + tab + ' (시트 초기화를 먼저 실행하세요)');
  return sh;
}

function cellOut_(tab, col, v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(v, tz, col === 'date' ? 'yyyy-MM-dd' : 'yyyy-MM');
  }
  if (isNumCol_(tab, col)) return v === '' ? '' : Number(v);
  return v === null ? '' : v;
}

function readTab_(tab) {
  const sh = sheet_(tab);
  const headers = TABS[tab];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const rows = [];
  vals.forEach(function (r) {
    if (r[0] === '' || r[0] === null) return;
    const o = {};
    headers.forEach(function (h, i) { o[h] = cellOut_(tab, h, r[i]); });
    rows.push(o);
  });
  return rows;
}

function readAll_() {
  const out = {};
  Object.keys(TABS).forEach(function (t) { out[t] = readTab_(t); });
  return out;
}

function rowToArray_(tab, row) {
  return TABS[tab].map(function (h) {
    let v = row[h];
    if (v === undefined || v === null) v = '';
    if (isNumCol_(tab, h)) return v === '' || isNaN(Number(v)) ? '' : Number(v);
    return String(v);
  });
}

function saveRow_(tab, row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_(tab);
    if (!row.id) row.id = Utilities.getUuid().slice(0, 8);
    const arr = rowToArray_(tab, row);
    const last = sh.getLastRow();
    let target = -1;
    if (last >= 2) {
      const ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(row.id)) { target = i + 2; break; }
      }
    }
    if (target < 0) target = Math.max(last, 1) + 1;
    sh.getRange(target, 1, 1, arr.length).setValues([arr]);
    return row.id;
  } finally {
    lock.releaseLock();
  }
}

function deleteRow_(tab, id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_(tab);
    const last = sh.getLastRow();
    if (last < 2) return;
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return; }
    }
  } finally {
    lock.releaseLock();
  }
}

/** Seed.gs 등에서 사용: 여러 행을 한 번에 추가 (이미 같은 id가 있으면 덮어씀) */
function appendRows_(tab, rows) {
  rows.forEach(function (r) { saveRow_(tab, r); });
}
