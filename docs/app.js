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
  const TABS = [['dash', '홈'], ['ledger', '가계부'], ['advice', '추천'], ['invest', '투자'], ['scn', '시나리오'], ['sim', '시뮬레이션'], ['input', '입력'], ['settings', '설정'], ['guide', '가이드']];
  const SUBS = [['Income', '수입'], ['Expenses', '지출(계획)'], ['Assets', '자산·현금'], ['Debts', '대출·할부'], ['Events', '이벤트']];

  const COLS = {
    Income: [['name', '항목', 'text'], ['owner', '소유', 'select:me,wife,joint'], ['amount', '금액(만원)', 'num'], ['kind', '주기', 'select:monthly,yearly,once'], ['months', '월(연1회용)', 'text'], ['start', '시작', 'month'], ['end', '종료', 'month'], ['grow', '증가', 'select:,Y,I'], ['retire_stop', '은퇴시 중단', 'select:N,Y'], ['pause_from', '휴직 시작', 'month'], ['pause_to', '휴직 끝', 'month'], ['note', '메모', 'text'], ['active', '사용', 'select:Y,N']],
    Expenses: [['name', '항목', 'text'], ['category', '분류', 'text'], ['amount', '금액(만원)', 'num'], ['kind', '주기', 'select:monthly,yearly,once'], ['months', '월(연1회용)', 'text'], ['start', '시작', 'month'], ['end', '종료', 'month'], ['inflate', '물가반영', 'select:Y,N'], ['variable', '변동기준', 'select:N,Y'], ['note', '메모', 'text'], ['active', '사용', 'select:Y,N']],
    Assets: [['name', '항목', 'text'], ['category', '분류', 'select:cash,deposit,emergency,irp,isa,invest,lease,prepaid,car,real_estate,other'], ['owner', '소유', 'select:me,wife,joint'], ['value', '금액(만원)', 'num'], ['rate', '금리%', 'num'], ['liquid', '바로사용', 'select:Y,N'], ['note', '메모', 'text'], ['active', '사용', 'select:Y,N']],
    Holdings: [['account', '계좌', 'select:일반,ISA,IRP,연금저축,기타'], ['owner', '소유', 'select:me,wife,joint'], ['name', '종목', 'text'], ['sector', '섹터', 'text'], ['qty', '수량', 'num'], ['avg_price', '매입단가(원)', 'num'], ['price', '현재가(원)', 'num'], ['symbol', '시세 코드', 'text'], ['thesis', '보유 사유(논지)', 'text'], ['active', '사용', 'select:Y,N']],
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
    house_target: ['집 목표 매도가', '만원'], move_in_ym: ['입주월 (실거주 시작)', 'YYYY-MM'], sell_ym: ['매도월 (비우면 매도 안 함)', 'YYYY-MM'], sell_mode: ['매도 후 주거 (jeonse 또는 rent)', ''],
    sell_fee_pct: ['매도 중개보수율(VAT 포함)', '%'], house_basis_extra: ['취득 부대비용(취득세·중개·등기)', '만원'], house_capex: ['양도세 경비로 인정될 공사비', '만원'],
    after_deposit: ['매도 후 전세 보증금', '만원'], after_rent: ['매도 후 월세', '만원/월'], after_rent_deposit: ['월세 보증금', '만원'],
    tesla: ['테슬라 (buy 또는 skip)', ''], tesla_fin_pct: ['테슬라 할부 비율', '%'], tesla_rate: ['테슬라 할부 금리', '%'], tesla_term: ['테슬라 할부 기간', '개월'],
    child_birth_year: ['자녀 출생연도', ''], sim_start: ['시뮬레이션 시작월', 'YYYY-MM'], years: ['시뮬레이션 기간', '년'],
  };
  const CATS_VAR = ['식비', '생활용품', '교통/차량', '의료', '여가/외식', '쇼핑/의류', '경조사/선물', '기타'];
  const CATS_FIX = ['고정-주거/관리비', '고정-교육/양육', '고정-보험', '고정-통신/구독', '고정-대출/할부', '고정-기타'];

  /* ---------- API ---------- */
  async function api(action, payload) {
    if (st.local) return { ok: true };
    const url = localStorage.getItem('am_api');
    const token = sessionStorage.getItem('am_tok');
    let res, j;
    try {
      res = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, payload || {})) });
    } catch (e) {
      throw new Error('서버에 연결하지 못했습니다. 웹 앱 주소가 맞는지, 배포 권한이 "모든 사용자"인지 확인하세요.');
    }
    try { j = await res.json(); } catch (e) {
      throw new Error('응답이 올바르지 않습니다. 배포의 "액세스 권한"을 "모든 사용자"로 하고 새 버전으로 다시 배포했는지 확인하세요.');
    }
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
    const saved = localStorage.getItem('am_api') || '';
    $('#apiUrl').value = saved;
    $('#apiBox').classList.toggle('hidden', !!saved);
    $('#apiSaved').classList.toggle('hidden', !saved);
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
    if (!/\/exec(\?.*)?$/.test(url)) { $('#loginErr').textContent = '주소가 /exec 로 끝나야 합니다. (배포 > 웹 앱의 URL을 복사하세요. /dev 로 끝나는 주소는 안 됩니다.)'; return; }
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
    st.data = r.data; st.meta = r.meta || {}; st.loadedAt = Date.now(); st.dirty = true;
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
  function commaFmt(raw) {
    const m = /^(-?)(\d*)(\.\d*)?$/.exec(String(raw));
    if (!m) return String(raw);
    return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] || '');
  }
  /** 숫자 입력칸에 천 단위 쉼표를 넣고, 저장용 순수 숫자 문자열을 돌려준다 */
  function liveFormat(t) {
    if (!t.dataset.num) return t.value;
    const end = t.value.length - (t.selectionStart == null ? t.value.length : t.selectionStart);
    const raw = t.value.replace(/,/g, '');
    if (!/^-?\d*\.?\d*$/.test(raw)) return raw;
    const f = commaFmt(raw);
    if (f !== t.value) { t.value = f; const pos = Math.max(0, f.length - end); try { t.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
    return raw;
  }
  function cell(c, v) {
    const [k, , type] = c;
    if (type.indexOf('select:') === 0) {
      const opts = type.slice(7).split(',');
      if (v && opts.indexOf(String(v)) < 0) opts.push(String(v));
      return '<select data-k="' + k + '">' + opts.map(o => '<option value="' + esc(o) + '"' + (o === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
    }
    if (type === 'num') return '<input data-k="' + k + '" data-num="1" inputmode="decimal" value="' + esc(commaFmt(v == null ? '' : v)) + '">';
    return '<input data-k="' + k + '" value="' + esc(v) + '"' + (type === 'month' ? ' placeholder="YYYY-MM" size="8"' : '') + '>';
  }
  function editTable(tab, rows) {
    const cols = COLS[tab];
    return '<div class="tbl-wrap"><table class="edit-table" data-tab="' + tab + '"><thead><tr>' + cols.map(c => '<th>' + c[1] + '</th>').join('') + '<th></th></tr></thead><tbody>' +
      rows.map(r => '<tr data-id="' + esc(r.id) + '">' + cols.map(c => '<td>' + cell(c, r[c[0]]) + '</td>').join('') + '<td><button class="ghost danger" data-del>삭제</button></td></tr>').join('') +
      '</tbody></table></div><div class="toolbar"><button data-add="' + tab + '">+ 행 추가</button></div>';
  }
  const noteCard = c => '<div class="note ' + c.level + '"><div class="hd"><span class="badge">' + ({ risk: '주의', warn: '점검', ok: '양호', info: '참고' }[c.level]) + '</span><span class="badge plain">' + esc(c.tag) + '</span><span>' + esc(c.title) + '</span></div>' +
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
    const alerts = adv.cards.filter(c => (c.level === 'risk' || c.level === 'warn') && c.tag !== '유동성').slice(0, 3);
    const evs = (st.data.Events || []).filter(e => E.isActive(e.active) && String(e.date) >= sim.ym[cur]).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 24);

    const prop = sim.house[cur] + sim.re[cur] + sim.prepaid[cur] + sim.lease[cur] + sim.car[cur] + sim.other[cur];
    const hero = '<div class="card hero"><div class="l">순자산 · ' + sim.ym[cur] + ' 말 예상</div><div class="v">' + fm(sim.networth[cur]) + '</div><div class="s"><span>금융 ' + fm(fin(cur)) + '</span><span>집·보증금·차 ' + fm(prop) + '</span><span>부채 −' + fm(sim.debt[cur]) + '</span></div></div>';

    const led = st.data.Ledger || [];
    const bc = A.budgetCap(st.data, sim, led, new Date());
    const ms = A.monthStats(led, sim.ym[cur]);
    const cap = bc.cur.cap, spent = ms.variable, remain = cap - spent, ratio = cap > 0 ? spent / cap : 0;
    const now = new Date(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), daysLeft = Math.max(1, dim - now.getDate() + 1);
    const lvl = ratio > 1 ? 'risk' : ratio > 0.8 ? 'warn' : '';
    const budgetHtml = '<div class="card"><div class="row-between"><h2>이번 달 변동지출</h2><span class="small muted">상한 ' + fm(cap) + '</span></div>' +
      (ms.count ? '<div class="big-num">' + fm(spent) + ' <span class="small muted">상한의 ' + Math.round(ratio * 100) + '%</span></div>' +
        '<div class="bar ' + lvl + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, Math.round(ratio * 100)) + '" style="margin-top:8px"><i style="width:' + Math.min(100, ratio * 100) + '%"></i></div>' +
        '<div class="small" style="margin-top:8px">' + (remain >= 0 ? '남은 ' + fm(remain) + ' · 하루 ' + fm(remain / daysLeft) + (lvl === 'warn' ? ' · 80% 넘었어요' : '') : '<b>상한 초과 ' + fm(-remain) + '</b>') + '</div>' :
        '<div class="muted small">이번 달 입력한 지출이 아직 없습니다.</div><div class="toolbar"><button class="primary" data-tab="ledger">가계부 입력하기</button></div>') +
      (bc.cur.tighten > 0 ? '<div class="small muted" style="margin-top:6px">' + esc(bc.cur.tightenYm) + '의 큰 지출에 대비해 상한을 ' + fm(bc.cur.tighten) + ' 낮췄어요.</div>' : '') + '</div>';

    const cells = []; let minV = Infinity, minK = cur;
    for (let k = cur; k < Math.min(sim.N, cur + 12); k++) {
      const v = sim.low[k]; if (v < minV) { minV = v; minK = k; }
      const c = v < S.liquidity_floor ? 'risk' : v < S.liquidity_floor * 2 ? 'warn' : 'ok';
      cells.push('<div class="rs-cell ' + c + '"><div class="m">' + sim.ym[k].slice(2).replace('-', '.') + '</div><div class="a">' + fm(v) + '</div><div class="t">' + ({ risk: '주의', warn: '빠듯', ok: '' }[c]) + '</div></div>');
    }
    const mrows = [];
    for (let k = cur; k < Math.min(sim.N, cur + 12); k++) {
      mrows.push('<tr><td>' + sim.ym[k] + '</td><td class="r">' + fm(sim.income[k]) + '</td><td class="r">' + fm(-(sim.expFixed[k] + sim.expVar[k])) + '</td><td class="r">' + fm(-sim.debtPay[k]) + '</td><td class="r">' + (sim.events[k] || sim.disb[k] ? signed(sim.events[k] + sim.disb[k]) : '<span class="muted">—</span>') + '</td><td class="r"><b>' + fm(sim.cash[k]) + '</b></td><td class="r ' + (sim.low[k] < S.liquidity_floor ? 'neg' : '') + '">' + fm(sim.low[k]) + '</td></tr>');
    }
    const riskHtml = '<div class="card"><div class="row-between"><h2>향후 12개월 현금</h2><span class="small muted">월중 저점 · 경고선 ' + fm(S.liquidity_floor) + '</span></div>' +
      '<div class="small">' + (minV < S.liquidity_floor ? '<b>' + sim.ym[minK] + '에 약 ' + fm(minV) + '까지 내려가요.</b> 그 전 달 변동지출을 줄이세요.' : '경고선 아래로 내려가는 달이 없습니다.') + '</div><div class="rs">' + cells.join('') + '</div>' +
      '<div class="tbl-wrap mini" style="margin-top:12px"><table><thead><tr><th>월</th><th class="r">수입</th><th class="r">생활·고정 지출</th><th class="r">대출·할부</th><th class="r">큰 이벤트(순)</th><th class="r">월말 현금</th><th class="r">월중 저점</th></tr></thead><tbody>' + mrows.join('') + '</tbody></table></div>' +
      '<div class="legend-note">큰 이벤트 = 집 계약금·잔금, 전세 반환, 대출 실행, 세금·이사 등. 대출 실행과 전세 반환은 같은 달 잔금으로 나가서 순액이 작게 보일 수 있습니다.</div></div>';
    const mInc = sim.income[cur], mExp = sim.expFixed[cur] + sim.expVar[cur], mDebt = sim.debtPay[cur];
    const monthHtml = '<div class="card"><h2>이번 달 수입·지출 (계획)</h2><table><tbody>' +
      '<tr><td>수입</td><td class="r">' + fm(mInc) + '</td></tr><tr><td>생활·고정 지출</td><td class="r">' + fm(-mExp) + '</td></tr><tr><td>대출·할부 상환</td><td class="r">' + fm(-mDebt) + '</td></tr>' +
      '<tr><td><b>잉여</b></td><td class="r"><b>' + signed(mInc - mExp - mDebt) + '</b></td></tr></tbody></table><div class="legend-note">큰 이벤트는 제외한 금액입니다.</div></div>';

    main.innerHTML = hero + '<div class="grid g2">' + budgetHtml + monthHtml + '</div>' + riskHtml +
      '<div class="grid g4" style="margin-bottom:14px">' +
      kpi('현금 (입출금·단기)', fm(sim.cash[cur]), '비상금 ' + fm(sim.reserve[cur]) + ' 별도') +
      kpi('투자·연금 자산', fm(sim.invest[cur]), '이번 달 잉여 ' + signed(surplus)) +
      kpi('부채 잔액', fm(sim.debt[cur]), '월 상환 ' + fm(sim.debtPay[Math.min(last, cur + 8)])) +
      kpi('30년 후 순자산', fm(sim.networth[last]), sim.ym[last] + ' · 본인 ' + sim.ageMe[last] + '세') +
      '</div>' +
      (alerts.length ? '<div class="card"><h2>그 밖에 확인할 것</h2>' + alerts.map(noteCard).join('') + '<div class="small muted">전체 추천은 [추천]에서 확인하세요.</div></div>' : '') +
      '<div class="grid g2"><div class="card"><h2>현금 잔액 (향후 36개월)</h2><div class="chart-box"><canvas id="cashChart" role="img" aria-label="월별 현금 잔액 추이"></canvas></div><div class="legend-note">월중 저점 = 큰 지출이 월급일(25일)보다 먼저 나간다고 보고 추정한 값</div></div>' +
      '<div class="card"><h2>순자산 (30년)</h2><div class="chart-box"><canvas id="nwChart" role="img" aria-label="연도별 순자산 추이"></canvas></div><div class="legend-note">집값은 연평균 ' + S.house_mean + '%에 맞춘 가상의 등락 경로입니다 (실제 예측 아님)</div></div></div>' +
      '<div class="card"><h2>앞으로의 주요 이벤트와 자산 변화</h2><div class="tbl-wrap mini"><table><thead><tr><th>월</th><th>항목</th><th class="r">현금 영향</th><th class="r">순자산 영향</th><th class="r">그 달 순자산 변화</th><th class="r">월말 순자산</th></tr></thead><tbody>' +
      (() => { let prevYm = ''; return evs.map(e => { const t = sim.ym.indexOf(e.date); const eff = A.eventNwEffect(e); const first = e.date !== prevYm; prevYm = e.date; return '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.name) + (e.certain === 'Y' ? '' : ' <span class="badge plain">추정</span>') + '</td><td class="r">' + signed(num(e.amount, 0)) + '</td><td class="r">' + (eff === 0 ? '<span class="muted">0 (자산 전환)</span>' : signed(eff)) + '</td><td class="r">' + (!first ? '<span class="muted">〃</span>' : t > 0 ? signed(sim.networth[t] - sim.networth[t - 1]) : '—') + '</td><td class="r">' + (!first ? '<span class="muted">〃</span>' : t >= 0 ? '<b>' + fm(sim.networth[t]) + '</b>' : '—') + '</td></tr>'; }).join(''); })() +
      '</tbody></table></div><div class="legend-note">집 계약금·중도금·잔금, 전세 반환, 차량 구입은 현금이 집·차 같은 자산으로 바뀌는 것이라 순자산에는 영향이 없습니다. 세금·수수료·이사·인테리어는 비용으로 순자산이 줄어듭니다. 순자산 변화에는 그 달의 월급·생활비·투자 수익·집값 변동도 포함됩니다.</div></div>';
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
    const who = (() => { try { return localStorage.getItem('am_who') || 'me'; } catch (e) { return 'me'; } })();
    main.innerHTML =
      '<div class="card"><div class="row-between"><h2>지출 입력</h2><div class="seg" role="group" aria-label="입력자">' + [['me', '나'], ['wife', '와이프']].map(([w, l]) => '<button type="button" data-who="' + w + '"' + (who === w ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div></div>' +
      '<input type="hidden" id="lgWho" value="' + who + '">' +
      '<input id="lgAmt" class="qe-amt" data-num="1" inputmode="numeric" placeholder="0" aria-label="금액(원)">' +
      '<div class="chips" role="group" aria-label="분류">' + CATS_VAR.map(c => '<button type="button" class="chip" data-cat="' + c + '">' + c + '</button>').join('') + '</div>' +
      '<div class="form-row">' +
      '<div><label class="f">분류 직접 입력 (고정지출은 "고정-…")</label><input id="lgCat" list="catList" placeholder="식비"><datalist id="catList">' + CATS_VAR.concat(CATS_FIX).map(c => '<option value="' + c + '">').join('') + '</datalist></div>' +
      '<div><label class="f">날짜</label><input type="date" id="lgDate" value="' + todayStr() + '"></div>' +
      '<div><label class="f">구분</label><select id="lgType"><option value="expense">지출</option><option value="income">수입</option></select></div>' +
      '<div><label class="f">결제</label><select id="lgPay"><option>카드</option><option>현금</option><option>이체</option></select></div>' +
      '<div style="grid-column:span 2"><label class="f">메모</label><input id="lgMemo"></div>' +
      '<div><button class="primary" id="lgAdd" style="width:100%">추가</button></div></div>' +
      '<div class="small muted" style="margin-top:6px">"고정-"으로 시작하는 분류(관리비·유치원·보험 등)는 고정지출, 나머지는 변동지출로 계산합니다.</div></div>' +

      '<div class="grid g2"><div class="card"><h2>' + esc(st.ledgerMonth) + ' 지출 현황</h2>' +
      '<div class="toolbar"><select id="lgMonth" style="width:auto">' + months.map(m => '<option' + (m === st.ledgerMonth ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></div>' +
      '<div class="grid g3"><div class="kpi"><div class="l">총 지출</div><div class="v">' + fm(ms.total) + '</div></div><div class="kpi"><div class="l">고정</div><div class="v">' + fm(ms.fixed) + '</div></div><div class="kpi"><div class="l">변동</div><div class="v">' + fm(ms.variable) + '</div></div></div>' +
      (isCur ? '<div style="margin-top:12px"><div class="small">변동지출 상한 ' + fm(capNow) + ' 중 ' + Math.round(ratio * 100) + '% 사용 ' + (lvl === 'risk' ? '— 초과' : lvl === 'warn' ? '— 80% 넘음' : '— 여유') + '</div><div class="bar ' + lvl + '"><i style="width:' + Math.min(100, ratio * 100) + '%"></i></div></div>' : '') +
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
      '<div class="note info"><div class="hd"><span class="badge">참고</span><span class="badge plain">시장</span><span>증시·금리·환율·경제 이슈</span></div><div class="body">시장 데이터 자동 수집은 다음 단계입니다. [가이드] 탭의 연결 방법을 참고하세요.</div></div>';
  }

  /* ---------- 투자 ---------- */
  function investReport() {
    const hr = A.holdingsReport(st.data);
    return '<div class="tbl-wrap"><table><thead><tr><th>종목</th><th>계좌</th><th class="r">매입금</th><th class="r">평가금</th><th class="r">손익</th><th class="r">수익률</th><th class="r">비중</th><th>시세 갱신</th><th>점검</th></tr></thead><tbody>' +
      hr.rows.map(r => '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.account) + '</td><td class="r">' + fm(r.cost) + '</td><td class="r">' + fm(r.value) + '</td><td class="r">' + signed(r.loss) + '</td><td class="r ' + (r.pnl < 0 ? 'neg' : 'pos') + '">' + pct(r.pnl) + '</td><td class="r">' + pct(r.weight) + '</td><td class="small muted">' + ago(r.price_at) + '</td><td class="small" style="white-space:normal">' + (r.flags.length ? r.flags.map(f => '<span class="badge">' + esc(f) + '</span>').join(' ') : '<span class="muted">—</span>') + '</td></tr>').join('') +
      '<tr><th>합계</th><th></th><th class="r">' + fm(hr.totalCost) + '</th><th class="r">' + fm(hr.total) + '</th><th class="r">' + signed(hr.total - hr.totalCost) + '</th><th class="r">' + pct(hr.pnl) + '</th><th></th><th></th><th></th></tr></tbody></table></div>' +
      '<h3 style="margin-top:16px">섹터 비중</h3>' + hr.sectorList.map(s => '<div class="small" style="display:flex;justify-content:space-between"><span>' + esc(s.sector) + '</span><span>' + fm(s.value) + ' · ' + pct(s.weight) + '</span></div><div class="bar" style="margin-bottom:6px"><i style="width:' + (s.weight * 100) + '%;background:var(--s1)"></i></div>').join('');
  }
  const ago = iso => {
    if (!iso) return '—';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(m)) return '—';
    return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.floor(m / 60) + '시간 전' : Math.floor(m / 1440) + '일 전';
  };
  const KNOWN_SYMBOLS = { '기아': 'KRX:000270', 'CJ CGV': 'KRX:079160', '스튜디오드래곤': 'KRX:253450', '레인보우로보틱스': 'KRX:277810', 'TIGER 미국S&P500': 'KRX:360750' };
  function priceStatusHtml() {
    const m = st.meta || {}, hs = (st.data.Holdings || []).filter(h => E.isActive(h.active));
    const withSym = hs.filter(h => String(h.symbol || '').trim()).length;
    const mins = m.pricesAt ? (Date.now() - new Date(m.pricesAt).getTime()) / 60000 : null;
    const stale = withSym > 0 && (mins == null || mins > 180);
    return '<div class="card"><div class="row-between"><h2>시세 자동 갱신</h2><span class="badge' + (stale || m.fails ? '' : ' plain') + '">' + (m.auto ? '자동 갱신 켜짐 · 1시간마다' : '자동 갱신 꺼짐') + '</span></div>' +
      '<div class="small">시세 코드를 입력한 종목 ' + withSym + '/' + hs.length + '개 · 마지막 성공 <b>' + ago(m.pricesAt) + '</b>' + (stale ? ' <b class="neg">(오래됨 — 자동 갱신 상태를 확인하세요)</b>' : '') + '</div>' +
      (m.lastErr ? '<div class="note warn" style="margin:8px 0"><div class="body">최근 문제: ' + esc(m.lastErr) + '</div></div>' : '') +
      (!m.auto ? '<div class="small muted" style="margin-top:6px">자동 갱신을 켜려면 구글 시트 메뉴 [자산관리 > ④ 시세 자동 갱신 켜기]를 실행하세요.</div>' : '') +
      '<div class="toolbar"><button class="primary" id="priceRefresh">지금 갱신</button><button id="fillSymbols">추천 시세 코드 채우기</button><span class="small muted" id="priceMsg"></span></div>' +
      '<div class="legend-note">시세 코드는 구글 파이낸스 형식입니다 (예: 기아 <code>KRX:000270</code>). 코드를 입력한 종목의 현재가는 갱신될 때마다 덮어써집니다. 무료 시세는 약 20분 지연될 수 있습니다.</div></div>';
  }
  function renderInvest() {
    main.innerHTML = priceStatusHtml() + '<div class="card"><h2>보유 종목 입력</h2><div class="small muted">매입단가·현재가는 원 단위입니다. 보유 사유(논지)를 적어두면 점검 항목에서 사라집니다.</div>' + editTable('Holdings', st.data.Holdings || []) + '</div>' +
      '<div class="card"><h2>점검</h2><div id="investReport">' + investReport() + '</div>' +
      '<div class="legend-note">손익은 입력한 현재가 기준입니다. 현재가는 시세 코드가 있으면 자동 갱신 값, 없으면 직접 입력한 값입니다.</div></div>';
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
  function inviteLink() {
    const u = localStorage.getItem('am_api') || '';
    return u ? location.origin + location.pathname + '#u=' + encodeURIComponent(u) : '';
  }
  function renderSettings() {
    const S = E.settings(st.data);
    const keys = Object.keys(E.DEFAULTS);
    main.innerHTML = '<div class="card"><h2>가정값 설정</h2><div class="tbl-wrap"><table class="set-table"><thead><tr><th>항목</th><th>값</th><th>단위</th></tr></thead><tbody>' +
      keys.map(k => '<tr data-k="' + k + '"><td>' + esc((SETTING_LABELS[k] || [k])[0]) + ' <span class="muted small">' + k + '</span></td><td><input' + (typeof E.DEFAULTS[k] === 'number' ? ' data-num="1" inputmode="decimal" value="' + esc(commaFmt(String(S[k]))) : ' value="' + esc(S[k])) + '"></td><td class="muted">' + esc((SETTING_LABELS[k] || ['', ''])[1]) + '</td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<div class="card"><h2>가족 폰에 연결하기</h2><p class="small muted">아래 링크를 와이프에게 보내 한 번 열게 하면, 그 폰에는 연결 주소가 저장되고 이후에는 보안코드만 입력하면 됩니다. 링크에는 연결 주소가 들어 있으니 카카오톡 같은 개인 채팅으로만 보내세요.</p>' +
      '<input id="inviteLink" readonly value="' + esc(inviteLink()) + '"><div class="toolbar"><button class="primary" id="copyInvite">링크 복사</button><span class="small muted" id="copyMsg"></span></div>' +
      '<p class="small muted">보안코드는 링크에 들어 있지 않습니다. 따로 알려주세요.</p></div>' +
      '<div class="card"><h2>보안</h2><p class="small muted">보안코드는 구글 시트 메뉴 [자산관리 > 보안코드 설정]에서 바꿉니다. 5회 틀리면 15분간 접속이 잠깁니다.</p></div>';
  }
  function renderGuide() {
    main.innerHTML = '<div class="card"><h2>시장·경제 데이터 연결 가이드 (다음 단계)</h2>' +
      '<p>목표: 금리·환율·지수·물가를 시트에 매일 저장하고, 그 값으로 추천에 반영하기.</p>' +
      '<details open><summary>1. 지금 바로 되는 것 — 구글시트 GOOGLEFINANCE</summary><p class="small">주가·지수·환율은 시트 함수로 무료 갱신됩니다. 예: <code>=GOOGLEFINANCE("KRX:000270","price")</code>, <code>=GOOGLEFINANCE("CURRENCY:USDKRW")</code>. 투자 탭의 "시세 코드"를 입력하면 1시간마다 자동으로 갱신됩니다 (시트 메뉴 ④로 켜기).</p></details>' +
      '<details><summary>2. 금리·물가 — 한국은행 ECOS, 미국 FRED (무료 API 키)</summary><p class="small">Apps Script의 UrlFetchApp로 하루 한 번 호출해 Market 탭에 저장합니다. 키는 Script Properties에만 보관해 사이트·git에 노출하지 않습니다.</p></details>' +
      '<details><summary>3. 뉴스·이슈 해석</summary><p class="small">자동 요약은 유료 LLM API가 필요합니다. 무료 대안: 주 1회 Market 탭 요약을 Claude에 붙여넣어 코멘트를 받고, 결론만 메모로 저장하세요. MCP 연결은 필수가 아닙니다(자동화를 원할 때 Google Drive/시트 커넥터를 검토).</p></details>' +
      '<details><summary>4. 이 사이트의 보안 구조</summary><p class="small">데이터는 구글 시트에만 있고, 이 페이지(코드)에는 개인정보가 없습니다. Apps Script는 보안코드를 확인한 뒤 6시간짜리 토큰을 주고, 토큰 없이는 데이터를 반환하지 않습니다. 웹 앱 URL과 보안코드는 가족 외에 공유하지 마세요.</p></details></div>';
  }

  /* ---------- 시나리오 (테슬라 · 자금 계획 · 집 매도) ---------- */
  function scnState() {
    if (!st.scn) {
      const S = E.settings(st.data);
      st.scn = { sub: 'plan', pct: 60, rate: 6, term: 60, toYm: '2027-04', target: S.house_target, deposit: S.after_deposit, rent: S.after_rent, rentDep: S.after_rent_deposit, sellYm: '' };
    }
    return st.scn;
  }
  const numIn = (id, label, val) => '<div><label class="f" for="' + id + '">' + label + '</label><input id="' + id + '" data-num="1" inputmode="decimal" value="' + esc(commaFmt(String(val))) + '"></div>';
  const readNum = id => num((($('#' + id) || {}).value || '').replace(/,/g, ''), 0);
  const dash = '<span class="muted">—</span>';
  const fmv = v => (v == null || isNaN(v) ? dash : fm(v));
  const sgn = v => (v == null || isNaN(v) ? dash : signed(v));

  function renderScn() {
    const sc = scnState();
    main.innerHTML = '<div class="sub"><button data-scn-sub="plan"' + (sc.sub === 'plan' ? ' class="on"' : '') + '>테슬라 · 자금 계획</button><button data-scn-sub="sell"' + (sc.sub === 'sell' ? ' class="on"' : '') + '>집 매도 시나리오</button></div><div id="scnBody"></div>';
    (sc.sub === 'sell' ? renderScnSell : renderScnPlan)();
  }

  function renderScnPlan() {
    const sc = scnState();
    const defs = [
      ['현금으로 구매', { tesla: 'buy', tesla_fin_pct: 0 }],
      ['구매 취소', { tesla: 'skip' }],
      ['할부 ' + sc.pct + '%', { tesla: 'buy', tesla_fin_pct: sc.pct, tesla_rate: sc.rate, tesla_term: sc.term }],
    ];
    const plans = defs.map(([label, o]) => ({ label, o, p: A.fundingPlan(st.data, o, sc.toYm) }));
    const [buy, skip, fin] = plans;
    const S = buy.p.sim.S;
    const carCost = -buy.p.rows.find(r => /자동차/.test(r.label)).val;
    const principal = (st.data.Events || []).filter(e => E.isActive(e.active) && String(e.category) === 'car' && num(e.amount, 0) < 0 && /잔금/.test(e.name)).reduce((q, e) => q - num(e.amount, 0), 0) * sc.pct / 100;
    const totalInterest = principal > 0 ? E.payment(principal, sc.rate / 1200, sc.term) * sc.term - principal : 0;
    const after = pl => { const t0 = pl.p.sim.ym.indexOf(sc.toYm); let m = Infinity, k = t0; for (let t = t0; t < Math.min(pl.p.sim.N, t0 + 12); t++) if (pl.p.sim.low[t] < m) { m = pl.p.sim.low[t]; k = t; } return { v: m, ym: pl.p.sim.ym[k] }; };
    const kp = (pl, strong) => '<div class="kpi"' + (strong ? ' style="border-color:var(--ink)"' : '') + '><div class="l">' + esc(pl.label) + '</div><div class="v">' + fm(pl.p.end) + '</div><div class="s">' + esc(sc.toYm) + ' 말 현금</div></div>';
    const rowsHtml = buy.p.rows.map((r, i) => '<tr' + (/자동차/.test(r.label) ? ' class="hl"' : '') + (r.strong ? ' class="strongrow"' : '') + '><td>' + esc(r.label) + '</td>' + plans.map(pl => '<td class="r">' + (r.strong ? '<b>' + fm(pl.p.rows[i].val) + '</b>' : sgn(pl.p.rows[i].val)) + '</td>').join('') + '</tr>').join('');
    const extra = (label, fn) => '<tr><td>' + label + '</td>' + plans.map(pl => '<td class="r">' + fn(pl) + '</td>').join('') + '</tr>';
    main.querySelector('#scnBody').innerHTML =
      '<div class="card"><h2>테슬라를 사면, 안 사면, 할부로 사면</h2><div class="small muted">집 구입 일정(계약금·중도금·잔금·세금·인테리어)을 모두 반영해 ' + esc(sc.toYm) + ' 말까지 남는 현금을 비교합니다. 남는 돈은 투자로 옮기지 않고 전부 현금으로 둔 계산입니다.</div>' +
      '<div class="ctl" style="margin-top:10px">' + numIn('scPct', '할부 비율(%)', sc.pct) + numIn('scRate', '할부 금리(%)', sc.rate) + numIn('scTerm', '할부 기간(개월)', sc.term) + '<div><label class="f" for="scTo">비교 기준월</label><input id="scTo" value="' + esc(sc.toYm) + '" placeholder="YYYY-MM"></div></div>' +
      '<div class="toolbar"><button class="primary" id="scnCalc">계산</button></div></div>' +
      '<div class="grid g3 keep3" style="margin-bottom:14px">' + kp(skip, true) + kp(fin) + kp(buy) + '</div>' +
      '<div class="card"><h2>한눈에 보기</h2><ul class="plain">' +
      '<li>테슬라를 <b>사지 않으면</b> ' + esc(sc.toYm) + ' 말 현금이 <b>' + fm(skip.p.end) + '</b> 남습니다. 현금으로 사면 ' + fm(buy.p.end) + ', 차이는 ' + fm(skip.p.end - buy.p.end) + '입니다 (차량 잔금·취득세 순지출 ' + fm(carCost) + ' + 계약금 카드 할부 등 ' + fm(skip.p.end - buy.p.end - carCost) + ').</li>' +
      '<li>할부 ' + sc.pct + '%(' + sc.rate + '%, ' + sc.term + '개월)로 사면 현금은 현금 구매보다 ' + fm(fin.p.end - buy.p.end) + ' 더 남지만, 매달 갚는 돈이 ' + fm(fin.p.payAfter - buy.p.payAfter) + ' 늘고 총 이자는 약 ' + fm(totalInterest) + '입니다.</li>' +
      '<li>입주 후 12개월 중 가장 빠듯한 월중 현금: 구매 ' + fm(after(buy).v) + '(' + after(buy).ym + ') · 할부 ' + fm(after(fin).v) + '(' + after(fin).ym + ') · 취소 ' + fm(after(skip).v) + '(' + after(skip).ym + ')</li>' +
      '<li>가장 빠듯한 달은 2년 전체로 보면 ' + buy.p.minYm + ' (' + fm(buy.p.minLow) + ')이며, 이 달은 테슬라 선택과 상관없이 집 계약금 때문에 생깁니다.</li>' +
      '</ul></div>' +
      '<div class="card"><h2>' + esc(sc.toYm) + '까지 자금 계획 (시작 현금 → 끝 현금)</h2><div class="tbl-wrap"><table class="cmp"><thead><tr><th></th>' + plans.map(pl => '<th class="r">' + esc(pl.label) + '</th>').join('') + '</tr></thead><tbody>' + rowsHtml +
      '<tr class="strongrow"><td><b>끝 현금</b></td>' + plans.map(pl => '<td class="r"><b>' + fm(pl.p.end) + '</b></td>').join('') + '</tr>' +
      extra('비상금 (별도 보관)', pl => fm(pl.p.reserve)) + extra('투자·연금 자산', pl => fm(pl.p.invest)) + extra('순자산', pl => fm(pl.p.nw)) +
      extra('다음 달 대출·할부 상환액', pl => fm(pl.p.payAfter)) +
      '</tbody></table></div>' +
      '<div class="legend-note">구매 취소는 계약금 500만원을 환불받고 카드 할부도 함께 취소되는 것으로 가정했습니다(실제 환불 조건 확인 필요). 할부 금리·기간은 임의 가정이며 견적을 받으면 바꿔 넣으세요. 대출 실행은 주택 구입 자금이며 차량 구입에는 쓰지 않았습니다.</div>' +
      '<div class="toolbar"><button data-apply="tesla:buy">현금 구매로 기본 계획에 반영</button><button data-apply="tesla:fin">할부로 기본 계획에 반영</button><button data-apply="tesla:skip">구매 취소로 기본 계획에 반영</button></div></div>';
  }

  function renderScnSell() {
    const sc = scnState();
    const over = { house_target: sc.target, after_deposit: sc.deposit, after_rent: sc.rent, after_rent_deposit: sc.rentDep };
    const sa = A.sellAnalysis(st.data, over);
    const S = sa.S;
    let ym = /^\d{4}-\d{2}$/.test(sc.sellYm) ? sc.sellYm : (sa.hit ? sa.hit.ym : sa.earliestYm);
    let ymNote = '';
    if (E.idxOf(ym) < sa.earliestIdx) { ym = sa.earliestYm; ymNote = '입력한 월이 실거주 2년 이전이라 가장 빠른 시점으로 바꿨습니다.'; }
    const cmp = A.afterSaleCompare(st.data, over, ym);
    const later = sa.hit ? sa.monthly.find(m => m.idx === sa.hit.idx + 24) : null;
    const yRows = sa.yearly.slice(0, 27).map(r => '<tr' + (r.price >= S.house_target ? ' class="hl"' : '') + '><td>' + r.ym + '</td><td class="r">' + r.age + '세</td><td class="r">' + fm(r.price) + '</td><td class="r">' + Math.round(r.price / S.house_target * 100) + '%</td><td class="r">' + fm(-r.tax) + '</td><td class="r">' + fm(-r.fee) + '</td><td class="r">' + fm(-r.repay) + '</td><td class="r"><b>' + fm(r.net) + '</b></td><td class="r">' + (r.annual * 100).toFixed(1) + '%</td></tr>').join('');
    const col = (fn) => cmp.map(c => '<td class="r">' + fn(c) + '</td>').join('');
    const hasSale = c => !!c.sale;
    main.querySelector('#scnBody').innerHTML =
      '<div class="card"><h2>집 매도 계획</h2><div class="small muted">목표 매도가를 정하면, 그 가격에 처음 도달하는 시점과 그때 손에 쥐는 돈, 매도 후 현금흐름을 계산합니다. 집값은 [설정]의 연평균 ' + S.house_mean + '% 가정으로 만든 가상의 등락 경로입니다.</div>' +
      '<div class="ctl" style="margin-top:10px">' + numIn('sTarget', '목표 매도가(만원)', sc.target) + '<div><label class="f" for="sYm">매도월 (비우면 자동)</label><input id="sYm" value="' + esc(sc.sellYm) + '" placeholder="YYYY-MM"></div>' +
      numIn('sDep', '매도 후 전세 보증금(만원)', sc.deposit) + numIn('sRent', '월세로 갈 경우 월세(만원)', sc.rent) + numIn('sRentDep', '월세 보증금(만원)', sc.rentDep) + '</div>' +
      '<div class="toolbar"><button class="primary" id="scnCalc">계산</button></div></div>' +
      '<div class="card"><h2>목표가 ' + fm(S.house_target) + ' 기준</h2>' +
      (sa.hit ? '<div class="big-num">' + sa.hit.ym + ' <span class="small muted">본인 ' + sa.hit.age + '세 · 집값 ' + fm(sa.hit.price) + '</span></div>' +
        '<div class="small" style="margin-top:6px">양도세 ' + fm(sa.hit.tax) + ' · 중개보수 ' + fm(sa.hit.fee) + ' · 대출 상환 ' + fm(sa.hit.repay) + ' → <b>손에 쥐는 돈 ' + fm(sa.hit.net) + '</b></div>' :
        '<div class="note warn"><div class="body">현재 가정(연평균 ' + S.house_mean + '%)으로는 50년 안에 목표가에 도달하지 못합니다. 목표가를 낮추거나 [시뮬레이션]에서 상승률 가정을 바꿔 보세요.</div></div>') +
      '<ul class="plain" style="margin-top:10px">' +
      '<li>가장 빠른 매도 가능 시점: <b>' + sa.earliestYm + '</b> (입주 ' + S.move_in_ym + ' 후 2년 실거주 충족). 토지거래허가 구역은 2년 실거주 의무가 있어 그 전에는 팔 수 없습니다.</li>' +
      '<li>1세대 1주택은 양도가 12억 이하면 양도세가 없고, 12억 초과분에만 과세됩니다. 보유·거주 기간이 길수록 장기보유특별공제가 커집니다(각 연 4%, 합산 최대 80%).</li>' +
      (later && sa.hit ? '<li>목표 도달 후 2년 더 보유하면: 양도세 ' + fm(sa.hit.tax) + ' → ' + fm(later.tax) + ', 손에 쥐는 돈 ' + fm(sa.hit.net) + ' → ' + fm(later.net) + ' (집값 ' + fm(later.price) + ')</li>' : '') +
      '<li>세금은 개략 추정입니다(필요경비는 취득세·중개·등기 ' + fm(S.house_basis_extra) + ' + 인정 공사비 ' + fm(S.house_capex) + ' 가정). 실제 매도 전에 세무사 확인이 필요합니다.</li></ul></div>' +
      '<div class="card"><h2>매도 시점별 손에 쥐는 돈 (매년 4월 기준)</h2><div class="tbl-wrap mini"><table><thead><tr><th>시점</th><th class="r">나이</th><th class="r">집값</th><th class="r">목표 대비</th><th class="r">양도세</th><th class="r">중개보수</th><th class="r">대출 상환</th><th class="r">손에 쥐는 돈</th><th class="r">연 환산 세후 수익률</th></tr></thead><tbody>' + yRows + '</tbody></table></div>' +
      '<div class="legend-note">강조된 줄은 목표가 이상인 해입니다. 연 환산 세후 수익률 = (집값 − 세금 − 중개보수) ÷ 총 취득비용(매입가+부대비용+공사비)을 보유 연수로 환산한 값(대출 이자·보유비는 제외)입니다.</div></div>' +
      '<div class="card"><h2>' + ym + ' 매도 후 현금흐름 시나리오</h2>' + (ymNote ? '<div class="small muted">' + ymNote + '</div>' : '') +
      '<div class="tbl-wrap"><table class="cmp"><thead><tr><th></th>' + cmp.map(c => '<th class="r">' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
      '<tr><td>집 매도가</td>' + col(c => hasSale(c) ? fm(c.sale.price) : dash) + '</tr>' +
      '<tr><td>양도세</td>' + col(c => hasSale(c) ? fm(-c.sale.tax) : dash) + '</tr>' +
      '<tr><td>중개보수</td>' + col(c => hasSale(c) ? fm(-c.sale.fee) : dash) + '</tr>' +
      '<tr><td>대출 상환</td>' + col(c => hasSale(c) ? fm(-c.sale.repay) : dash) + '</tr>' +
      '<tr class="strongrow"><td><b>손에 쥐는 돈</b></td>' + col(c => hasSale(c) ? '<b>' + fm(c.sale.net) + '</b>' : dash) + '</tr>' +
      '<tr><td>새 거주지 보증금</td>' + col(c => hasSale(c) ? fm(-c.sale.deposit) : dash) + '</tr>' +
      '<tr class="strongrow"><td><b>투자로 돌릴 수 있는 돈</b></td>' + col(c => hasSale(c) ? '<b>' + fm(c.sale.net - c.sale.deposit) + '</b>' : dash) + '</tr>' +
      '<tr><td>월 수입 (전 → 후)</td>' + col(c => fm(c.incBefore) + ' → ' + fm(c.incAfter)) + '</tr>' +
      '<tr><td>월 지출·대출·월세 (전 → 후)</td>' + col(c => fm(c.expBefore) + ' → ' + fm(c.expAfter)) + '</tr>' +
      '<tr class="strongrow"><td><b>월 잉여 (전 → 후)</b></td>' + col(c => '<b>' + fm(c.surBefore) + ' → ' + fm(c.surAfter) + '</b>') + '</tr>' +
      '<tr><td>매도 1년 뒤 순자산</td>' + col(c => fm(c.nw1)) + '</tr>' +
      '<tr><td>65세 순자산</td>' + col(c => fm(c.nw65)) + '</tr>' +
      '<tr><td>65세 금융자산 (부채 차감)</td>' + col(c => fm(c.fin65)) + '</tr>' +
      '<tr><td>금융자산 소진 나이</td>' + col(c => (c.depleteAge ? '<span class="neg">' + c.depleteAge + '세</span>' : '<span class="pos">소진 없음</span>')) + '</tr>' +
      '</tbody></table></div>' +
      '<div class="legend-note">매도 후에는 대출 상환과 재산세가 사라지고, 전세는 보증금이 묶이며 월세는 매달 나갑니다. 매도로 생긴 돈 중 보증금을 뺀 금액은 투자로 옮겨 연 ' + S.invest_return + '% 수익을 가정합니다. 집값 상승·세금·월세는 가정이므로 결과는 참고용입니다. 월 수입 변화에는 은퇴 시점의 영향도 섞여 있습니다.</div>' +
      '<div class="toolbar"><button data-apply="sell:jeonse:' + ym + '">전세 이주로 기본 계획에 반영</button><button data-apply="sell:rent:' + ym + '">월세 이주로 기본 계획에 반영</button><button class="ghost" data-apply="sell:clear">매도 계획 지우기</button></div></div>';
  }

  async function applyScenario(spec) {
    const sc = scnState(), p = spec.split(':');
    const put = (k, v) => saveSettingValue(k, v);
    try {
      if (p[0] === 'tesla') {
        if (p[1] === 'buy') { await put('tesla', 'buy'); await put('tesla_fin_pct', 0); }
        if (p[1] === 'skip') { await put('tesla', 'skip'); }
        if (p[1] === 'fin') { await put('tesla', 'buy'); await put('tesla_fin_pct', sc.pct); await put('tesla_rate', sc.rate); await put('tesla_term', sc.term); }
      } else if (p[0] === 'sell') {
        if (p[1] === 'clear') { await put('sell_ym', ''); }
        else { await put('sell_ym', p[2]); await put('sell_mode', p[1]); await put('house_target', sc.target); await put('after_deposit', sc.deposit); await put('after_rent', sc.rent); await put('after_rent_deposit', sc.rentDep); }
      }
      status('저장됨 ✓'); st.dirty = true; alert('기본 계획에 반영했습니다. 홈과 추천의 숫자가 이 시나리오로 바뀝니다.'); renderScn();
    } catch (err) { status('저장 실패'); alert(err.message); }
  }

  /* ---------- 라우팅 ---------- */
  const ICONS = {
    dash: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    ledger: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    advice: '<path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/><path d="M10 20.5h4"/>',
    invest: '<path d="M4 19V5M4 19h16"/><path d="M8 15l4-4 3 3 5-6"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  };
  const BOTTOM = [['dash', '홈'], ['ledger', '가계부'], ['advice', '추천'], ['invest', '투자'], ['more', '더보기']];
  const MORE = [['scn', '시나리오', '테슬라 구매 · 자금 계획 · 집 매도'], ['sim', '시뮬레이션', '은퇴 시기·집값 가정 바꿔보기'], ['input', '입력', '수입·지출·자산·대출·이벤트'], ['settings', '설정', '가정값, 보안'], ['guide', '가이드', '시장 데이터 연결, 보안 구조']];
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (st.tab === k ? ' class="on"' : '') + '>' + l + '</button>').join('');
    const inMore = ['more', 'scn', 'sim', 'input', 'settings', 'guide'].indexOf(st.tab) >= 0;
    $('#bottomnav').innerHTML = BOTTOM.map(([k, l]) => '<button data-tab="' + k + '"' + ((k === 'more' ? inMore : st.tab === k) ? ' class="on"' : '') + ' aria-label="' + l + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg>' + l + '</button>').join('');
  }
  function renderMore() {
    main.innerHTML = '<div class="card more-list"><h2>더보기</h2>' + MORE.map(([k, l, d]) => '<button data-tab="' + k + '"><span>' + l + '<br><small>' + d + '</small></span><span class="muted">›</span></button>').join('') +
      '<button id="moreSync"><span>시트에서 다시 불러오기</span><span class="muted">↻</span></button><button id="moreOut"><span>나가기</span><span class="muted">›</span></button></div>';
  }
  function render() {
    if (!st.data) return;
    Object.keys(st.charts).forEach(k => { try { st.charts[k].destroy(); } catch (e) { /* ignore */ } delete st.charts[k]; });
    ({ scn: renderScn, more: renderMore, dash: renderDash, ledger: renderLedger, advice: renderAdvice, invest: renderInvest, sim: renderSim, input: renderInput, settings: renderSettings, guide: renderGuide })[st.tab]();
    window.scrollTo(0, 0);
  }

  /* ---------- 이벤트 ---------- */
  ['#tabs', '#bottomnav'].forEach(sel => $(sel).addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; st.tab = b.dataset.tab; renderTabs(); render(); }));
  $('#loginBtn').addEventListener('click', doLogin);
  $('#apiChange').addEventListener('click', e => { e.preventDefault(); $('#apiBox').classList.remove('hidden'); $('#apiSaved').classList.add('hidden'); $('#apiUrl').focus(); });
  $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#logoutBtn').addEventListener('click', () => logout(false));
  $('#reloadBtn').addEventListener('click', () => loadAll().catch(e => alert(e.message)));

  main.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset && t.dataset.num && !t.closest('table.edit-table') && !t.closest('.set-table')) { liveFormat(t); return; }
    const table = t.closest('table.edit-table');
    if (table) {
      const tr = t.closest('tr[data-id]'); if (!tr) return;
      const tab = table.dataset.tab, row = (st.data[tab] || []).find(r => String(r.id) === tr.dataset.id);
      if (!row) return;
      row[t.dataset.k] = liveFormat(t); queueSave(tab, row);
      if (tab === 'Holdings') { const el = $('#investReport'); if (el) el.innerHTML = investReport(); }
      return;
    }
    const sTr = t.closest('table.set-table tr[data-k]');
    if (sTr) { const rawSet = liveFormat(t); clearTimeout(timers['set' + sTr.dataset.k]); status('수정됨…'); timers['set' + sTr.dataset.k] = setTimeout(() => saveSettingValue(sTr.dataset.k, rawSet).then(() => status('저장됨 ✓')).catch(err => { status('저장 실패'); alert(err.message); }), 700); }
  });

  main.addEventListener('click', async e => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-tab]'))) { st.tab = b.dataset.tab; renderTabs(); render(); return; }
    if (t.closest('#moreSync')) { loadAll().catch(err => alert(err.message)); return; }
    if (t.closest('#moreOut')) { logout(false); return; }
    if ((b = t.closest('[data-who]'))) {
      $('#lgWho').value = b.dataset.who; try { localStorage.setItem('am_who', b.dataset.who); } catch (err) { /* ignore */ }
      main.querySelectorAll('[data-who]').forEach(x => x.classList.toggle('on', x === b)); return;
    }
    if ((b = t.closest('[data-cat]'))) {
      $('#lgCat').value = b.dataset.cat; main.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === b)); return;
    }
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
    if ((b = t.closest('[data-scn-sub]'))) { scnState().sub = b.dataset.scnSub; renderScn(); return; }
    if ((b = t.closest('[data-apply]'))) { if (confirm('이 시나리오를 홈·추천의 기본 계획으로 반영할까요? (설정에 저장됩니다)')) applyScenario(b.dataset.apply); return; }
    if (t.closest('#scnCalc')) {
      const sc = scnState();
      if (sc.sub === 'plan') { sc.pct = Math.max(0, Math.min(100, readNum('scPct'))); sc.rate = readNum('scRate'); sc.term = Math.max(1, readNum('scTerm')); const to = ($('#scTo').value || '').trim(); if (/^\d{4}-\d{2}$/.test(to)) sc.toYm = to; }
      else { sc.target = readNum('sTarget'); sc.deposit = readNum('sDep'); sc.rent = readNum('sRent'); sc.rentDep = readNum('sRentDep'); sc.sellYm = ($('#sYm').value || '').trim(); }
      renderScn(); return;
    }
    if (t.closest('#priceRefresh')) {
      const btn = t.closest('#priceRefresh'); btn.disabled = true; $('#priceMsg').textContent = '갱신 중… (최대 20초)'; status('시세 갱신 중…');
      try {
        const r = await api('refresh');
        if (r.holdings) { st.data.Holdings = r.holdings; st.meta = r.meta || {}; st.dirty = true; }
        status(''); renderInvest();
        const res = r.result || {};
        $('#priceMsg').textContent = res.skipped ? res.message : (res.message || '완료') + ((res.failed || []).length ? ' · 조회 실패: ' + res.failed.join(', ') : '') + ((res.warnings || []).length ? ' · ' + res.warnings.join(' / ') : '');
      } catch (err) { status(''); btn.disabled = false; $('#priceMsg').textContent = '실패: ' + err.message; }
      return;
    }
    if (t.closest('#fillSymbols')) {
      let n = 0;
      (st.data.Holdings || []).forEach(h => { const k = String(h.name || '').trim(); if (!String(h.symbol || '').trim() && KNOWN_SYMBOLS[k]) { h.symbol = KNOWN_SYMBOLS[k]; queueSave('Holdings', h); n++; } });
      st.dirty = true; renderInvest();
      $('#priceMsg').textContent = n ? n + '개 종목에 코드를 채웠습니다. 코드가 맞는지 시트에서 =GOOGLEFINANCE("코드","price")로 한 번 확인하세요. 목록에 없는 종목은 직접 입력하세요.' : '채울 수 있는 종목이 없습니다. 종목명이 같을 때만 채웁니다.';
      return;
    }
    if (t.closest('#copyInvite')) {
      const inp = $('#inviteLink'); inp.select();
      let ok = false;
      try { await navigator.clipboard.writeText(inp.value); ok = true; } catch (err) { try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ } }
      $('#copyMsg').textContent = ok ? '복사했습니다' : '직접 길게 눌러 복사하세요';
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
  main.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'lgAmt') addLedger(); });
  main.addEventListener('change', e => {
    if (e.target.id === 'lgMonth') { st.ledgerMonth = e.target.value; renderLedger(); }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (st.data) render(); });

  /* ---------- 돌아왔을 때 조용히 새로고침 ---------- */
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !st.data || st.local || Date.now() - (st.loadedAt || 0) < 15 * 60 * 1000) return;
    try {
      const r = await api('all');
      st.data = r.data; st.meta = r.meta || {}; st.loadedAt = Date.now(); st.dirty = true;
      const typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (!typing && ['dash', 'invest', 'advice', 'scn'].indexOf(st.tab) >= 0) { const y = window.scrollY; render(); window.scrollTo(0, y); }
    } catch (e) { /* 다음 기회에 */ }
  });

  /* ---------- 시작 ---------- */
  try {
    const m = /[#&]u=([^&]+)/.exec(location.hash);
    if (m) {
      const u = decodeURIComponent(m[1]);
      if (/^https:\/\/script\.google\.com\//.test(u)) localStorage.setItem('am_api', u);
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { /* ignore */ }
  window.__AM = { st, start: data => { st.local = true; st.data = data; st.dirty = true; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); renderTabs(); render(); } };
  if (window.__TEST_DATA) { window.__AM.start(window.__TEST_DATA); return; }
  if (sessionStorage.getItem('am_tok') && localStorage.getItem('am_api')) loadAll().catch(() => showLogin(''));
  else showLogin('');
})();
