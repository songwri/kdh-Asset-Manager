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
  Holdings: ['id', 'account', 'owner', 'name', 'sector', 'qty', 'avg_price', 'price', 'thesis', 'note', 'active', 'symbol', 'price_at'],
  Debts:    ['id', 'name', 'principal', 'rate', 'term', 'start', 'disburse', 'note', 'active'],
  Events:   ['id', 'date', 'name', 'amount', 'category', 'certain', 'note', 'active'],
  Ledger:   ['id', 'date', 'type', 'amount', 'category', 'who', 'pay', 'memo'],
};
const NUM_COLS = ['amount', 'value', 'rate', 'qty', 'avg_price', 'price', 'principal', 'term'];
const MONTH_COLS = ['start', 'end', 'pause_from', 'pause_to'];
const SCHEMA_VERSION = 2;
const QUOTES_TAB = 'Quotes';
const LOG_TAB = 'Log';
const MIN_MANUAL_INTERVAL_MS = 5 * 60 * 1000;
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
    .addSeparator()
    .addItem('④ 시세 자동 갱신 켜기 (1시간마다)', 'enableAutoRefresh')
    .addItem('⑤ 시세 지금 갱신', 'refreshNow')
    .addItem('⑥ 시세 자동 갱신 끄기', 'disableAutoRefresh')
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

// 무차별 대입은 5회 잠금으로 막으므로 반복 횟수는 적게 둔다 (예전 300회 해시는 첫 로그인 때 자동 전환)
const PIN_ITER = 8;
function hash_(pin, salt, iters) {
  let h = salt + ':' + pin;
  for (let i = 0; i < (iters || 300); i++) {
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
  props.setProperty('PIN_HASH', hash_(String(pin), salt, PIN_ITER));
  props.setProperty('PIN_ITER', String(PIN_ITER));
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
  const iters = Number(props.getProperty('PIN_ITER') || 300);
  if (hash_(String(pin || ''), salt, iters) === stored) {
    cache.remove('fails');
    if (iters !== PIN_ITER) setPin_(String(pin)); // 예전 방식 해시를 빠른 방식으로 교체
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
  if (req.action === 'login') { const token = checkPin_(req.pin); ensureSchema_(); return { ok: true, token: token, data: readAllCached_(false), meta: meta_() }; }
  requireToken_(req.token);
  switch (req.action) {
    case 'all':   ensureSchema_(); return { ok: true, data: readAllCached_(!!req.fresh), meta: meta_() };
    case 'refresh': { const r = refreshPrices_({ manual: true }); return { ok: true, result: r, holdings: readTab_('Holdings'), meta: meta_() }; }
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
    // 시트가 '2027-03'을 날짜로 바꿔 저장한 경우: 스크립트 시간대(기본 미국)로 읽으면 하루 밀려 '2027-02'가 되므로 시트 시간대로 읽는다
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
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

/** 시트 8개를 매번 읽지 않도록 5분간 캐시 (저장·삭제·시세 갱신 때 비우고, [동기화]는 항상 새로 읽음) */
function readAllCached_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('all_json');
    if (hit) { try { return JSON.parse(hit); } catch (e) { /* 다시 읽기 */ } }
  }
  const data = readAll_();
  try { const j = JSON.stringify(data); if (j.length < 95000) cache.put('all_json', j, 300); } catch (e) { /* 너무 크면 캐시 안 함 */ }
  return data;
}
function dropCache_() { try { CacheService.getScriptCache().remove('all_json'); } catch (e) { /* ignore */ } }

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
  dropCache_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('다른 작업이 저장 중이라 기다리다 시간이 초과됐습니다. 잠시 후 다시 시도하세요.');
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
  dropCache_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('다른 작업이 저장 중이라 기다리다 시간이 초과됐습니다. 잠시 후 다시 시도하세요.');
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


/* ---------- 스키마 자동 보정 (열 추가) ---------- */

function ensureSchema_() {
  const cache = CacheService.getScriptCache();
  const key = 'schema_v' + SCHEMA_VERSION;
  if (cache.get(key)) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const h = TABS[name];
    const cur = sh.getRange(1, 1, 1, h.length).getValues()[0];
    if (cur.join('|') !== h.join('|')) {
      sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#eef2f7');
      h.forEach(function (c, i) {
        if (!isNumCol_(name, c) && !(name === 'Settings' && c === 'value')) sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
      });
    }
  });
  cache.put(key, '1', 21600);
}

