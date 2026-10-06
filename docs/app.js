/* 화면 / 데이터 입출력. 금액 단위는 만원(가계부만 원). */
(function () {
  'use strict';
  const E = window.Engine, A = window.Advisor;
  const fm = A.fm, pct = A.pct, num = E.num;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const won = v => Math.round(num(v, 0)).toLocaleString('ko-KR');
  const main = $('#main');

  const st = { data: null, tab: 'dash', sub: 'Income', over: {}, charts: {}, ledgerMonth: null, dirty: true, local: false };
  const TABS = [['dash', '대시보드'], ['ledger', '가계부'], ['advice', '추천'], ['invest', '투자'], ['sim', '시뮬레이션'], ['input', '입력'], ['settings', '설정'], ['guide', '가이드']];
  const SUBS = [['Income', '수입'], ['Expenses', '지출(계획)'], ['Assets', '자산·현금'], ['Debts', '대출·할부'], ['Events', '이벤트']];

  const COLS = {
    Income: [['name', '항목', 'text'], ['owner', '소유', 'select:me,wife,joint'], ['amount', '금액(만원)', 'num'], ['kind', '주기', 'select:monthly,yearly,once'], ['months', '월(연1회용)', 'text'], ['start', '시작', 'month'], ['end', '종료', 'month'], ['grow', '증가', 'select:,Y,I'], ['retire_stop', '은퇴시 중단', 'select:N,Y'], ['pause_from', '휴직 시작', 'month'], ['pause_to', '휴직 끝', 'month'], ['note', '메모', 'text'], ['active', '사용', 'select:Y,N']],
    Expenses: [['name', '항목', 'text'], ['category', '분류', 'text'], ['amount', '금액(만원)', 'num'], ['kind', '주기', 'select:monthly,yearly,once'], ['months', '월(연1회용)', 'text'], ['start', '시작', 'month'], ['end', '종료', 'month'], ['inflate', '물가반영', 'select:Y,N'], ['variable', '변동기준', 'select:N,Y'], ['note', '메모', 'text'], ['active', '사용', 'select:Y,N']],
    Assets: [['name', '항목', 'text'], ['category', '분류', 'select:cash,deposit,emergency,irp,isa,invest,lease,prepaid,car,real_estate,other'], ['owner', '소유', 'select:me,wife,joint'], ['value', '금액(만원)', 'num'], ['rate', '금리%', 'num'], ['liquid', '바로사용', 'select:Y,N'], ['note', '메모', 'text'], ['active', '사용', 'select:Y,N']],
    Holdings: [['account', '계좌', 'select:일반,ISA,IRP,연금저축,기타'], ['owner', '소유', 'select:me,wife,joint'], ['name', '종목', 'text'], ['sector', '섹터', 'text'], ['qty', '수량', 'num'], ['avg_price', '매입단가(원)', 'num'], ['price', '현재가(원)', 'num'], ['thesis', '보유 사유(논지)', 'text'], ['active', '사용', 'select:Y,N']],
    Debts: [['name', '항목', 'text'], ['principal', '원금(만원)', 'num'], ['rate', '금리%', 'num'], ['term', '기간(개월)', 'num'], ['start', '실행월', 'month'], ['disburse', '현금유입', 'select:Y,N'], ['note', '메모', 'text'], ['active', '사용', 'select:Y,N']],
    Events: [['date', '월', 'month'], ['name', '항목', 'text'], ['amount', '금액(만원, 지출은 −)', 'num'], ['category', '분류', 'select:house_pay,lease_return,tax,fee,move,interior,car,other'], ['certain', '확정', 'select:Y,N'], ['note', '메모', 'text'], ['active', '사용', 'select:Y,N']],
  };
  const DEFAULT_ROW = {
    Income: { owner: 'me', kind: 'monthly', grow: '', retire_stop: 'N', active: 'Y' },
    Expenses: { kind: 'monthly', inflate: 'Y', variable: 'N', active: 'Y' },
    Assets: { category: 'cash', owner: 'me', liquid: 'Y', active: 'Y' },
    Holdings: { account: '일반', owner: 'me', active: 'Y' },
    Debts: { disburse: 'N', active: 'Y' },
    Events: { category: 'other', certain: 'Y', active: 'Y' },
  };
  const SETTING_LABELS = {
    retire_age_me: ['본인 은퇴 나이', '세'], retire_age_wife: ['와이프 은퇴 나이', '세'], birth_me: ['본인 출생연도', ''], birth_wife: ['와이프 출생연도', ''],
    house_purchase_ym: ['집 잔금월 (YYYY-MM)', ''], house_price: ['매매가', '만원'], house_mean: ['집값 연평균 상승률', '%'], house_vol: ['집값 연 변동폭', '%'], house_seed: ['집값 변동 경로 시드', '숫자'],
    invest_return: ['투자 기대수익률', '%'], inflation: ['물가상승률', '%'], salary_growth: ['연봉 상승률', '%'], cash_rate: ['예금 금리', '%'],
    liquidity_floor: ['현금 경고선', '만원'], emergency_months: ['비상금 목표', '개월 생활비'], save_rate_target: ['목표 저축률', '%'],
    buffer_months: ['현금 보유 목표(초과분은 투자로 이동)', '개월 지출'], sweep_pct: ['초과 현금의 투자 이동 비율', '%'], variable_override: ['변동 생활비 실측값(0이면 계획값 사용)', '만원/월'],
    child_birth_year: ['자녀 출생연도', ''], sim_start: ['시뮬레이션 시작월', 'YYYY-MM'], years: ['시뮬레이션 기간', '년'],
  };
  const CATS_VAR = ['식비', '생활용품', '교통/차량', '의료', '여가/외식', '쇼핑/의류', '경조사/선물', '기타'];
  const CATS_FIX = ['고정-주거/관리비', '고정-교육/양육', '고정-보험', '고정-통신/구독', '고정-대출/할부', '고정-기타'];

  /* ---------- API ---------- */
  async function api(action, payload) {
    if (st.local) return { ok: true };
    const url = localStorage.getItem('am_api');
    const token = sessionStorage.getItem('am_tok');
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, payload || {})) });
    const j = await res.json();
    if (!j.ok) { if (j.error === 'AUTH') { logout(true); } throw new Error(j.error || '오류'); }
    return j;
  }
  const status = t => { $('#status').textContent = t; };
  const timers = {};
  function queueSave(tab, row) {
    status('수정됨…');
    clearTimeout(timers[tab + row.id]);
    timers[tab + row.id] = setTimeout(async () => {
      try { await api('save', { tab, row }); status('저장됨 ✓'); st.dirty = true; } catch (e) { status('저장 실패'); alert('저장 실패: ' + e.message); }
    }, 700);
  }
  const newId = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  /* ---------- 로그인 ---------- */
  function showLogin(msg) {
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    $('#apiUrl').value = localStorage.getItem('am_api') || '';
    $('#loginErr').textContent = msg || '';
    $('#pin').value = ''; (localStorage.getItem('am_api') ? $('#pin') : $('#apiUrl')).focus();
  }
  function logout(silent) {
    try { if (!silent) api('logout'); } catch (e) { /* ignore */ }
    sessionStorage.removeItem('am_tok'); st.data = null;
    showLogin(silent ? '세션이 만료되었습니다. 다시 접속하세요.' : '');
  }
  async function doLogin() {
    const url = $('#apiUrl').value.trim(), pin = $('#pin').value;
    if (!/^https:\/\/script\.google\.com\//.test(url)) { $('#loginErr').textContent = 'Apps Script 웹 앱 URL(https://script.google.com/...)을 입력하세요.'; return; }
    localStorage.setItem('am_api', url);
    $('#loginBtn').disabled = true; $('#loginErr').textContent = '확인 중…';
    try {
      const r = await api('login', { pin });
      sessionStorage.setItem('am_tok', r.token);
      await loadAll();
    } catch (e) { $('#loginErr').textContent = e.message; }
    $('#loginBtn').disabled = false;
  }
  async function loadAll() {
    status('불러오는 중…');
    const r = await api('all');
    st.data = r.data; st.dirty = true;
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    status(''); renderTabs(); render();
  }

  /* ---------- 계산 ---------- */
  function ensureCompute() {
    if (!st.dirty && st.sim) return;
    const sim = E.simulate(st.data);
    const S = sim.S;
    const ages = Array.from(new Set([45, 50, 55, S.retire_age_wife])).sort((a, b) => a - b);
    const scen = ages.map(a => Object.assign(E.scenarioMetrics(st.data, { retire_age_wife: a }, '와이프 ' + a + '세 은퇴'), { isBase: a === S.retire_age_wife }));
    st.sim = sim; st.scen = scen;
    st.adv = A.advise(st.data, sim, { now: new Date(), scenarios: scen });
    st.dirty = false;
  }

  /* ---------- 차트 ---------- */
  const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function mkChart(id, labels, datasets, opts) {
    if (st.charts[id]) st.charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="muted small">차트 라이브러리를 불러오지 못했습니다. 아래 표를 참고하세요.</p>'; return; }
    const txt = cssv('--text-2'), grid = cssv('--grid');
    st.charts[id] = new Chart(el, {
      type: 'line',
      data: { labels, datasets: datasets.map(d => Object.assign({ borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15, fill: false }, d)) },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: txt, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + fm(c.parsed.y) } } },
        scales: { x: { ticks: { color: txt, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { color: txt, callback: v => fm(v) }, grid: { color: grid } } },
      }, opts || {}),
    });
  }
  function nwCharts(id, sim) {
    const idx = [];
    for (let t = 0; t < sim.N; t++) if (t === 0 || (t + 1) % 12 === 0) idx.push(t);
    const lab = idx.map(t => sim.ym[t].slice(0, 4) + ' (' + sim.ageMe[t] + '세)');
    const fin = t => sim.cash[t] + sim.reserve[t] + sim.invest[t];
    mkChart(id, lab, [
      { label: '순자산', data: idx.map(t => sim.networth[t]), borderColor: cssv('--text'), borderWidth: 3 },
      { label: '집', data: idx.map(t => sim.house[t] + sim.re[t]), borderColor: cssv('--s1') },
      { label: '금융자산', data: idx.map(t => fin(t)), borderColor: cssv('--s3') },
      { label: '부채', data: idx.map(t => sim.debt[t]), borderColor: cssv('--s2') },
    ]);
  }

  /* ---------- 공통 UI ---------- */
  function cell(c, v) {
    const [k, , type] = c;
    if (type.indexOf('select:') === 0) {
      const opts = type.slice(7).split(',');
      if (v && opts.indexOf(String(v)) < 0) opts.push(String(v));
      return '<select data-k="' + k + '">' + opts.map(o => '<option value="' + esc(o) + '"' + (o === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
    }
    return '<input data-k="' + k + '" value="' + esc(v) + '"' + (type === 'num' ? ' inputmode="decimal"' : '') + (type === 'month' ? ' placeholder="YYYY-MM" size="8"' : '') + '>';
  }
  function editTable(tab, rows) {
    const cols = COLS[tab];
    return '<div class="tbl-wrap"><table class="edit-table" data-tab="' + tab + '"><thead><tr>' + cols.map(c => '<th>' + c[1] + '</th>').join('') + '<th></th></tr></thead><tbody>' +
      rows.map(r => '<tr data-id="' + esc(r.id) + '">' + cols.map(c => '<td>' + cell(c, r[c[0]]) + '</td>').join('') + '<td><button class="ghost danger" data-del>삭제</button></td></tr>').join('') +
      '</tbody></table></div><div class="toolbar"><button data-add="' + tab + '">+ 행 추가</button></div>';
  }
  const noteCard = c => '<div class="note ' + c.level + '"><div class="hd"><span class="badge">' + ({ risk: '⚠ 주의', warn: '▲ 점검', ok: '✓ 양호', info: 'ⓘ 참고' }[c.level]) + '</span><span class="badge">' + esc(c.tag) + '</span><span>' + esc(c.title) + '</span></div>' +
    (c.body ? '<div class="body">' + esc(c.body) + '</div>' : '') + (c.list.length ? '<ul>' + c.list.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '') + '</div>';
  const kpi = (l, v, s) => '<div class="kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  const signed = v => '<span class="' + (v < 0 ? 'neg' : v > 0 ? 'pos' : '') + '">' + (v > 0 ? '+' : '') + fm(v) + '</span>';
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  /* ---------- 대시보드 ---------- */
  function renderDash() {
    ensureCompute();
    const { sim, adv } = st, S = sim.S;
    const cur = A.curIdx(sim, new Date());
    const surplus = sim.income[cur] - sim.expFixed[cur] - sim.expVar[cur] - sim.debtPay[cur];
    const fin = t => sim.cash[t] + sim.reserve[t] + sim.invest[t];
    const last = sim.N - 1;
    const alerts = adv.cards.filter(c => c.level === 'risk' || c.level === 'warn').slice(0, 4);
    const evs = (st.data.Events || []).filter(e => E.isActive(e.active) && String(e.date) >= sim.ym[cur]).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 16);
    main.innerHTML =
      '<div class="grid g4" style="margin-bottom:12px">' +
      kpi('순자산 (' + sim.ym[cur] + ' 말 예상)', fm(sim.networth[cur]), '집·전세금·부채 포함') +
      kpi('현금 (입출금·단기)', fm(sim.cash[cur]), '월중 저점 ' + fm(sim.low[cur])) +
      kpi('투자·연금 자산', fm(sim.invest[cur]), '비상금 ' + fm(sim.reserve[cur]) + ' 별도') +
      kpi('이번 달 잉여 (이벤트 제외)', signed(surplus), '수입 ' + fm(sim.income[cur]) + ' · 지출 ' + fm(sim.expFixed[cur] + sim.expVar[cur] + sim.debtPay[cur])) +
      '</div><div class="grid g4" style="margin-bottom:16px">' +
      kpi('향후 2년 현금 저점', fm(adv.minCash), adv.minYm + ' (월중 추정)') +
      kpi('부채 잔액', fm(sim.debt[cur]), '월 상환 ' + fm(sim.debtPay[Math.min(last, cur + 8)])) +
      kpi('10년 후 순자산', fm(sim.networth[Math.min(last, 119)]), sim.ym[Math.min(last, 119)]) +
      kpi('30년 후 순자산', fm(sim.networth[last]), sim.ym[last] + ' · 본인 ' + sim.ageMe[last] + '세') +
      '</div>' +
      (alerts.length ? '<div class="card"><h2>지금 확인할 것</h2>' + alerts.map(noteCard).join('') + '<div class="small muted">전체 추천은 [추천] 탭에서 확인하세요.</div></div>' : '') +
      '<div class="grid g2"><div class="card"><h2>현금 잔액 (향후 36개월)</h2><div class="chart-box"><canvas id="cashChart" role="img" aria-label="월별 현금 잔액 추이"></canvas></div><div class="legend-note">월중 저점 = 큰 지출이 월급일(25일)보다 먼저 나간다고 보고 추정한 값</div></div>' +
      '<div class="card"><h2>순자산 (30년)</h2><div class="chart-box"><canvas id="nwChart" role="img" aria-label="연도별 순자산 추이"></canvas></div><div class="legend-note">집값은 연평균 ' + S.house_mean + '%에 맞춘 가상의 등락 경로입니다 (실제 예측 아님)</div></div></div>' +
      '<div class="card"><h2>앞으로의 주요 이벤트</h2><div class="tbl-wrap"><table><thead><tr><th>월</th><th>항목</th><th class="r">금액</th><th>확정</th><th>메모</th></tr></thead><tbody>' +
      evs.map(e => '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.name) + '</td><td class="r">' + signed(num(e.amount, 0)) + '</td><td>' + (e.certain === 'Y' ? '확정' : '추정') + '</td><td class="muted">' + esc(e.note) + '</td></tr>').join('') +
      '</tbody></table></div></div>';
    const n = Math.min(36, sim.N - cur), ix = Array.from({ length: n }, (_, i) => cur + i);
    mkChart('cashChart', ix.map(t => sim.ym[t]), [
      { label: '월말 현금', data: ix.map(t => sim.cash[t]), borderColor: cssv('--s1') },
      { label: '월중 저점(추정)', data: ix.map(t => sim.low[t]), borderColor: cssv('--s2'), borderDash: [5, 4] },
      { label: '경고선', data: ix.map(() => S.liquidity_floor), borderColor: cssv('--muted'), borderDash: [2, 3], borderWidth: 1 },
    ]);
    nwCharts('nwChart', sim);
  }

  /* ---------- 가계부 ---------- */
  function renderLedger() {
    ensureCompute();
    const { sim } = st;
    const led = st.data.Ledger || [];
    const curYm = sim.ym[A.curIdx(sim, new Date())];
    const months = A.ledgerMonths(led);
    if (months.indexOf(curYm) < 0) months.push(curYm);
    months.sort();
    if (!st.ledgerMonth || months.indexOf(st.ledgerMonth) < 0) st.ledgerMonth = curYm;
    const bc = A.budgetCap(st.data, sim, led, new Date());
    const ms = A.monthStats(led, st.ledgerMonth);
    const isCur = st.ledgerMonth === curYm;
    const capNow = bc.cur.cap;
    const ratio = capNow > 0 ? ms.variable / capNow : 0;
    const lvl = ratio > 1 ? 'risk' : ratio > 0.8 ? 'warn' : '';
    const rows = led.filter(r => String(r.date).slice(0, 7) === st.ledgerMonth).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    main.innerHTML =
      '<div class="card"><h2>지출 입력</h2><div class="form-row">' +
      '<div><label class="f">날짜</label><input type="date" id="lgDate" value="' + todayStr() + '"></div>' +
      '<div><label class="f">구분</label><select id="lgType"><option value="expense">지출</option><option value="income">수입</option></select></div>' +
      '<div><label class="f">금액(원)</label><input id="lgAmt" inputmode="numeric" placeholder="15000"></div>' +
      '<div><label class="f">분류</label><input id="lgCat" list="catList" placeholder="식비"><datalist id="catList">' + CATS_VAR.concat(CATS_FIX).map(c => '<option value="' + c + '">').join('') + '</datalist></div>' +
      '<div><label class="f">누가</label><select id="lgWho"><option value="me">나</option><option value="wife">와이프</option></select></div>' +
      '<div><label class="f">결제</label><select id="lgPay"><option>카드</option><option>현금</option><option>이체</option></select></div>' +
      '<div style="grid-column:span 2"><label class="f">메모</label><input id="lgMemo"></div>' +
      '<div><button class="primary" id="lgAdd" style="width:100%">추가</button></div></div>' +
      '<div class="small muted" style="margin-top:6px">"고정-"으로 시작하는 분류(관리비·유치원·보험 등)는 고정지출, 나머지는 변동지출로 계산합니다.</div></div>' +

      '<div class="grid g2"><div class="card"><h2>' + esc(st.ledgerMonth) + ' 지출 현황</h2>' +
      '<div class="toolbar"><select id="lgMonth" style="width:auto">' + months.map(m => '<option' + (m === st.ledgerMonth ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></div>' +
      '<div class="grid g3"><div class="kpi"><div class="l">총 지출</div><div class="v">' + fm(ms.total) + '</div></div><div class="kpi"><div class="l">고정</div><div class="v">' + fm(ms.fixed) + '</div></div><div class="kpi"><div class="l">변동</div><div class="v">' + fm(ms.variable) + '</div></div></div>' +
      (isCur ? '<div style="margin-top:12px"><div class="small">변동지출 상한 ' + fm(capNow) + ' 중 ' + Math.round(ratio * 100) + '% 사용 ' + (lvl === 'risk' ? '— ⚠ 초과' : lvl === 'warn' ? '— ▲ 80% 넘음' : '— ✓ 여유') + '</div><div class="bar ' + lvl + '"><i style="width:' + Math.min(100, ratio * 100) + '%"></i></div></div>' : '') +
      '</div>' +
      '<div class="card"><h2>' + esc(bc.next.ym) + ' 권장 변동지출 상한: ' + fm(bc.next.cap) + '</h2>' +
      (bc.next.tighten > 0 ? '<div class="note warn" style="margin:8px 0"><div class="body">' + esc(bc.next.tightenYm) + '의 큰 지출로 현금이 경고선 아래로 내려갑니다. 그때까지 매달 ' + fm(bc.next.tighten) + '씩 더 아끼도록 상한에서 뺐습니다.</div></div>' : '') +
      '<div class="small muted">= 수입 ' + fm(bc.next.income) + ' − 고정지출 ' + fm(bc.next.fixed) + ' − 대출·할부 ' + fm(bc.next.debt) + ' − 목표 저축 ' + fm(bc.next.save) + (bc.next.tighten > 0 ? ' − 큰 지출 대비 ' + fm(bc.next.tighten) : '') + ' (수입의 ' + st.sim.S.save_rate_target + '%)</div>' +
      (bc.hasData && bc.catRows.length ? '<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>분류</th><th class="r">이번 달</th><th class="r">지난달</th><th class="r">3개월 평균</th><th class="r">다음 달 권장</th></tr></thead><tbody>' +
        bc.catRows.sort((a, b) => b.avg - a.avg).map(r => '<tr><td>' + esc(r.cat) + '</td><td class="r">' + fm(r.thisMonth) + '</td><td class="r">' + fm(r.last) + '</td><td class="r">' + fm(r.avg) + '</td><td class="r"><b>' + fm(r.rec) + '</b></td></tr>').join('') + '</tbody></table></div>' +
        (bc.scale < 1 ? '<div class="small muted" style="margin-top:6px">평균 지출이 상한보다 커서 모든 분류를 ' + Math.round(bc.scale * 100) + '% 수준으로 줄이는 안입니다.</div>' : '') :
        '<p class="muted small" style="margin-top:8px">아직 지난달 데이터가 없어 분류별 권장은 한 달 뒤부터 계산됩니다. 지금은 전체 상한만 안내합니다.</p>') +
      '<div class="toolbar">' + (bc.avgVar != null && bc.avgVar > 0 ? '<button id="applyAvg">최근 평균 변동지출(' + fm(bc.avgVar) + ')을 시뮬레이션에 반영</button>' : '') + '</div></div></div>' +

      '<div class="card"><h2>' + esc(st.ledgerMonth) + ' 내역</h2><div class="tbl-wrap"><table><thead><tr><th>날짜</th><th>구분</th><th>분류</th><th class="r">금액(원)</th><th>누가</th><th>결제</th><th>메모</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(r => '<tr data-lid="' + esc(r.id) + '"><td>' + esc(r.date) + '</td><td>' + (r.type === 'income' ? '수입' : '지출') + '</td><td>' + esc(r.category) + '</td><td class="r">' + won(r.amount) + '</td><td>' + (r.who === 'wife' ? '와이프' : '나') + '</td><td>' + esc(r.pay) + '</td><td class="muted">' + esc(r.memo) + '</td><td><button class="ghost danger" data-ldel>삭제</button></td></tr>').join('') : '<tr><td colspan="8" class="muted">내역이 없습니다.</td></tr>') +
      '</tbody></table></div></div>';
  }
  async function addLedger() {
    const amt = num($('#lgAmt').value.replace(/[,\s]/g, ''), 0);
    if (!amt) { alert('금액을 입력하세요.'); return; }
    const row = { id: newId('led'), date: $('#lgDate').value || todayStr(), type: $('#lgType').value, amount: amt, category: $('#lgCat').value.trim() || '기타', who: $('#lgWho').value, pay: $('#lgPay').value, memo: $('#lgMemo').value.trim() };
    try {
      status('저장 중…'); await api('save', { tab: 'Ledger', row });
      (st.data.Ledger = st.data.Ledger || []).push(row); st.dirty = true; status('저장됨 ✓'); st.ledgerMonth = row.date.slice(0, 7); renderLedger();
    } catch (e) { status('저장 실패'); alert('저장 실패: ' + e.message); }
  }

  /* ---------- 추천 ---------- */
  function allocTable(rows, surplus) {
    if (!rows.length) return '<p class="muted small">배분할 잉여금이 없습니다.</p>';
    return '<div class="tbl-wrap"><table><thead><tr><th>용도</th><th class="r">월 금액</th><th>이유</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + esc(r.name) + '</td><td class="r"><b>' + fm(r.amt) + '</b></td><td class="muted" style="white-space:normal">' + esc(r.why) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function renderAdvice() {
    ensureCompute();
    const { adv } = st;
    const order = { risk: 0, warn: 1, info: 2, ok: 3 };
    main.innerHTML =
      '<div class="card"><h2>매월 고정지출 빼고 남는 돈, 어디에 쓸까</h2><div class="grid g2">' +
      '<div><h3>다음 달 (잉여 ' + fm(adv.nowSurplus) + ')</h3>' + allocTable(adv.allocNow) + '</div>' +
      '<div><h3>입주 후 안정기 (월 평균 잉여 ' + fm(adv.steadySurplus) + ')</h3>' + allocTable(adv.allocSteady) + '</div></div>' +
      '<div class="legend-note">우선순위: 현금 버퍼 → 비상금 → 세액공제 → 자녀 적립 → 대출 상환/ISA 투자. 규칙 기반 제안이며 투자 권유가 아닙니다.</div></div>' +
      adv.cards.slice().sort((a, b) => order[a.level] - order[b.level]).map(noteCard).join('') +
      '<div class="note info"><div class="hd"><span class="badge">ⓘ 참고</span><span class="badge">시장</span><span>증시·금리·환율·경제 이슈</span></div><div class="body">시장 데이터 자동 수집은 다음 단계입니다. [가이드] 탭의 연결 방법을 참고하세요.</div></div>';
  }

  /* ---------- 투자 ---------- */
  function investReport() {
    const hr = A.holdingsReport(st.data);
    return '<div class="tbl-wrap"><table><thead><tr><th>종목</th><th>계좌</th><th class="r">매입금</th><th class="r">평가금</th><th class="r">손익</th><th class="r">수익률</th><th class="r">비중</th><th>점검</th></tr></thead><tbody>' +
      hr.rows.map(r => '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.account) + '</td><td class="r">' + fm(r.cost) + '</td><td class="r">' + fm(r.value) + '</td><td class="r">' + signed(r.loss) + '</td><td class="r ' + (r.pnl < 0 ? 'neg' : 'pos') + '">' + pct(r.pnl) + '</td><td class="r">' + pct(r.weight) + '</td><td class="small" style="white-space:normal">' + (r.flags.length ? r.flags.map(f => '<span class="badge">' + esc(f) + '</span>').join(' ') : '<span class="muted">—</span>') + '</td></tr>').join('') +
      '<tr><th>합계</th><th></th><th class="r">' + fm(hr.totalCost) + '</th><th class="r">' + fm(hr.total) + '</th><th class="r">' + signed(hr.total - hr.totalCost) + '</th><th class="r">' + pct(hr.pnl) + '</th><th></th><th></th></tr></tbody></table></div>' +
      '<h3 style="margin-top:16px">섹터 비중</h3>' + hr.sectorList.map(s => '<div class="small" style="display:flex;justify-content:space-between"><span>' + esc(s.sector) + '</span><span>' + fm(s.value) + ' · ' + pct(s.weight) + '</span></div><div class="bar" style="margin-bottom:6px"><i style="width:' + (s.weight * 100) + '%;background:var(--s1)"></i></div>').join('');
  }
  function renderInvest() {
    main.innerHTML = '<div class="card"><h2>보유 종목 입력</h2><div class="small muted">매입단가·현재가는 원 단위입니다. 보유 사유(논지)를 적어두면 점검 항목에서 사라집니다.</div>' + editTable('Holdings', st.data.Holdings || []) + '</div>' +
      '<div class="card"><h2>점검</h2><div id="investReport">' + investReport() + '</div>' +
      '<div class="legend-note">손익은 입력한 현재가 기준입니다. 현재가 자동 갱신(GOOGLEFINANCE)은 다음 단계입니다.</div></div>';
  }

  /* ---------- 시뮬레이션 ---------- */
  const SIM_FIELDS = [['retire_age_me', '본인 은퇴 나이'], ['retire_age_wife', '와이프 은퇴 나이'], ['house_mean', '집값 연평균 %'], ['house_vol', '집값 변동폭 %'], ['house_seed', '변동 경로 시드'], ['invest_return', '투자수익률 %'], ['inflation', '물가상승률 %'], ['salary_growth', '연봉상승률 %']];
  function renderSim() {
    const base = E.settings(st.data);
    const over = st.over;
    const S = Object.assign({}, base, over);
    const sim = E.simulate(st.data, over);
    const ws = Array.from(new Set([45, 50, 55, 60, S.retire_age_wife])).sort((a, b) => a - b), ms = Array.from(new Set([55, 58, S.retire_age_me])).sort((a, b) => a - b);
    const sc = [];
    ms.forEach(m => ws.forEach(w => sc.push(E.scenarioMetrics(st.data, Object.assign({}, over, { retire_age_me: m, retire_age_wife: w }), '본인 ' + m + ' / 와이프 ' + w))));
    const yrs = [];
    for (let y = 0; y * 12 < sim.N; y++) {
      const a = y * 12, b = Math.min(sim.N, a + 12);
      let inc = 0, exp = 0;
      for (let t = a; t < b; t++) { inc += sim.income[t]; exp += sim.expFixed[t] + sim.expVar[t] + sim.debtPay[t]; }
      const t = b - 1;
      yrs.push({ y: sim.ym[a].slice(0, 4), age: sim.ageMe[t], inc, exp, nw: sim.networth[t], fin: sim.cash[t] + sim.reserve[t] + sim.invest[t], house: sim.house[t] + sim.re[t], debt: sim.debt[t], short: sim.short[t] > 0.5 });
    }
    main.innerHTML =
      '<div class="card"><h2>가정 바꿔보기</h2><div class="ctl">' + SIM_FIELDS.map(([k, l]) => '<div><label class="f">' + l + '</label><input data-sim="' + k + '" inputmode="decimal" value="' + esc(S[k]) + '"></div>').join('') +
      '</div><div class="toolbar"><button class="primary" id="simRun">계산</button><button id="simSave">이 가정을 설정에 저장</button><button class="ghost" id="simReset">초기화</button></div>' +
      '<div class="small muted">집값은 평균이 정확히 ' + S.house_mean + '%가 되도록 맞춘 가상의 등락입니다. 시드를 바꾸면 다른 경로가 나옵니다. 아래 결과는 미래 예측이 아니라 가정에 따른 계산입니다.</div></div>' +
      '<div class="card"><h2>순자산 추이</h2><div class="chart-box tall"><canvas id="simChart" role="img" aria-label="순자산 시뮬레이션"></canvas></div></div>' +
      '<div class="card"><h2>은퇴 시기별 비교</h2><div class="tbl-wrap"><table><thead><tr><th>시나리오</th><th class="r">금융자산 소진 나이</th><th class="r">10년 후 순자산</th><th class="r">20년 후 순자산</th><th class="r">65세 순자산</th><th class="r">65세 금융자산(부채 차감)</th></tr></thead><tbody>' +
      sc.map(s => '<tr><td>' + esc(s.label) + '</td><td class="r ' + (s.depleteAge ? 'neg' : 'pos') + '">' + (s.depleteAge ? s.depleteAge + '세' : '소진 없음') + '</td><td class="r">' + fm(s.nw10) + '</td><td class="r">' + fm(s.nw20) + '</td><td class="r">' + fm(s.nw65) + '</td><td class="r">' + fm(s.fin65) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="legend-note">금융자산 = 현금 + 비상금 + 투자(IRP 포함). 집 매각·주택연금은 반영하지 않았고 국민연금은 임시 추정값입니다. 소진 판단은 최대 50년(본인 88세)까지 봅니다.</div></div>' +
      '<div class="card"><h2>연도별 표</h2><div class="tbl-wrap"><table><thead><tr><th>연도</th><th class="r">본인 나이</th><th class="r">수입</th><th class="r">지출(대출상환 포함)</th><th class="r">순자산</th><th class="r">금융자산</th><th class="r">집</th><th class="r">부채</th></tr></thead><tbody>' +
      yrs.map(r => '<tr><td>' + r.y + '</td><td class="r">' + r.age + '</td><td class="r">' + fm(r.inc) + '</td><td class="r">' + fm(r.exp) + '</td><td class="r"><b>' + fm(r.nw) + '</b></td><td class="r' + (r.short ? ' neg' : '') + '">' + fm(r.fin) + '</td><td class="r">' + fm(r.house) + '</td><td class="r">' + fm(r.debt) + '</td></tr>').join('') + '</tbody></table></div></div>';
    nwCharts('simChart', sim);
  }
  async function saveSettingValue(key, value, note) {
    const list = (st.data.Settings = st.data.Settings || []);
    let row = list.find(r => r.id === key);
    if (!row) { row = { id: key, value: '', note: note || '' }; list.push(row); }
    row.value = value; st.dirty = true;
    await api('save', { tab: 'Settings', row });
  }

  /* ---------- 입력 / 설정 / 가이드 ---------- */
  function renderInput() {
    main.innerHTML = '<div class="sub">' + SUBS.map(([k, l]) => '<button data-sub="' + k + '"' + (st.sub === k ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div>' +
      '<div class="card"><div class="small muted" style="margin-bottom:6px">' + ({
        Income: '금액은 만원. 주기가 yearly면 "월" 칸에 1,2처럼 입력. 증가 Y=연봉상승률, I=물가연동. 휴직 기간은 월급이 0으로 계산됩니다.',
        Expenses: '변동기준 Y인 행은 가계부 실측값으로 대체할 수 있습니다. 교육 분류는 자녀 분석에 쓰입니다.',
        Assets: '분류 cash/deposit=바로 쓰는 돈, emergency=비상금, lease=내가 낸 전세보증금, prepaid=집 계약 선납금, car=차량. 주식은 [투자] 탭에서 입력하세요.',
        Debts: '실행월 다음 달부터 상환합니다. 현금유입 Y는 실행월에 원금이 현금으로 들어옴(주담대). 카드 할부는 N.',
        Events: '지출은 마이너스. house_pay는 집값 선납으로, lease_return은 전세금 반환으로 처리됩니다.',
      })[st.sub] + '</div>' + editTable(st.sub, st.data[st.sub] || []) + '</div>';
  }
  function renderSettings() {
    const S = E.settings(st.data);
    const keys = Object.keys(E.DEFAULTS);
    main.innerHTML = '<div class="card"><h2>가정값 설정</h2><div class="tbl-wrap"><table class="set-table"><thead><tr><th>항목</th><th>값</th><th>단위</th></tr></thead><tbody>' +
      keys.map(k => '<tr data-k="' + k + '"><td>' + esc((SETTING_LABELS[k] || [k])[0]) + ' <span class="muted small">' + k + '</span></td><td><input value="' + esc(S[k]) + '"></td><td class="muted">' + esc((SETTING_LABELS[k] || ['', ''])[1]) + '</td></tr>').join('') +
      '</tbody></table></div></div><div class="card"><h2>보안</h2><p class="small muted">보안코드는 구글 시트 메뉴 [자산관리 > 보안코드 설정]에서 바꿉니다. 5회 틀리면 15분간 접속이 잠깁니다.</p></div>';
  }
  function renderGuide() {
    main.innerHTML = '<div class="card"><h2>시장·경제 데이터 연결 가이드 (다음 단계)</h2>' +
      '<p>목표: 금리·환율·지수·물가를 시트에 매일 저장하고, 그 값으로 추천에 반영하기.</p>' +
      '<details open><summary>1. 지금 바로 되는 것 — 구글시트 GOOGLEFINANCE</summary><p class="small">주가·지수·환율은 시트 함수로 무료 갱신됩니다. 예: <code>=GOOGLEFINANCE("KRX:000270","price")</code>, <code>=GOOGLEFINANCE("CURRENCY:USDKRW")</code>. 투자 탭의 현재가를 시트 수식으로 연결하는 작업을 다음에 해드립니다.</p></details>' +
      '<details><summary>2. 금리·물가 — 한국은행 ECOS, 미국 FRED (무료 API 키)</summary><p class="small">Apps Script의 UrlFetchApp로 하루 한 번 호출해 Market 탭에 저장합니다. 키는 Script Properties에만 보관해 사이트·git에 노출하지 않습니다.</p></details>' +
      '<details><summary>3. 뉴스·이슈 해석</summary><p class="small">자동 요약은 유료 LLM API가 필요합니다. 무료 대안: 주 1회 Market 탭 요약을 Claude에 붙여넣어 코멘트를 받고, 결론만 메모로 저장하세요. MCP 연결은 필수가 아닙니다(자동화를 원할 때 Google Drive/시트 커넥터를 검토).</p></details>' +
      '<details><summary>4. 이 사이트의 보안 구조</summary><p class="small">데이터는 구글 시트에만 있고, 이 페이지(코드)에는 개인정보가 없습니다. Apps Script는 보안코드를 확인한 뒤 6시간짜리 토큰을 주고, 토큰 없이는 데이터를 반환하지 않습니다. 웹 앱 URL과 보안코드는 가족 외에 공유하지 마세요.</p></details></div>';
  }

  /* ---------- 라우팅 ---------- */
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (st.tab === k ? ' class="on"' : '') + '>' + l + '</button>').join('');
  }
  function render() {
    if (!st.data) return;
    Object.keys(st.charts).forEach(k => { try { st.charts[k].destroy(); } catch (e) { /* ignore */ } delete st.charts[k]; });
    ({ dash: renderDash, ledger: renderLedger, advice: renderAdvice, invest: renderInvest, sim: renderSim, input: renderInput, settings: renderSettings, guide: renderGuide })[st.tab]();
    window.scrollTo(0, 0);
  }

  /* ---------- 이벤트 ---------- */
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; st.tab = b.dataset.tab; renderTabs(); render(); });
  $('#loginBtn').addEventListener('click', doLogin);
  $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#logoutBtn').addEventListener('click', () => logout(false));
  $('#reloadBtn').addEventListener('click', () => loadAll().catch(e => alert(e.message)));

  main.addEventListener('input', e => {
    const t = e.target;
    const table = t.closest('table.edit-table');
    if (table) {
      const tr = t.closest('tr[data-id]'); if (!tr) return;
      const tab = table.dataset.tab, row = (st.data[tab] || []).find(r => String(r.id) === tr.dataset.id);
      if (!row) return;
      row[t.dataset.k] = t.value; queueSave(tab, row);
      if (tab === 'Holdings') { const el = $('#investReport'); if (el) el.innerHTML = investReport(); }
      return;
    }
    const sTr = t.closest('table.set-table tr[data-k]');
    if (sTr) { clearTimeout(timers['set' + sTr.dataset.k]); status('수정됨…'); timers['set' + sTr.dataset.k] = setTimeout(() => saveSettingValue(sTr.dataset.k, t.value).then(() => status('저장됨 ✓')).catch(err => { status('저장 실패'); alert(err.message); }), 700); }
  });

  main.addEventListener('click', async e => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-sub]'))) { st.sub = b.dataset.sub; renderInput(); return; }
    if ((b = t.closest('[data-add]'))) {
      const tab = b.dataset.add, row = Object.assign({ id: newId(tab.slice(0, 3).toLowerCase()) }, DEFAULT_ROW[tab] || {});
      COLS[tab].forEach(c => { if (row[c[0]] === undefined) row[c[0]] = ''; });
      try { await api('save', { tab, row }); (st.data[tab] = st.data[tab] || []).push(row); st.dirty = true; tab === 'Holdings' ? renderInvest() : renderInput(); } catch (err) { alert('추가 실패: ' + err.message); }
      return;
    }
    if (t.closest('[data-del]')) {
      const tr = t.closest('tr[data-id]'), tab = t.closest('table').dataset.tab;
      if (!confirm('이 행을 삭제할까요?')) return;
      try { await api('del', { tab, id: tr.dataset.id }); st.data[tab] = st.data[tab].filter(r => String(r.id) !== tr.dataset.id); st.dirty = true; tab === 'Holdings' ? renderInvest() : renderInput(); } catch (err) { alert('삭제 실패: ' + err.message); }
      return;
    }
    if (t.closest('#lgAdd')) { addLedger(); return; }
    if (t.closest('[data-ldel]')) {
      const id = t.closest('tr').dataset.lid;
      if (!confirm('이 내역을 삭제할까요?')) return;
      try { await api('del', { tab: 'Ledger', id }); st.data.Ledger = st.data.Ledger.filter(r => String(r.id) !== id); st.dirty = true; renderLedger(); } catch (err) { alert('삭제 실패: ' + err.message); }
      return;
    }
    if (t.closest('#applyAvg')) {
      const bc = A.budgetCap(st.data, st.sim, st.data.Ledger || [], new Date());
      if (!(bc.avgVar > 0)) return;
      try { await saveSettingValue('variable_override', Math.round(bc.avgVar), '가계부 최근 평균 변동지출'); status('저장됨 ✓'); alert('시뮬레이션의 변동 생활비를 ' + Math.round(bc.avgVar) + '만원/월로 바꿨습니다.'); } catch (err) { alert(err.message); }
      return;
    }
    if (t.closest('#simRun')) {
      st.over = {};
      main.querySelectorAll('[data-sim]').forEach(i => { const v = i.value.trim(); if (v !== '' && !isNaN(Number(v))) st.over[i.dataset.sim] = Number(v); });
      renderSim(); return;
    }
    if (t.closest('#simReset')) { st.over = {}; renderSim(); return; }
    if (t.closest('#simSave')) {
      st.over = {};
      main.querySelectorAll('[data-sim]').forEach(i => { const v = i.value.trim(); if (v !== '' && !isNaN(Number(v))) st.over[i.dataset.sim] = Number(v); });
      try { for (const k of Object.keys(st.over)) await saveSettingValue(k, st.over[k]); st.over = {}; status('저장됨 ✓'); renderSim(); } catch (err) { alert(err.message); }
    }
  });
  main.addEventListener('change', e => {
    if (e.target.id === 'lgMonth') { st.ledgerMonth = e.target.value; renderLedger(); }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (st.data) render(); });

  /* ---------- 시작 ---------- */
  window.__AM = { st, start: data => { st.local = true; st.data = data; st.dirty = true; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); renderTabs(); render(); } };
  if (window.__TEST_DATA) { window.__AM.start(window.__TEST_DATA); return; }
  if (sessionStorage.getItem('am_tok') && localStorage.getItem('am_api')) loadAll().catch(() => showLogin(''));
  else showLogin('');
})();