/* ---------- 시세 자동 갱신 (GOOGLEFINANCE) ---------- */
// 시트의 GOOGLEFINANCE 함수로 현재가를 읽어 Holdings.price 에 저장한다.
// 안정성: 동시 실행 잠금 / 재시도 / 이상값(±35% 초과) 거부 후 이전 값 유지 / 실행 로그 / 3회 연속 실패 시 오류 발생(구글 실패 알림)

function quotesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let q = ss.getSheetByName(QUOTES_TAB);
  if (!q) {
    q = ss.insertSheet(QUOTES_TAB);
    q.getRange(1, 1, 1, 2).setValues([['symbol', 'price (GOOGLEFINANCE)']]).setFontWeight('bold');
  }
  return q;
}

function stamp_(d) {
  return Utilities.formatDate(d, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function log_(kind, ok, updated, msg) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(LOG_TAB);
    if (!sh) {
      sh = ss.insertSheet(LOG_TAB);
      sh.getRange(1, 1, 1, 5).setValues([['time', 'kind', 'result', 'updated', 'message']]).setFontWeight('bold');
    }
    sh.appendRow([stamp_(new Date()), kind, ok ? 'OK' : 'FAIL', updated, String(msg || '')]);
    if (sh.getLastRow() > 400) sh.deleteRows(2, 100);
  } catch (e) { /* 로그 실패는 무시 */ }
}

function refreshPrices_(opts) {
  opts = opts || {};
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  const now = new Date();
  const lastRun = Number(props.getProperty('REFRESH_LAST_RUN') || 0);
  if (opts.manual && now.getTime() - lastRun < MIN_MANUAL_INTERVAL_MS) {
    return { skipped: true, updated: 0, warnings: [], failed: [], message: '방금 갱신했습니다. 5분 뒤에 다시 시도하세요.' };
  }
  // 시세를 기다리는 동안(최대 20초)에는 저장 잠금을 잡지 않는다 → 그 사이 가계부 저장이 막히지 않음
  if (cache.get('refreshing')) return { skipped: true, updated: 0, warnings: [], failed: [], message: '시세를 갱신하는 중입니다. 잠시 후 다시 확인하세요.' };
  cache.put('refreshing', '1', 90);
  const result = { skipped: false, updated: 0, warnings: [], failed: [], message: '' };
  try {
    ensureSchema_();
    const sh = sheet_('Holdings');
    const H = TABS.Holdings;
    const col = function (k) { return H.indexOf(k); };
    const readTargets = function () {
      const last = sh.getLastRow(), list = [];
      if (last < 2) return list;
      sh.getRange(2, 1, last - 1, H.length).getValues().forEach(function (r, i) {
        const sym = String(r[col('symbol')] || '').trim();
        const act = !/^(n|no|false|0)$/i.test(String(r[col('active')] || '').trim());
        if (r[0] && sym && act) list.push({ id: String(r[0]), row: i + 2, symbol: sym, prev: Number(r[col('price')]) || 0, name: r[col('name')] });
      });
      return list;
    };
    const targets = readTargets();
    if (!targets.length) {
      result.message = '시세 코드가 입력된 종목이 없습니다.';
      props.setProperty('REFRESH_LAST_RUN', String(now.getTime()));
      return result;
    }
    const syms = Array.from(new Set(targets.map(function (t) { return t.symbol; })));
    const q = quotesSheet_();
    q.getRange(2, 1, Math.max(q.getMaxRows() - 1, 1), 2).clearContent();
    q.getRange(2, 1, syms.length, 1).setValues(syms.map(function (x) { return [x]; }));
    q.getRange(2, 2, syms.length, 1).setFormulas(syms.map(function (x, i) { return ['=GOOGLEFINANCE(A' + (i + 2) + ',"price")']; }));
    SpreadsheetApp.flush();

    let prices = {};
    for (let attempt = 1; attempt <= 4; attempt++) {
      Utilities.sleep(2000 * attempt);
      const out = q.getRange(2, 2, syms.length, 1).getValues();
      prices = {};
      let pending = 0;
      syms.forEach(function (x, i) {
        const v = out[i][0];
        if (typeof v === 'number' && v > 0) prices[x] = v; else pending++;
      });
      if (!pending) break;
    }

    // 쓰는 순간에만 짧게 잠금. 기다리는 사이 행이 지워지거나 옮겨졌을 수 있으니 id로 다시 찾는다
    const at = stamp_(now);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      readTargets().forEach(function (t) {
        const p = prices[t.symbol];
        if (!(p > 0)) { result.failed.push(t.name + ' (' + t.symbol + ')'); return; }
        if (t.prev > 0 && (p / t.prev < 0.65 || p / t.prev > 1.35)) {
          result.warnings.push(t.name + ': 시세 ' + p + '가 기존 ' + t.prev + '와 35% 넘게 달라 반영하지 않음 (코드/통화 확인)');
          return;
        }
        sh.getRange(t.row, col('price') + 1, 1, 1).setValue(p);
        sh.getRange(t.row, col('price_at') + 1, 1, 1).setValue(at);
        result.updated++;
      });
      dropCache_();
    } finally {
      lock.releaseLock();
    }

    props.setProperty('REFRESH_LAST_RUN', String(now.getTime()));
    const problems = result.failed.map(function (x) { return '조회 실패: ' + x; }).concat(result.warnings);
    if (result.updated > 0) props.setProperty('REFRESH_LAST_OK', at);
    props.setProperty('REFRESH_LAST_ERR', problems.join(' / '));
    result.message = '갱신 ' + result.updated + '건' + (problems.length ? ', 문제 ' + problems.length + '건' : '');
    log_(opts.auto ? 'auto' : 'manual', problems.length === 0, result.updated, problems.join(' / '));
    return result;
  } finally {
    cache.remove('refreshing');
  }
}

/** 1시간마다 실행되는 트리거 함수 */
function autoRefresh() {
  const props = PropertiesService.getScriptProperties();
  try {
    const r = refreshPrices_({ auto: true });
    if (r.updated === 0 && r.failed.length > 0) throw new Error(r.message + ' ' + r.failed.join(', '));
    props.setProperty('REFRESH_FAILS', '0');
  } catch (e) {
    const n = Number(props.getProperty('REFRESH_FAILS') || 0) + 1;
    props.setProperty('REFRESH_FAILS', String(n));
    props.setProperty('REFRESH_LAST_ERR', String(e.message || e));
    log_('auto', false, 0, String(e.message || e));
    if (n >= 3) throw e; // 3회 연속 실패 시 실행 실패로 남겨 구글 알림을 받을 수 있게 함
  }
}

function disableAutoRefresh_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoRefresh') ScriptApp.deleteTrigger(t);
  });
}

function enableAutoRefresh() {
  disableAutoRefresh_();
  ScriptApp.newTrigger('autoRefresh').timeBased().everyHours(1).create();
  PropertiesService.getScriptProperties().setProperty('AUTO_ON', '1');
  PropertiesService.getScriptProperties().setProperty('REFRESH_FAILS', '0');
  try { SpreadsheetApp.getUi().alert('시세 자동 갱신을 켰습니다 (1시간마다).\n\n실패 알림: Apps Script 왼쪽 [트리거] > autoRefresh 편집 > 실패 알림 설정에서 "즉시 알림"을 고르면 메일로 받을 수 있습니다.'); } catch (e) { /* ignore */ }
}

function disableAutoRefresh() {
  disableAutoRefresh_();
  PropertiesService.getScriptProperties().setProperty('AUTO_ON', '0');
  try { SpreadsheetApp.getUi().alert('시세 자동 갱신을 껐습니다.'); } catch (e) { /* ignore */ }
}

function refreshNow() {
  const r = refreshPrices_({ manual: false });
  const lines = [r.message || ''].concat(r.failed.map(function (x) { return '조회 실패: ' + x; }), r.warnings);
  try { SpreadsheetApp.getUi().alert(lines.filter(Boolean).join('\n') || '완료'); } catch (e) { /* ignore */ }
}

function meta_() {
  const p = PropertiesService.getScriptProperties();
  let auto = p.getProperty('AUTO_ON');
  if (auto === null) {
    try {
      auto = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'autoRefresh'; }) ? '1' : '0';
      p.setProperty('AUTO_ON', auto);
    } catch (e) { auto = '0'; }
  }
  auto = auto === '1';
  return { pricesAt: p.getProperty('REFRESH_LAST_OK') || '', lastErr: p.getProperty('REFRESH_LAST_ERR') || '', fails: Number(p.getProperty('REFRESH_FAILS') || 0), auto: auto };
}
