/* 화면 / 데이터 입출력. 금액 단위는 만원(가계부만 원).
 * 정보 구조: 보기(홈 · 가계부 · 현금 일정 · 분석) 와 관리(입력·설정) 를 분리한다. */
(function () {
  'use strict';
  const E = window.Engine, A = window.Advisor;
  const fm = A.fm, pct = A.pct, num = E.num;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const won = v => Math.round(num(v, 0)).toLocaleString('ko-KR');
  const main = $('#main');

  const st = {
    data: null, meta: {}, tab: 'home', subs: { analysis: 'advice', manage: 'assets' },
    over: {}, charts: {}, ledgerMonth: null, ltype: 'expense', dirty: true, local: false, openId: null,
  };

  /* ---------- 정보 구조 ---------- */
  const TABS = [['home', '홈'], ['ledger', '가계부'], ['flow', '현금 일정'], ['analysis', '분석'], ['manage', '관리']];
  const SUBNAV = {
    analysis: [['advice', '추천'], ['invest', '투자 점검'], ['future', '은퇴·미래'], ['tesla', '테슬라·자금'], ['sell', '집 매도']],
    manage: [['assets', '자산·현금'], ['holdings', '투자 종목'], ['income', '수입'], ['expenses', '고정 지출'], ['debts', '대출·할부'], ['events', '큰 일정'], ['recurring', '자동 기록'], ['settings', '가정값'], ['connect', '연결·보안']],
  };
  const ICONS = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    ledger: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    flow: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    analysis: '<path d="M4 19V5M4 19h16"/><path d="M8 15l4-4 3 3 5-6"/>',
    manage: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  };

  /* ---------- 입력 항목 정의 (초보자용 라벨) ---------- */
  const OPT = {
    owner: [['me', '나'], ['wife', '와이프'], ['joint', '공동']],
    kind: [['monthly', '매달'], ['yearly', '매년 (정한 달에)'], ['once', '한 번만']],
    yn: [['Y', '예'], ['N', '아니오']],
    active: [['Y', '계산에 포함'], ['N', '제외 (기록만)']],
    grow: [['', '금액 고정'], ['Y', '연봉 상승률만큼 증가'], ['I', '물가만큼 증가']],
    assetCat: [['cash', '입출금·예금 (바로 사용)'], ['deposit', '예금·적금 (만기 있음)'], ['emergency', '비상금 (손대지 않는 돈)'], ['irp', 'IRP·연금'], ['isa', 'ISA 현금'], ['invest', '기타 투자'], ['lease', '전세보증금 (내가 맡긴 돈)'], ['prepaid', '집 계약 선납금'], ['car', '자동차'], ['real_estate', '보유 부동산'], ['other', '기타']],
    evCat: [['house_pay', '집값 납부'], ['lease_return', '전세금 돌려받음'], ['tax', '세금'], ['fee', '수수료'], ['move', '이사·임시거주'], ['interior', '인테리어'], ['car', '자동차'], ['other', '기타']],
    ltype: [['expense', '지출'], ['income', '수입']],
    pay: [['카드', '카드'], ['현금', '현금'], ['이체', '이체']],
    account: [['일반', '일반 계좌'], ['ISA', 'ISA'], ['IRP', 'IRP'], ['연금저축', '연금저축'], ['기타', '기타']],
  };
  /** 가족 이름은 코드에 넣지 않고 시트 설정(name_me, name_wife)에서 읽는다 (저장소가 공개라서) */
  function names() { const S = st.data ? E.settings(st.data) : {}; return { me: S.name_me || '나', wife: S.name_wife || '배우자', child: S.name_child || '아이' }; }
  /** 내 나이 → 그때 아이 나이 (연 나이 기준) */
  function kidAge(myAge) { const S = E.settings(st.data); return myAge - (S.child_birth_year - S.birth_me); }
  const kidTag = myAge => ' (' + names().child + ' ' + kidAge(myAge) + '세)';
  function applyNames() { const n = names(); OPT.owner = [['me', n.me], ['wife', n.wife], ['joint', '공동']]; return n; }
  /** 화면 문구 속 '본인'·'와이프'를 실제 이름으로 바꾼다 */
  function nameTexts(root) {
    const n = names();
    if (n.me === '나' && n.wife === '배우자' && n.child === '아이') return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let x; while ((x = w.nextNode())) { if (/와이프|본인|아이 \d/.test(x.nodeValue)) x.nodeValue = x.nodeValue.replace(/와이프/g, n.wife).replace(/본인/g, n.me).replace(/아이 (\d)/g, n.child + ' $1'); }
  }
  const optLabel = (o, v) => { const f = (OPT[o] || []).find(x => x[0] === String(v == null ? '' : v)); return f ? f[1] : (v || ''); };

  const F = (k, label, type, extra) => Object.assign({ k, label, type }, extra || {});
  const FIELDS = {
    Income: [F('name', '항목 이름', 'text', { ph: '예: 나 월급' }), F('owner', '누구 수입', 'sel', { opt: 'owner' }), F('amount', '금액', 'num', { unit: '만원' }), F('kind', '얼마나 자주', 'sel', { opt: 'kind' }),
      F('months', '받는 달 (매년일 때)', 'text', { ph: '예: 1,2', hint: '매년 받는 수입만 입력' }), F('start', '시작 월', 'month'), F('end', '끝나는 월', 'month', { hint: '비우면 계속' }),
      F('grow', '매년 금액 변화', 'sel', { opt: 'grow' }), F('retire_stop', '은퇴하면 끊김', 'sel', { opt: 'yn' }), F('pause_from', '쉬는 기간 시작', 'month', { hint: '휴직 등' }), F('pause_to', '쉬는 기간 끝', 'month'),
      F('note', '메모', 'text'), F('active', '계산', 'sel', { opt: 'active' })],
    Expenses: [F('name', '항목 이름', 'text', { ph: '예: 유치원' }), F('category', '분류', 'text', { list: 'expCats', hint: '교육으로 두면 자녀 분석에 쓰입니다' }), F('amount', '금액', 'num', { unit: '만원' }), F('kind', '얼마나 자주', 'sel', { opt: 'kind' }),
      F('months', '나가는 달 (매년일 때)', 'text', { ph: '예: 7,9' }), F('start', '시작 월', 'month'), F('end', '끝나는 월', 'month', { hint: '비우면 계속' }),
      F('inflate', '물가만큼 오름', 'sel', { opt: 'yn' }), F('variable', '생활비 기준값', 'sel', { opt: 'yn', hint: '예 = 가계부 실제 지출로 바꿔 계산할 수 있는 생활비' }), F('note', '메모', 'text'), F('active', '계산', 'sel', { opt: 'active' })],
    Assets: [F('name', '이름', 'text', { ph: '예: 신한은행 입출금' }), F('category', '종류', 'sel', { opt: 'assetCat' }), F('owner', '누구 것', 'sel', { opt: 'owner' }), F('value', '금액', 'num', { unit: '만원' }),
      F('rate', '금리', 'num', { unit: '%', hint: '참고용' }), F('liquid', '바로 쓸 수 있음', 'sel', { opt: 'yn', hint: '아니오 = 비상금처럼 따로 둔 돈' }), F('note', '메모', 'text'), F('active', '계산', 'sel', { opt: 'active' })],
    Holdings: [F('name', '종목 이름', 'text'), F('account', '계좌', 'sel', { opt: 'account' }), F('owner', '누구 것', 'sel', { opt: 'owner' }), F('sector', '분야', 'text', { ph: '예: 미국 대형주 ETF' }),
      F('qty', '수량', 'num', { unit: '주' }), F('avg_price', '평균 매입가', 'num', { unit: '원' }), F('price', '현재가', 'num', { unit: '원', hint: '시세 코드가 있으면 자동 갱신' }),
      F('symbol', '시세 코드', 'text', { ph: 'KRX:000270' }), F('thesis', '보유하는 이유', 'text', { hint: '적어두면 점검 경고가 사라집니다' }), F('active', '계산', 'sel', { opt: 'active' })],
    Debts: [F('name', '이름', 'text', { ph: '예: 주택담보대출' }), F('principal', '빌린 금액', 'num', { unit: '만원' }), F('rate', '금리', 'num', { unit: '%' }), F('term', '갚는 기간', 'num', { unit: '개월' }),
      F('start', '실행 월', 'month', { hint: '다음 달부터 상환' }), F('disburse', '실행할 때 돈이 들어옴', 'sel', { opt: 'yn', hint: '대출은 예, 카드 할부는 아니오' }), F('note', '메모', 'text'), F('active', '계산', 'sel', { opt: 'active' })],
    Events: [F('date', '월', 'month'), F('name', '내용', 'text', { ph: '예: 주택 잔금' }), F('amount', '금액', 'num', { unit: '만원', hint: '나가는 돈은 앞에 − (예: -6200)' }), F('category', '종류', 'sel', { opt: 'evCat' }),
      F('certain', '확정된 일정', 'sel', { opt: 'yn' }), F('note', '메모', 'text'), F('active', '계산', 'sel', { opt: 'active' })],
    Recurring: [F('name', '이름', 'text', { ph: '예: 넷플릭스' }), F('type', '구분', 'sel', { opt: 'ltype' }), F('amount', '금액', 'num', { unit: '원' }), F('category', '가계부 분류', 'text', { list: 'ledCats' }),
      F('day', '매달 며칠', 'num', { unit: '일', hint: '그 날짜가 지나면 가계부에 자동으로 적힙니다 (31 = 말일)' }), F('who', '누구', 'sel', { opt: 'owner' }), F('pay', '결제', 'sel', { opt: 'pay' }),
      F('start', '시작 월', 'month', { hint: '비우면 이번 달부터' }), F('end', '끝나는 월', 'month', { hint: '비우면 계속' }), F('active', '사용', 'sel', { opt: 'active' })],
  };
  const DEFAULT_ROW = {
    Income: { owner: 'me', kind: 'monthly', grow: '', retire_stop: 'N', active: 'Y' },
    Expenses: { kind: 'monthly', inflate: 'Y', variable: 'N', active: 'Y' },
    Assets: { category: 'cash', owner: 'me', liquid: 'Y', active: 'Y' },
    Holdings: { account: '일반', owner: 'me', active: 'Y' },
    Debts: { disburse: 'N', active: 'Y' },
    Events: { category: 'other', certain: 'Y', active: 'Y' },
    Recurring: { type: 'expense', who: 'me', pay: '카드', day: 1, active: 'Y' },
  };
  const periodTxt = r => {
    const k = String(r.kind || 'monthly');
    const when = k === 'yearly' ? '매년 ' + (r.months || '?') + '월' : k === 'once' ? '한 번' : '매달';
    const range = (r.start ? r.start : '') + (r.end ? ' ~ ' + r.end : r.start ? ' ~' : '');
    return when + (range ? ' · ' + range : '');
  };
  const SUMMARY = {
    Income: r => [esc(r.name || '새 수입'), optLabel('owner', r.owner) + ' · ' + periodTxt(r), fm(num(r.amount, 0))],
    Expenses: r => [esc(r.name || '새 지출'), esc(r.category || '') + ' · ' + periodTxt(r), fm(num(r.amount, 0))],
    Assets: r => [esc(r.name || '새 자산'), optLabel('assetCat', r.category) + ' · ' + optLabel('owner', r.owner), fm(num(r.value, 0))],
    Holdings: r => [esc(r.name || '새 종목'), optLabel('account', r.account) + ' · ' + won(r.qty) + '주 · 현재가 ' + won(r.price) + '원' + (r.symbol ? ' · ' + esc(r.symbol) : ' · 시세 코드 없음'), fm(num(r.qty, 0) * num(r.price, 0) / 10000)],
    Debts: r => [esc(r.name || '새 대출'), num(r.rate, 0) + '% · ' + num(r.term, 0) + '개월 · 실행 ' + esc(r.start || '(월 없음)') + (E.isY(r.disburse) ? ' · 실행 때 입금' : ' · 입금 없음'), fm(num(r.principal, 0))],
    Recurring: r => [esc(r.name || '새 자동 기록'), '매달 ' + (num(r.day, 1) >= 31 ? '말일' : num(r.day, 1) + '일') + ' · ' + esc(r.category || '분류 없음') + ' · ' + optLabel('owner', r.who) + (r.last_ym ? ' · 마지막 ' + esc(r.last_ym) : ''), (r.type === 'income' ? '+' : '') + won(r.amount) + '원'],
    Events: r => [esc(r.name || '새 일정'), esc(r.date || '') + ' · ' + optLabel('evCat', r.category) + (r.certain === 'Y' ? '' : ' · 추정'), signedTxt(num(r.amount, 0))],
  };
  const MANAGE_INFO = {
    assets: ['Assets', '자산·현금', '은행 잔고, 비상금, 연금, 전세보증금처럼 "지금 가진 돈"을 적는 곳입니다. 주식·ETF는 [투자 종목]에 따로 적습니다.'],
    holdings: ['Holdings', '투자 종목', '주식·ETF를 종목별로 적습니다. 시세 코드를 넣으면 1시간마다 현재가가 자동으로 바뀝니다.'],
    income: ['Income', '수입', '월급, 인센티브, 아동수당처럼 들어오는 돈입니다. 매달·매년·한 번만 중에서 고르고, 휴직처럼 쉬는 기간도 넣을 수 있습니다.'],
    expenses: ['Expenses', '고정 지출', '관리비, 유치원, 보험처럼 정해진 지출과 "생활비 기준값"을 적습니다. 매일 쓰는 돈은 [가계부]에 적습니다.'],
    debts: ['Debts', '대출·할부', '주택담보대출, 카드 할부처럼 갚아야 하는 돈입니다. 원리금균등 상환으로 계산합니다.'],
    recurring: ['Recurring', '자동 기록', '구독료, 통신비, 관리비처럼 매달 같은 날 나가는 돈을 한 번만 등록하면, 그 날짜가 지난 뒤 앱을 열 때 가계부에 자동으로 적힙니다. 놓친 달도 최대 12개월까지 채웁니다.'],
    events: ['Events', '큰 일정', '계약금·잔금, 전세금 반환, 세금, 이사처럼 한 번에 크게 들어오거나 나가는 돈입니다. 나가는 돈은 금액 앞에 −를 붙입니다.'],
  };
  const CATS_VAR = ['식비', '외식', '생활용품', '대중교통', '차량유지비', '의료', '미용', '여가·문화', '여행', '쇼핑/의류', '경조사/선물', '기타'];
  /** 자녀 분류는 이름을 붙여 직관적으로 (예: OO 물건). 교육비는 고정비로 본다 */
  const kidCats = () => { const c = names().child; return [c + ' 물건', c + ' 병원', c + ' 놀이·체험']; };
  const fixedCats = () => A.FIXED_CATS.map(c => c === '교육/양육' ? names().child + ' 교육' : c);
  const allExpCats = () => CATS_VAR.concat(kidCats(), fixedCats());
  const isKidCat = c => { const n = names().child; return String(c || '').indexOf(n + ' ') === 0 || /^(아이|자녀|육아|교육\/양육)/.test(String(c || '')); };
  const CATS_INC = ['월급', '인센티브', '부수입', '환급', '기타수입'];
  const SETTING_GROUPS = [
    ['가족', [['name_me', '내 이름', ''], ['name_wife', '배우자 이름', ''], ['name_child', '자녀 이름', ''], ['birth_me', '본인 출생연도', ''], ['birth_wife', '와이프 출생연도', ''], ['child_birth_year', '자녀 출생연도', ''], ['retire_age_me', '본인 은퇴 나이', '세'], ['retire_age_wife', '와이프 은퇴 나이', '세']]],
    ['돈 관리 기준', [['liquidity_floor', '현금 경고선', '만원'], ['emergency_months', '비상금 목표', '개월치 생활비'], ['save_rate_target', '목표 저축률', '%'], ['variable_override', '실제 생활비 (0이면 계획값)', '만원/월']]],
    ['경제 가정', [['inflation', '물가상승률', '%'], ['salary_growth', '연봉 상승률', '%'], ['invest_return', '투자 기대수익률', '%'], ['cash_rate', '예금 금리', '%']]],
    ['집', [['house_purchase_ym', '잔금 월', 'YYYY-MM'], ['move_in_ym', '입주 월', 'YYYY-MM'], ['house_price', '매매가', '만원'], ['house_mean', '집값 연평균 상승률', '%'], ['house_vol', '집값 연 변동폭', '%'], ['house_target', '목표 매도가', '만원'], ['house_basis_extra', '취득 부대비용', '만원'], ['house_capex', '양도세 경비 인정 공사비', '만원'], ['sell_fee_pct', '매도 중개보수율', '%']]],
    ['시나리오 반영값', [['tesla', '테슬라', 'sel:buy=구매,skip=구매 안 함'], ['tesla_fin_pct', '테슬라 할부 비율', '%'], ['tesla_rate', '테슬라 할부 금리', '%'], ['tesla_term', '테슬라 할부 기간', '개월'], ['sell_ym', '집 매도 월 (비우면 안 팖)', 'YYYY-MM'], ['sell_mode', '매도 후 주거', 'sel:jeonse=전세,rent=월세'], ['after_deposit', '매도 후 전세 보증금', '만원'], ['after_rent', '매도 후 월세', '만원/월'], ['after_rent_deposit', '월세 보증금', '만원']]],
    ['고급', [['house_seed', '집값 변동 경로 번호', ''], ['buffer_months', '현금으로 둘 기간 (넘는 돈은 투자로)', '개월 지출'], ['sweep_pct', '넘는 현금의 투자 이동 비율', '%'], ['sim_start', '계산 시작 월', 'YYYY-MM'], ['years', '계산 기간', '년']]],
  ];

  /* ---------- 접속 토큰 (서버 유효 6시간, 기기에는 5시간 30분 보관) ---------- */
  function getToken() {
    try { const t = localStorage.getItem('am_tok'), exp = Number(localStorage.getItem('am_tok_exp') || 0); return t && exp > Date.now() ? t : null; } catch (e) { return null; }
  }
  function setToken(t) {
    try { if (t) { localStorage.setItem('am_tok', t); localStorage.setItem('am_tok_exp', String(Date.now() + 5.5 * 3600 * 1000)); } else { localStorage.removeItem('am_tok'); localStorage.removeItem('am_tok_exp'); } } catch (e) { /* ignore */ }
  }

  /* ---------- API ---------- */
  async function apiOnce(action, payload) {
    if (st.local) return { ok: true };
    const url = localStorage.getItem('am_api');
    const token = getToken();
    let res, j;
    try {
      res = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, payload || {})) });
    } catch (e) {
      throw new Error('서버에 연결하지 못했습니다. 웹 앱 주소와 배포 권한("모든 사용자")을 확인하세요.');
    }
    try { j = await res.json(); } catch (e) {
      throw new Error('응답이 올바르지 않습니다. 배포의 액세스 권한을 "모든 사용자"로 하고 새 버전으로 다시 배포했는지 확인하세요.');
    }
    if (!j.ok) {
      const err = new Error(j.error === 'AUTH' ? '접속이 만료되었습니다' : (j.error || '오류'));
      if (j.error === 'AUTH') { err.auth = true; logout(true); }
      throw err;
    }
    return j;
  }
  /** 저장·삭제는 일시적인 오류(모바일 네트워크 끊김, 서버 잠금 대기 등)면 최대 2번 더 시도 */
  async function api(action, payload) {
    const retry = action === 'save' || action === 'del';
    for (let i = 0; ; i++) {
      try { return await apiOnce(action, payload); } catch (e) {
        if (!retry || i >= 2 || e.auth || /unknown|탭이 없|보안코드/.test(e.message)) throw e;
        await new Promise(r => setTimeout(r, 900 * (i + 1)));
      }
    }
  }

  /* ---------- 저장 대기열: 저장에 실패한 가계부 내역을 기기에 보관했다가 다시 보낸다 ---------- */
  const PKEY = 'am_pending';
  const loadPending = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '[]'); } catch (e) { return []; } };
  const savePending = a => { try { if (a.length) localStorage.setItem(PKEY, JSON.stringify(a)); else localStorage.removeItem(PKEY); } catch (e) { /* ignore */ } };
  let flushing = false;
  async function flushPending() {
    const q = loadPending();
    if (!q.length || !st.data || flushing) return;
    flushing = true;
    const left = []; let done = 0, stop = false;
    for (const it of q) {
      if (stop) { left.push(it); continue; }
      try {
        await apiOnce('save', it);
        const list = (st.data[it.tab] = st.data[it.tab] || []);
        if (!list.some(r => String(r.id) === String(it.row.id))) list.push(it.row);
        done++;
      } catch (e) { left.push(it); if (e.auth || !st.data) stop = true; }
    }
    savePending(left); flushing = false;
    if (done) { st.dirty = true; toast('보관해 둔 ' + done + '건을 저장했습니다.' + (left.length ? ' (' + left.length + '건 남음)' : '')); if (st.data) render(); }
  }
  window.addEventListener('online', () => flushPending());
  const status = t => { $('#status').textContent = t; };
  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, 3500);
  }
  const timers = {};
  function queueSave(tab, row) {
    status('수정됨…');
    clearTimeout(timers[tab + row.id]);
    timers[tab + row.id] = setTimeout(async () => {
      try { await api('save', { tab, row }); status('저장됨'); st.dirty = true; } catch (e) { status('저장 실패'); toast('저장하지 못했습니다: ' + e.message, 'err'); }
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
    $('#pin').value = ''; (saved ? $('#pin') : $('#apiUrl')).focus();
  }
  function logout(silent) {
    try { if (!silent) api('logout'); } catch (e) { /* ignore */ }
    setToken(null); st.data = null;
    showLogin(silent ? '세션이 만료되었습니다. 다시 접속하세요.' : '');
  }
  async function doLogin() {
    const url = $('#apiUrl').value.trim(), pin = $('#pin').value;
    if (!/^https:\/\/script\.google\.com\//.test(url)) { $('#loginErr').textContent = 'Apps Script 웹 앱 URL(https://script.google.com/...)을 입력하세요.'; return; }
    if (!/\/exec(\?.*)?$/.test(url)) { $('#loginErr').textContent = '주소가 /exec 로 끝나야 합니다. (/dev 로 끝나는 주소는 안 됩니다.)'; return; }
    localStorage.setItem('am_api', url);
    $('#loginBtn').disabled = true; $('#loginErr').textContent = '확인 중…';
    try {
      $('#loginErr').textContent = '불러오는 중…';
      const r = await api('login', { pin });   // 로그인 응답에 데이터가 함께 온다 (왕복 1번)
      setToken(r.token);
      if (r.data) showData(r); else await loadAll();
      $('#loginErr').textContent = '';
    } catch (e) { $('#loginErr').textContent = e.message; }
    $('#loginBtn').disabled = false;
  }
  function showData(r) {
    st.data = r.data; st.meta = r.meta || {}; st.loadedAt = Date.now(); st.dirty = true; st.scen = null;
    loadPending().forEach(it => { const list = (st.data[it.tab] = st.data[it.tab] || []); if (!list.some(x => String(x.id) === String(it.row.id))) list.push(it.row); });
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    status(''); renderTabs(); render();
    setTimeout(() => { runRecurring().then(flushPending); }, 300);
  }
  async function loadAll(fresh) {
    status('불러오는 중…');
    showData(await api('all', fresh ? { fresh: true } : {}));
  }

  /* ---------- 계산 ---------- */
  function ensureCompute() {
    if (!st.dirty && st.sim) return;
    const sim = E.simulate(st.data);
    st.sim = sim; st.scen = null;
    // 사실 기반 현금표: 자동 투자 이동·예금 이자·투자 인출 같은 가정을 빼고 입력값만으로 계산
    st.fact = E.simulate(st.data, { sweep_pct: 0, cash_rate: 0, no_draw: 1 });
    st.adv = A.advise(st.data, sim, { now: new Date() });
    st.dirty = false;
  }
  /** 은퇴 시기별 비교(50년 계산 4번)는 무거워서 분석 화면을 열 때만 계산 */
  function ensureScenarios() {
    ensureCompute();
    if (st.scen) return;
    const S = st.sim.S;
    const ages = Array.from(new Set([45, 50, 55, S.retire_age_wife])).sort((a, b) => a - b);
    st.scen = ages.map(a => Object.assign(E.scenarioMetrics(st.data, { retire_age_wife: a }, '와이프 ' + a + '세 은퇴'), { isBase: a === S.retire_age_wife }));
    st.adv = A.advise(st.data, st.sim, { now: new Date(), scenarios: st.scen });
  }

  /* ---------- 차트 ---------- */
  const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function mkChart(id, labels, datasets, opts) {
    if (st.charts[id]) st.charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="muted small">차트를 불러오지 못했습니다. 아래 표를 참고하세요.</p>'; return; }
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
    const lab = idx.map(t => sim.ym[t].slice(0, 4) + ' (' + sim.ageMe[t] + '세·' + names().child + ' ' + kidAge(sim.ageMe[t]) + '세)');
    const fin = t => sim.cash[t] + sim.reserve[t] + sim.invest[t];
    mkChart(id, lab, [
      { label: '순자산', data: idx.map(t => sim.networth[t]), borderColor: cssv('--text'), borderWidth: 3 },
      { label: '집', data: idx.map(t => sim.house[t] + sim.re[t]), borderColor: cssv('--s1') },
      { label: '금융자산', data: idx.map(t => fin(t)), borderColor: cssv('--s3') },
      { label: '부채', data: idx.map(t => sim.debt[t]), borderColor: cssv('--s2') },
    ]);
  }
  function cashChart(id, sim, cur, n) {
    const S = sim.S;
    const ix = Array.from({ length: Math.min(n, sim.N - cur) }, (_, i) => cur + i);
    mkChart(id, ix.map(t => sim.ym[t]), [
      { label: '월말 현금', data: ix.map(t => sim.cash[t]), borderColor: cssv('--s1') },
      { label: '월중 저점(추정)', data: ix.map(t => sim.low[t]), borderColor: cssv('--s2'), borderDash: [5, 4] },
      { label: '경고선', data: ix.map(() => S.liquidity_floor), borderColor: cssv('--muted'), borderDash: [2, 3], borderWidth: 1 },
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
  const signed = v => '<span class="' + (v < 0 ? 'neg' : v > 0 ? 'pos' : '') + '">' + (v > 0 ? '+' : '') + fm(v) + '</span>';
  function signedTxt(v) { return signed(v); }
  const signedWon = v => '<span class="' + (v < 0 ? 'neg' : v > 0 ? 'pos' : '') + '">' + (v > 0 ? '+' : '') + won(v) + '</span>';
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ago = iso => {
    if (!iso) return '—';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(m)) return '—';
    return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.floor(m / 60) + '시간 전' : Math.floor(m / 1440) + '일 전';
  };
  const noteCard = c => '<div class="note ' + c.level + '"><div class="hd"><span class="badge">' + ({ risk: '주의', warn: '점검', ok: '양호', info: '참고' }[c.level]) + '</span><span class="badge plain">' + esc(c.tag) + '</span><span>' + esc(c.title) + '</span></div>' +
    (c.body ? '<div class="body">' + esc(c.body) + '</div>' : '') + (c.list.length ? '<ul>' + c.list.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '') + '</div>';
  const kpi = (l, v, s) => '<div class="kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  const pageHead = (title, desc, actions) => '<header class="page-head"><div><h1>' + title + '</h1>' + (desc ? '<p>' + desc + '</p>' : '') + '</div>' + (actions ? '<div class="ph-actions">' + actions + '</div>' : '') + '</header>';
  const subnav = tab => '<nav class="subnav" aria-label="세부 메뉴">' + SUBNAV[tab].map(([k, l]) => '<button data-subnav="' + k + '"' + (st.subs[tab] === k ? ' class="on" aria-current="page"' : '') + '>' + l + '</button>').join('') + '</nav>';
  const link = (label, tab, sub) => '<button class="linkbtn" data-tab="' + tab + '"' + (sub ? ' data-sub="' + sub + '"' : '') + '>' + label + ' →</button>';
  const dash = '<span class="muted">—</span>';
  const sgn = v => (v == null || isNaN(v) ? dash : signed(v));

  /* ---------- 관리 목록 (펼쳐서 수정) ---------- */
  function fieldHtml(f, v) {
    let input;
    if (f.type === 'sel') {
      const opts = OPT[f.opt].slice();
      if (v && !opts.some(o => o[0] === String(v))) opts.push([String(v), String(v)]);
      input = '<select data-k="' + f.k + '">' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    } else if (f.type === 'num') {
      input = '<input data-k="' + f.k + '" data-num="1" inputmode="decimal" value="' + esc(commaFmt(v == null ? '' : v)) + '">';
    } else {
      input = '<input data-k="' + f.k + '" value="' + esc(v) + '"' + (f.type === 'month' ? ' placeholder="YYYY-MM" inputmode="numeric"' : f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + (f.list ? ' list="' + f.list + '"' : '') + '>';
    }
    return '<label class="fld"><span class="fl">' + f.label + (f.unit ? ' <em>' + f.unit + '</em>' : '') + '</span>' + input + (f.hint ? '<small>' + f.hint + '</small>' : '') + '</label>';
  }
  function summaryHtml(tab, r) {
    const [title, meta, amt] = SUMMARY[tab](r);
    const off = !E.isActive(r.active);
    return '<span class="e-main"><span class="e-title">' + title + (off ? ' <span class="badge plain">제외</span>' : '') + '</span><span class="e-meta">' + meta + '</span></span><span class="e-amt">' + amt + '</span>';
  }
  function editList(tab, rows) {
    const list = rows.slice();
    if (tab === 'Events') list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const body = list.length ? list.map(r => '<details class="erow' + (E.isActive(r.active) ? '' : ' off') + '" data-id="' + esc(r.id) + '"' + (st.openId === r.id ? ' open' : '') + '><summary>' + summaryHtml(tab, r) + '</summary>' +
      '<div class="efields">' + FIELDS[tab].map(f => fieldHtml(f, r[f.k])).join('') + '</div>' +
      '<div class="erow-actions"><span class="small muted">입력하면 자동 저장됩니다</span><button class="ghost danger" data-del>삭제</button></div></details>').join('') :
      '<div class="empty">아직 입력한 항목이 없습니다. 아래 버튼으로 추가하세요.</div>';
    return '<datalist id="expCats">' + ['생활', '주거', '교육', '보험', '세금', '자동차', '통신', '고정'].map(c => '<option value="' + c + '">').join('') + '</datalist>' +
      '<datalist id="ledCats">' + allExpCats().concat(CATS_INC).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<div class="elist" data-etab="' + tab + '">' + body + '</div><div class="toolbar"><button class="primary" data-add="' + tab + '">+ 추가</button></div>';
  }

  /** 입력 데이터에서 계산이 어긋날 만한 부분을 찾아 알려준다 */
  function dataChecks() {
    const S = E.settings(st.data), out = [];
    const pIdx = E.idxOf(S.house_purchase_ym);
    const debts = (st.data.Debts || []).filter(d => E.isActive(d.active));
    debts.forEach(d => {
      const big = num(d.principal, 0) >= 10000;
      if (E.isY(d.disburse) && E.idxOf(d.start) == null) out.push('"' + (d.name || '대출') + '"의 실행 월이 비어 있거나 형식이 다릅니다. YYYY-MM 형식(예: 2027-03)으로 입력하세요.');
      if (big && !E.isY(d.disburse)) out.push('"' + (d.name || '대출') + '"의 "실행할 때 돈이 들어옴"이 아니오로 되어 있어 대출금 ' + fm(num(d.principal, 0)) + '이 들어오는 돈으로 잡히지 않습니다. 주택담보대출이면 예로 바꾸세요.');
      if (big && E.isY(d.disburse) && pIdx != null && E.idxOf(d.start) != null && E.idxOf(d.start) !== pIdx && /주택|담보|주담/.test(String(d.name))) out.push('"' + (d.name || '대출') + '"의 실행 월(' + d.start + ')이 집 잔금 월(' + S.house_purchase_ym + ')과 다릅니다. 잔금일에 실행되는 대출이면 같은 월로 맞추세요.');
    });
    if (pIdx != null && !debts.some(d => E.isY(d.disburse) && E.idxOf(d.start) === pIdx)) {
      const pay = (st.data.Events || []).filter(e => E.isActive(e.active) && String(e.category) === 'house_pay' && E.idxOf(e.date) === pIdx).reduce((q, e) => q - num(e.amount, 0), 0);
      if (pay > 0) out.push('집 잔금 월(' + S.house_purchase_ym + ')에 들어오는 대출이 없습니다. [관리 > 대출·할부]에서 주택담보대출의 실행 월과 "실행할 때 돈이 들어옴 = 예"를 확인하세요.');
    }
    return Array.from(new Set(out));
  }
  const checksHtml = () => { const c = dataChecks(); return c.length ? '<div class="note risk"><div class="hd"><span class="badge">확인 필요</span><span>입력값 점검</span></div><ul>' + c.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul><div class="toolbar">' + link('대출·할부 고치기', 'manage', 'debts') + '</div></div>' : ''; };
  /* ---------- 홈 ---------- */
  function budgetCard(sim, cur) {
    const led = st.data.Ledger || [];
    const bc = A.budgetCap(st.data, sim, led, new Date());
    const ms = A.monthStats(led, sim.ym[cur]);
    const cap = bc.cur.cap, spent = ms.variable, remain = cap - spent, ratio = cap > 0 ? spent / cap : 0;
    const now = new Date(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), daysLeft = Math.max(1, dim - now.getDate() + 1);
    const lvl = ratio > 1 ? 'risk' : ratio > 0.8 ? 'warn' : '';
    return '<section class="card"><div class="row-between"><h2>이번 달 생활비</h2><span class="small muted">상한 ' + fm(cap) + '</span></div>' +
      (ms.count ? '<div class="big-num">' + fm(spent) + ' <span class="small muted">상한의 ' + Math.round(ratio * 100) + '%</span></div>' +
        '<div class="bar ' + lvl + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, Math.round(ratio * 100)) + '"><i style="width:' + Math.min(100, ratio * 100) + '%"></i></div>' +
        '<p class="small">' + (remain >= 0 ? '남은 돈 <b>' + fm(remain) + '</b> · 하루 ' + fm(remain / daysLeft) + '씩 쓸 수 있어요' + (lvl === 'warn' ? ' (80% 넘음)' : '') : '<b class="neg">상한을 ' + fm(-remain) + ' 넘었어요</b>') + '</p>' :
        '<p class="small muted">이번 달 입력한 지출이 아직 없습니다.</p>') +
      (bc.cur.tighten > 0 ? '<p class="small muted">' + esc(bc.cur.tightenYm) + ' 큰 지출에 대비해 상한을 ' + fm(bc.cur.tighten) + ' 낮췄어요.</p>' : '') +
      '<div class="toolbar"><button class="primary" data-tab="ledger">지출 입력</button></div></section>';
  }
  function monthEvents(sim, k) {
    const ym = sim.ym[k], S = sim.S, parts = [];
    (st.data.Events || []).filter(e => E.isActive(e.active) && String(e.date) === ym && !(S.tesla === 'skip' && String(e.category) === 'car'))
      .forEach(e => parts.push({ name: e.name, amt: num(e.amount, 0), certain: e.certain === 'Y' }));
    if (sim.disb[k]) parts.push({ name: '대출 실행', amt: sim.disb[k], certain: true });
    return parts;
  }
  function riskStrip(sim, cur) {
    const S = sim.S, cells = [];
    let minV = Infinity, minK = cur;
    for (let k = cur; k < Math.min(sim.N, cur + 12); k++) {
      const v = sim.low[k]; if (v < minV) { minV = v; minK = k; }
      const c = v < S.liquidity_floor ? 'risk' : v < S.liquidity_floor * 2 ? 'warn' : 'ok';
      const m = monthSheet(sim, k);
      cells.push('<div class="rs-cell ' + c + '"><div class="m">' + sim.ym[k].slice(2).replace('-', '.') + (m.hasEvent ? ' · 큰 일정' : '') + '</div>' +
        '<div class="io"><span><i>들어옴</i>+' + fm(m.inTotal) + '</span><span><i>나감</i>−' + fm(m.outTotal) + '</span></div>' +
        '<div class="a"><i>월말</i>' + fm(m.end) + '</div>' +
        '<div class="t">' + (c === 'ok' ? '' : ({ risk: '주의', warn: '빠듯' }[c]) + ' · 저점 ' + fm(v)) + '</div></div>');
    }
    const msg = minV < S.liquidity_floor ? '<b>' + sim.ym[minK] + '에 큰 지출이 나가는 순간 현금이 약 ' + fm(minV) + '까지 내려가요.</b> 그 전 달 생활비를 줄이세요.' : '앞으로 12개월 동안 현금이 경고선(' + fm(S.liquidity_floor) + ') 아래로 내려가지 않습니다.';
    return { html: '<p class="small">' + msg + '</p><div class="rs">' + cells.join('') + '</div><p class="legend-note">칸마다 그 달에 들어올 돈 · 나갈 돈 · 월말에 남는 현금입니다. 저점은 큰 지출이 월급날보다 먼저 나갈 때의 최저 잔액(추정)입니다.</p>', minV, minK };
  }
  function renderHome() {
    ensureCompute();
    const { sim, adv } = st, S = sim.S;
    const cur = A.curIdx(sim, new Date());
    const fin = sim.cash[cur] + sim.reserve[cur] + sim.invest[cur];
    const prop = sim.house[cur] + sim.re[cur] + sim.prepaid[cur] + sim.lease[cur] + sim.car[cur] + sim.other[cur];
    const alerts = adv.cards.filter(c => (c.level === 'risk' || c.level === 'warn') && c.tag !== '유동성').slice(0, 2);
    const fact = st.fact;
    const rs = riskStrip(fact, cur);
    const upcoming = [];
    for (let k = cur; k < Math.min(fact.N, cur + 12) && upcoming.length < 3; k++) { const ev = monthEvents(fact, k); if (ev.length) upcoming.push({ k, ev }); }
    const nextHtml = upcoming.length ? upcoming.map(u => {
      const tot = u.ev.reduce((q, x) => q + x.amt, 0);
      const big = u.ev.slice().sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt)).slice(0, 3);
      return '<li><div class="row-between"><b>' + sim.ym[u.k] + '</b><span>' + signed(tot) + '</span></div><div class="small muted">' + big.map(x => esc(x.name) + ' ' + fm(x.amt)).join(' · ') + (u.ev.length > 3 ? ' 외 ' + (u.ev.length - 3) + '건' : '') + '</div></li>';
    }).join('') : '<li class="muted small">12개월 안에 예정된 큰 일정이 없습니다.</li>';
    const S0 = E.settings(st.data);
    const nameCard = !S0.name_me || !S0.name_wife || !S0.name_child ? '<section class="card"><h2>가족 이름 설정</h2><p class="small muted">화면에 "나·배우자" 대신 이름으로 보이게 합니다. 이름은 구글 시트에만 저장됩니다.</p><div class="form-row"><div><label class="f" for="nmMe">내 이름</label><input id="nmMe" value="' + esc(S0.name_me) + '"></div><div><label class="f" for="nmWife">배우자 이름</label><input id="nmWife" value="' + esc(S0.name_wife) + '"></div><div><label class="f" for="nmKid">자녀 이름</label><input id="nmKid" value="' + esc(S0.name_child) + '"></div><div><button class="primary wide" id="saveNames">저장</button></div></div></section>' : '';
    main.innerHTML = checksHtml() + nameCard +
      '<section class="card hero"><div class="l">우리집 순자산 · ' + sim.ym[cur] + ' 말 예상</div><div class="v">' + fm(sim.networth[cur]) + '</div>' +
      '<div class="hero-split"><div><span>금융자산</span><b>' + fm(fin) + '</b></div><div><span>집·보증금·차</span><b>' + fm(prop) + '</b></div><div><span>부채</span><b>−' + fm(sim.debt[cur]) + '</b></div></div></section>' +
      '<div class="grid g2">' + budgetCard(fact, cur) +
      '<section class="card"><div class="row-between"><h2>다가오는 큰 일정</h2>' + link('전체 일정', 'flow') + '</div><ul class="timeline">' + nextHtml + '</ul></section></div>' +
      '<section class="card"><div class="row-between"><h2>향후 12개월 현금</h2>' + link('월별 수입·지출 보기', 'flow') + '</div>' + rs.html + '</section>' +
      (alerts.length ? '<section class="card"><div class="row-between"><h2>확인할 것</h2>' + link('추천 전체', 'analysis', 'advice') + '</div>' + alerts.map(c => '<div class="note ' + c.level + '"><div class="hd"><span class="badge">' + ({ risk: '주의', warn: '점검', ok: '양호', info: '참고' }[c.level]) + '</span><span>' + esc(c.title) + '</span></div>' + (c.body ? '<div class="body">' + esc(c.body) + '</div>' : '') + '</div>').join('') + '</section>' : '');
  }

  /* ---------- 현금 일정 ---------- */
  /** 한 달의 들어오는 돈 / 나가는 돈 장부 (엔진 결과와 합계가 맞도록 차이는 '기타'로 맞춤) */
  function monthSheet(sim, k) {
    const S = sim.S, idx = sim.start + k;
    const ins = [], outs = [];
    (st.data.Income || []).forEach(r => { const a = E.incomeAt(r, idx, S, k); if (a > 0.005) ins.push([r.name || '수입', a]); });
    const varRows = (st.data.Expenses || []).filter(r => E.isActive(r.active) && E.isY(r.variable) && String(r.kind || 'monthly') === 'monthly');
    const varBase = varRows.reduce((q, r) => q + num(r.amount, 0), 0);
    const varScale = S.variable_override > 0 && varBase > 0 ? S.variable_override / varBase : 1;
    let expSum = 0;
    (st.data.Expenses || []).forEach(r => { const a = E.expenseAt(r, idx, S, k, varScale); if (a > 0.005) { outs.push([r.name || '지출', a]); expSum += a; } });
    const expEngine = sim.expFixed[k] + sim.expVar[k];
    if (Math.abs(expEngine - expSum) > 0.5) outs.push(['기타 지출(월세 등)', expEngine - expSum]);
    if (sim.debtPay[k] > 0.005) outs.push(['대출·할부 상환', sim.debtPay[k]]);
    let hasEvent = false;
    monthEvents(sim, k).forEach(x => { hasEvent = true; if (x.amt >= 0) ins.push([x.name, x.amt, x.certain ? '' : '추정']); else outs.push([x.name, -x.amt, x.certain ? '' : '추정']); });
    if (sim.interest[k] > 0.5) ins.push(['예금 이자', sim.interest[k]]);
    if (sim.drawn[k] > 0.5) ins.push(['투자·비상금에서 꺼냄', sim.drawn[k]]);
    if (sim.sweep[k] > 0.5) outs.push(['남는 돈 투자로 옮김', sim.sweep[k]]);
    const start = k === 0 ? sim.open.cash : sim.cash[k - 1];
    let inTotal = ins.reduce((q, x) => q + x[1], 0), outTotal = outs.reduce((q, x) => q + x[1], 0);
    const diff = sim.cash[k] - (start + inTotal - outTotal);
    if (Math.abs(diff) > 0.5) { if (diff > 0) { ins.push(['기타 들어온 돈(집 매도 등)', diff]); inTotal += diff; } else { outs.push(['기타 나간 돈', -diff]); outTotal -= diff; } }
    ins.sort((a, b) => b[1] - a[1]); outs.sort((a, b) => b[1] - a[1]);
    return { ym: sim.ym[k], ins, outs, inTotal, outTotal, start, end: sim.cash[k], low: sim.low[k], lowRisk: sim.low[k] < S.liquidity_floor, hasEvent };
  }
  function renderFlow() {
    ensureCompute();
    const sim = st.fact, S = sim.S;
    const cur = A.curIdx(sim, new Date());
    const rs = riskStrip(sim, cur);
    const months = [];
    for (let k = cur; k < Math.min(sim.N, cur + 12); k++) months.push(monthSheet(sim, k));
    const sheetHtml = months.map((m, i) => {
      const line = ([l, v, note]) => '<li><span>' + esc(l) + (note ? ' <em>' + note + '</em>' : '') + '</span><b>' + fm(v) + '</b></li>';
      const big = m.hasEvent;
      return '<details class="msheet' + (m.lowRisk ? ' risk' : '') + '"' + (big || i === 0 ? ' open' : '') + '><summary>' +
        '<span class="ms-m"><b>' + m.ym + '</b>' + (big ? ' <span class="badge plain">큰 일정</span>' : '') + '</span>' +
        '<span class="ms-n"><span class="pos">+' + fm(m.inTotal) + '</span><span class="neg">−' + fm(m.outTotal) + '</span></span>' +
        '<span class="ms-e"><small>월말 현금</small><b' + (m.end < 0 ? ' class="neg"' : '') + '>' + fm(m.end) + '</b></span></summary>' +
        '<div class="tacct"><div class="tcol in"><h4>들어오는 돈</h4><ul>' + (m.ins.length ? m.ins.map(line).join('') : '<li class="muted"><span>없음</span><b>0</b></li>') + '</ul><div class="ttotal"><span>합계</span><b class="pos">+' + fm(m.inTotal) + '</b></div></div>' +
        '<div class="tcol out"><h4>나가는 돈</h4><ul>' + (m.outs.length ? m.outs.map(line).join('') : '<li class="muted"><span>없음</span><b>0</b></li>') + '</ul><div class="ttotal"><span>합계</span><b class="neg">−' + fm(m.outTotal) + '</b></div></div></div>' +
        '<div class="tflow"><span>월초 현금 <b>' + fm(m.start) + '</b></span><span>' + (m.inTotal - m.outTotal >= 0 ? '+' : '−') + ' 차액 <b>' + fm(Math.abs(m.inTotal - m.outTotal)) + '</b></span><span>= 월말 현금 <b>' + fm(m.end) + '</b></span>' +
        '<span class="' + (m.lowRisk ? 'neg' : 'muted') + '">월중 저점 ' + fm(m.low) + (m.lowRisk ? ' (경고선 아래)' : '') + '</span>' + (m.end < 0 ? '<span class="neg"><b>현금이 ' + fm(-m.end) + ' 모자랍니다. 대출·비상금 등 메울 방법이 필요합니다.</b></span>' : '') + '</div></details>';
    }).join('');
    const evs = (st.data.Events || []).filter(e => E.isActive(e.active) && String(e.date) >= sim.ym[cur] && !(S.tesla === 'skip' && String(e.category) === 'car')).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 30);
    let prevYm = '';
    const evRows = evs.map(e => {
      const t = sim.ym.indexOf(e.date), eff = A.eventNwEffect(e), first = e.date !== prevYm; prevYm = e.date;
      return '<tr><td>' + (first ? esc(e.date) : '') + '</td><td>' + esc(e.name) + (e.certain === 'Y' ? '' : ' <span class="badge plain">추정</span>') + '</td><td class="r">' + signed(num(e.amount, 0)) + '</td><td class="r">' + (eff === 0 ? '<span class="muted">자산 전환</span>' : signed(eff)) + '</td><td class="r">' + (first && t > 0 ? signed(sim.networth[t] - sim.networth[t - 1]) : '') + '</td><td class="r">' + (first && t >= 0 ? '<b>' + fm(sim.networth[t]) + '</b>' : '') + '</td></tr>';
    }).join('');
    main.innerHTML = pageHead('현금 일정', '앞으로 12개월 동안 들어오고 나가는 돈과 큰 일정을 월별로 봅니다. 일정은 [관리 > 큰 일정]에서 고칩니다.', link('큰 일정 고치기', 'manage', 'events')) + checksHtml() +
      '<section class="card"><h2>현금이 가장 빠듯한 달</h2>' + rs.html + '</section>' +
      '<section class="card"><div class="row-between"><h2>월별 들어오는 돈 · 나가는 돈</h2><span class="small muted">만원</span></div>' + sheetHtml +
      '<p class="legend-note">입력한 수입·지출·대출·큰 일정만으로 계산한 실제 현금 흐름입니다. 남는 돈 자동 투자, 예금 이자 같은 가정은 넣지 않았습니다. 월초 현금 + 들어오는 돈 − 나가는 돈 = 월말 현금입니다. 큰 일정이 있는 달은 펼쳐 두었습니다. 월중 저점은 큰 지출이 월급날(25일)보다 먼저 나간다고 보고 추정한 값입니다.</p></section>' +
      '<section class="card"><h2>현금 흐름 그래프 (36개월)</h2><div class="chart-box"><canvas id="cashChart" role="img" aria-label="월별 현금 잔액 추이"></canvas></div></section>' +
      '<section class="card"><h2>큰 일정과 순자산 변화</h2><div class="tbl-wrap mini"><table><thead><tr><th>월</th><th>내용</th><th class="r">현금</th><th class="r">순자산 영향</th><th class="r">그 달 순자산 변화</th><th class="r">월말 순자산</th></tr></thead><tbody>' + (evRows || '<tr><td colspan="6" class="muted">예정된 일정이 없습니다.</td></tr>') + '</tbody></table></div>' +
      '<p class="legend-note">집값 납부·전세 반환·차량 구입은 현금이 자산으로 바뀌는 것이라 순자산이 줄지 않습니다. 세금·수수료·이사·인테리어는 비용입니다. 순자산 변화에는 그 달의 월급·생활비·투자 수익·집값 변동도 들어 있습니다.</p></section>';
    cashChart('cashChart', sim, cur, 36);
  }

  /* ---------- 가계부 ---------- */
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  function renderLedger() {
    ensureCompute();
    const { sim } = st;
    const led = st.data.Ledger || [];
    const curYm = sim.ym[A.curIdx(sim, new Date())];
    const months = A.ledgerMonths(led);
    if (months.indexOf(curYm) < 0) months.push(curYm);
    months.sort();
    if (!st.ledgerMonth || months.indexOf(st.ledgerMonth) < 0) st.ledgerMonth = curYm;
    const ym = st.ledgerMonth;
    const bc = A.budgetCap(st.data, sim, led, new Date());
    const ms = A.monthStats(led, ym);
    const isCur = ym === curYm;
    const capNow = bc.cur.cap, ratio = capNow > 0 ? ms.variable / capNow : 0;
    const lvl = ratio > 1 ? 'risk' : ratio > 0.8 ? 'warn' : '';
    const who = (() => { try { return localStorage.getItem('am_who') || 'me'; } catch (e) { return 'me'; } })();
    const cats = st.ltype === 'income' ? CATS_INC : CATS_VAR;
    const mrows = led.filter(r => String(r.date).slice(0, 7) === ym);
    const incTotal = mrows.filter(r => r.type === 'income').reduce((q, r) => q + num(r.amount, 0), 0);
    const expTotal = mrows.filter(r => r.type !== 'income').reduce((q, r) => q + num(r.amount, 0), 0);
    const kidRows = mrows.filter(r => r.type !== 'income' && isKidCat(r.category));
    const kidTotal = kidRows.reduce((q, r) => q + num(r.amount, 0), 0);
    const kidBy = {}; kidRows.forEach(r => { kidBy[r.category] = (kidBy[r.category] || 0) + num(r.amount, 0); });

    // 일별 표
    const [yy, mm] = ym.split('-').map(Number);
    const now = new Date();
    const lastDay = new Date(yy, mm, 0).getDate();
    const upto = isCur ? now.getDate() : (ym > curYm ? 0 : lastDay);
    const byDay = {};
    mrows.forEach(r => { const d = Number(String(r.date).slice(8, 10)); (byDay[d] = byDay[d] || []).push(r); });
    let cum = 0;
    const dayList = [];
    for (let d = 1; d <= Math.max(upto, ...Object.keys(byDay).map(Number), 0); d++) {
      const items = byDay[d] || [];
      const inc = items.filter(r => r.type === 'income').reduce((q, r) => q + num(r.amount, 0), 0);
      const exp = items.filter(r => r.type !== 'income').reduce((q, r) => q + num(r.amount, 0), 0);
      cum += exp;
      dayList.push({ d, items, inc, exp, cum, wd: new Date(yy, mm - 1, d).getDay() });
    }
    dayList.reverse();
    const dayHtml = dayList.map(x => {
      const head = '<span class="dd"><b>' + x.d + '일</b> <span class="muted">' + WD[x.wd] + '</span></span><span class="r">' + (x.inc ? '<span class="pos">+' + won(x.inc) + '</span>' : '<span class="muted">0</span>') + '</span><span class="r">' + (x.exp ? won(x.exp) : '<span class="muted">0</span>') + '</span><span class="r muted">' + won(x.cum) + '</span>';
      if (!x.items.length) return '<div class="day empty-day">' + head + '</div>';
      const open = x.items.some(r => String(r.id) === st.editLid);
      return '<details class="day"' + (open ? ' open' : '') + '><summary>' + head + '</summary><ul class="day-items">' + x.items.map(r => String(r.id) === st.editLid ? ledgerEditForm(r) :
        '<li data-lid="' + esc(r.id) + '"><span><b>' + esc(r.category) + '</b>' + (/^rec_/.test(r.id) ? ' <span class="badge plain">자동</span>' : '') + ' <span class="muted">' + (r.who === 'wife' ? names().wife : names().me) + ' · ' + esc(r.pay || '') + (r.memo ? ' · ' + esc(r.memo) : '') + '</span></span><span class="r">' + (r.type === 'income' ? '<span class="pos">+' + won(r.amount) + '</span>' : won(r.amount)) + '</span><span class="li-act"><button class="ghost sm" data-ledit>수정</button><button class="ghost danger sm" data-ldel aria-label="삭제">삭제</button></span></li>').join('') + '</ul></details>';
    }).join('');

    const pend = loadPending().length;
    main.innerHTML = pageHead('가계부', '오늘 쓴 돈을 바로 적으세요. 나와 와이프가 함께 입력하고, 이번 달 생활비 상한과 비교합니다.') +
      (pend ? '<div class="note warn"><div class="hd"><span class="badge">저장 대기</span><span>' + pend + '건이 아직 시트에 저장되지 않았습니다</span></div><div class="body">이 기기에 안전하게 보관 중이며, 연결되면 자동으로 저장합니다.</div><div class="toolbar"><button class="primary" id="retryPending">지금 다시 저장</button></div></div>' : '') +
      '<section class="card qe"><div class="row-between"><div class="seg" role="group" aria-label="구분">' + [['expense', '지출'], ['income', '수입']].map(([v, l]) => '<button type="button" data-ltype="' + v + '"' + (st.ltype === v ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div>' +
      '<div class="seg" role="group" aria-label="입력자">' + [['me', names().me], ['wife', names().wife]].map(([w, l]) => '<button type="button" data-who="' + w + '"' + (who === w ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div></div>' +
      '<input type="hidden" id="lgWho" value="' + who + '"><input type="hidden" id="lgType" value="' + st.ltype + '">' +
      '<label class="qe-label" for="lgAmt">금액 (원)</label><input id="lgAmt" class="qe-amt" data-num="1" inputmode="numeric" placeholder="0">' +
      (st.ltype === 'income' ? '<div class="chips" role="group" aria-label="분류">' + cats.map(c => '<button type="button" class="chip" data-cat="' + c + '">' + c + '</button>').join('') + '</div>' :
        '<div class="chip-label">생활비</div><div class="chips" role="group" aria-label="생활비 분류">' + CATS_VAR.map(c => '<button type="button" class="chip" data-cat="' + c + '">' + c + '</button>').join('') + '</div>' +
        '<div class="chip-label">' + esc(names().child) + '에게 쓴 돈</div><div class="chips" role="group" aria-label="자녀 분류">' + kidCats().map(c => '<button type="button" class="chip kid" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
        '<div class="chip-label">고정비 <span class="muted">(생활비 상한에서 빠짐)</span></div><div class="chips" role="group" aria-label="고정비 분류">' + fixedCats().map(c => '<button type="button" class="chip fixed" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>') +
      '<div class="form-row">' +
      '<div><label class="f" for="lgCat">분류</label><input id="lgCat" list="catList" placeholder="' + (st.ltype === 'income' ? '월급' : '식비') + '"><datalist id="catList">' + (st.ltype === 'income' ? CATS_INC : allExpCats()).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
      '<div><label class="f" for="lgDate">날짜</label><input type="date" id="lgDate" value="' + todayStr() + '"></div>' +
      '<div><label class="f" for="lgPay">결제</label><select id="lgPay"><option>카드</option><option>현금</option><option>이체</option></select></div>' +
      '<div class="span2"><label class="f" for="lgMemo">메모</label><input id="lgMemo" placeholder="선택"></div>' +
      '<div class="span-all"><button class="primary wide" id="lgAdd">' + (st.ltype === 'income' ? '수입 추가' : '지출 추가') + '</button></div></div>' +
      '</section>' + pasteHtml() +

      '<section class="card"><div class="row-between"><h2>' + yy + '년 ' + mm + '월</h2><select id="lgMonth" class="auto">' + months.map(m => '<option' + (m === ym ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></div>' +
      '<div class="sum3"><div><span>수입</span><b class="pos">' + won(incTotal) + '</b></div><div><span>지출</span><b>' + won(expTotal) + '</b></div><div><span>남은 돈</span><b class="' + (incTotal - expTotal < 0 ? 'neg' : '') + '">' + won(incTotal - expTotal) + '</b></div></div>' +
      '<p class="small muted">원 단위 · 지출 중 생활비(변동) ' + won(ms.variable * 10000) + ' / 고정 ' + won(ms.fixed * 10000) + '</p>' +
      (kidTotal ? '<p class="small">' + esc(names().child) + '에게 쓴 돈 <b>' + won(kidTotal) + '원</b> <span class="muted">(' + Object.keys(kidBy).map(k => esc(k) + ' ' + won(kidBy[k])).join(' · ') + ')</span></p>' : '') +
      (isCur ? '<div class="small">생활비 상한 ' + fm(capNow) + ' 중 ' + Math.round(ratio * 100) + '% 사용' + (lvl === 'risk' ? ' — 초과' : lvl === 'warn' ? ' — 80% 넘음' : '') + '</div><div class="bar ' + lvl + '"><i style="width:' + Math.min(100, ratio * 100) + '%"></i></div>' : '') +
      '<h3 class="mt">일별 내역</h3>' +
      (dayList.length ? '<div class="daytable"><div class="day head"><span>날짜</span><span class="r">수입</span><span class="r">지출</span><span class="r">누적 지출</span></div>' + dayHtml +
        '<div class="day total"><span><b>합계</b></span><span class="r pos"><b>' + won(incTotal) + '</b></span><span class="r"><b>' + won(expTotal) + '</b></span><span></span></div></div><p class="legend-note">날짜를 누르면 그날 내역이 펼쳐집니다.</p>' :
        '<div class="empty">이 달은 아직 내역이 없습니다.</div>') + '</section>' +

      '<section class="card"><h2>' + esc(bc.next.ym) + ' 생활비 권장 상한: ' + fm(bc.next.cap) + '</h2>' +
      (bc.next.tighten > 0 ? '<div class="note warn"><div class="body">' + esc(bc.next.tightenYm) + '의 큰 지출로 현금이 경고선 아래로 내려갑니다. 그때까지 매달 ' + fm(bc.next.tighten) + '씩 더 아끼도록 상한에서 뺐습니다.</div></div>' : '') +
      '<p class="small muted">= 수입 ' + fm(bc.next.income) + ' − 고정지출 ' + fm(bc.next.fixed) + ' − 대출·할부 ' + fm(bc.next.debt) + ' − 목표 저축 ' + fm(bc.next.save) + (bc.next.tighten > 0 ? ' − 큰 지출 대비 ' + fm(bc.next.tighten) : '') + '</p>' +
      (bc.past && bc.past.length && bc.catRows.length ? '<div class="tbl-wrap"><table><thead><tr><th>분류</th><th class="r">이번 달</th><th class="r">지난달</th><th class="r">3개월 평균</th><th class="r">다음 달 권장</th></tr></thead><tbody>' +
        bc.catRows.sort((a, b) => b.avg - a.avg).map(r => '<tr><td>' + esc(r.cat) + '</td><td class="r">' + fm(r.thisMonth) + '</td><td class="r">' + fm(r.last) + '</td><td class="r">' + fm(r.avg) + '</td><td class="r"><b>' + fm(r.rec) + '</b></td></tr>').join('') + '</tbody></table></div>' :
        '<p class="small muted">한 달 이상 입력하면 분류별 권장 금액이 나옵니다.</p>') +
      (bc.avgVar != null && bc.avgVar > 0 ? '<div class="toolbar"><button id="applyAvg">최근 평균 생활비(' + fm(bc.avgVar) + ')를 미래 계산에 반영</button></div>' : '') + '</section>';
  }
  async function addLedger() {
    const amt = num($('#lgAmt').value.replace(/[,\s]/g, ''), 0);
    if (!amt) { toast('금액을 입력하세요.', 'err'); $('#lgAmt').focus(); return; }
    const type = $('#lgType').value;
    const row = { id: newId('led'), date: $('#lgDate').value || todayStr(), type, amount: amt, category: $('#lgCat').value.trim() || (type === 'income' ? '기타수입' : '기타'), who: $('#lgWho').value, pay: $('#lgPay').value, memo: $('#lgMemo').value.trim() };
    const btn = $('#lgAdd'); if (btn) btn.disabled = true;
    (st.data.Ledger = st.data.Ledger || []).push(row); st.dirty = true; st.ledgerMonth = row.date.slice(0, 7);
    status('저장 중…');
    let saved = false, why = '';
    try { await api('save', { tab: 'Ledger', row }); saved = true; } catch (e) {
      why = e.message;
      const q = loadPending(); q.push({ tab: 'Ledger', row }); savePending(q);
    }
    status(saved ? '저장됨' : '저장 대기');
    if (st.data) { try { renderLedger(); } catch (e) { /* 화면 오류가 저장 실패로 보이지 않게 */ } }
    const label = (type === 'income' ? '수입 ' : '지출 ') + won(amt) + '원';
    toast(saved ? label + '을 기록했습니다.' : label + '을 이 기기에 보관했습니다. 연결되면 자동으로 저장합니다. (' + why + ')', saved ? '' : 'err');
    const a = $('#lgAmt'); if (a && st.data) a.focus();
  }

  /* ---------- 가계부 수정 ---------- */
  function ledgerEditForm(r) {
    const cats = r.type === 'income' ? CATS_INC : allExpCats();
    const sel = (id, opts, v) => '<select id="' + id + '">' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    return '<li class="ledit" data-lid="' + esc(r.id) + '"><div class="form-row">' +
      '<div><label class="f" for="leAmt">금액 (원)</label><input id="leAmt" data-num="1" inputmode="numeric" value="' + esc(commaFmt(String(r.amount))) + '"></div>' +
      '<div><label class="f" for="leCat">분류</label><input id="leCat" list="leCats" value="' + esc(r.category) + '"><datalist id="leCats">' + cats.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
      '<div><label class="f" for="leDate">날짜</label><input type="date" id="leDate" value="' + esc(String(r.date).slice(0, 10)) + '"></div>' +
      '<div><label class="f" for="leType">구분</label>' + sel('leType', OPT.ltype, r.type === 'income' ? 'income' : 'expense') + '</div>' +
      '<div><label class="f" for="leWho">누구</label>' + sel('leWho', [['me', names().me], ['wife', names().wife]], r.who === 'wife' ? 'wife' : 'me') + '</div>' +
      '<div><label class="f" for="lePay">결제</label>' + sel('lePay', OPT.pay, r.pay || '카드') + '</div>' +
      '<div class="span2"><label class="f" for="leMemo">메모</label><input id="leMemo" value="' + esc(r.memo || '') + '"></div>' +
      '<div class="span-all toolbar"><button class="primary" data-lsave>저장</button><button class="ghost" data-lcancel>취소</button></div></div></li>';
  }
  async function saveLedgerEdit(id) {
    const row = (st.data.Ledger || []).find(r => String(r.id) === id);
    if (!row) return;
    const amt = num($('#leAmt').value.replace(/[,\s]/g, ''), 0);
    if (!amt) { toast('금액을 입력하세요.', 'err'); return; }
    const date = $('#leDate').value || row.date;
    Object.assign(row, { amount: amt, category: $('#leCat').value.trim() || row.category, date, type: $('#leType').value, who: $('#leWho').value, pay: $('#lePay').value, memo: $('#leMemo').value.trim() });
    st.editLid = null; st.dirty = true; st.ledgerMonth = String(date).slice(0, 7);
    status('저장 중…');
    let saved = false;
    try { await api('save', { tab: 'Ledger', row }); saved = true; } catch (e) {
      const q = loadPending().filter(it => String(it.row.id) !== id); q.push({ tab: 'Ledger', row: Object.assign({}, row) }); savePending(q);
    }
    status(saved ? '저장됨' : '저장 대기');
    renderLedger();
    toast(saved ? '수정했습니다.' : '수정 내용을 이 기기에 보관했습니다. 연결되면 자동으로 저장합니다.', saved ? '' : 'err');
  }

  /* ---------- 카드사 앱 내역 붙여넣기 ---------- */
  /** 분류 추정 규칙 (가맹점 이름 기준). 맞지 않으면 표에서 바꾸면 된다 */
  const CAT_RULES = [
    [/소아|키즈|유아|장난감|토이|키자니아|아동/i, '__kid__'],
    [/택시|카카오T|버스|지하철|코레일|SRT|티머니|교통/i, '대중교통'],
    [/주유|GS칼텍스|SK에너지|S-OIL|에쓰오일|현대오일|충전|주차|하이패스|세차|정비|타이어/i, '차량유지비'],
    [/스타벅스|커피|카페|투썸|이디야|메가|빽다방|배달의민족|배민|요기요|쿠팡이츠|맥도날드|버거|치킨|피자|식당|김밥|국밥|분식|베이커리|파리바게뜨|뚜레쥬르/i, '외식'],
    [/마트|이마트|홈플러스|롯데마트|코스트코|트레이더스|컬리|오아시스|GS25|CU|세븐일레븐|이마트24|편의점|농협|하나로|정육|청과/i, '식비'],
    [/다이소|올리브영|생활/i, '생활용품'],
    [/병원|의원|약국|치과|한의원|안과|내과/i, '의료'],
    [/미용|헤어|네일|피부|뷰티/i, '미용'],
    [/항공|호텔|숙박|야놀자|여기어때|에어비앤비|아고다|리조트|펜션|트립/i, '여행'],
    [/CGV|메가박스|롯데시네마|넷플릭스|유튜브|멜론|티빙|웨이브|디즈니|스포티파이/i, '여가·문화'],
    [/통신|SKT|KT|LGU|U\+/i, '통신비'],
    [/보험|생명|화재|손해/i, '보험'],
    [/관리비/i, '관리비'], [/한전|전기|가스|수도/i, '공과금'],
    [/쿠팡|11번가|G마켓|옥션|무신사|지그재그|SSG|네이버페이|유니클로|자라/i, '쇼핑/의류'],
  ];
  function guessCat(name) {
    for (const [re, c] of CAT_RULES) if (re.test(name)) return c === '__kid__' ? names().child + ' 물건' : c;
    return '기타';
  }
  /** 카드사 앱/문자에서 복사한 글을 날짜·가맹점·금액으로 나눈다. 승인 취소·누적 금액 줄은 건너뛴다 */
  function parseCardText(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const now = new Date(), Y = now.getFullYear();
    const out = [];
    let curDate = null, pending = [];
    const dateIn = l => {
      let m = /(20\d{2})[.\-\/년]\s*(\d{1,2})[.\-\/월]\s*(\d{1,2})/.exec(l);
      if (m) return [+m[1], +m[2], +m[3], m[0]];
      m = /(?:^|\s|\[)(\d{1,2})[.\-\/](\d{1,2})(?=[\s\]]|$|\()/.exec(l) || /(\d{1,2})월\s*(\d{1,2})일/.exec(l);
      if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) { const mo = +m[1]; return [mo > now.getMonth() + 1 ? Y - 1 : Y, mo, +m[2], m[0]]; }
      return null;
    };
    const fmtD = d => d[0] + '-' + String(d[1]).padStart(2, '0') + '-' + String(d[2]).padStart(2, '0');
    lines.forEach(l => {
      if (/누적|잔액|한도|합계|총\s*금액|결제\s*예정|포인트/.test(l)) return;
      const d = dateIn(l);
      if (d) curDate = fmtD(d);
      const amts = []; const re = /(-?\d{1,3}(?:,\d{3})+|-?\d{3,})\s*원/g; let m;
      while ((m = re.exec(l))) amts.push(m[1]);
      if (!amts.length) {
        const bare = /(?:^|\s)(-?\d{1,3}(?:,\d{3})+)(?:\s|$)/.exec(l);
        if (bare) amts.push(bare[1]);
      }
      if (!amts.length) {
        let rest = l; if (d) rest = rest.replace(d[3], '');
        rest = rest.replace(/\d{1,2}:\d{2}(:\d{2})?/g, '').replace(/일시불|할부|\d+개월|승인|체크|신용|국내|해외|\[|\]|\(|\)|[*]/g, ' ').replace(/\s+/g, ' ').trim();
        if (rest && !/^\d+$/.test(rest)) pending.push(rest);
        return;
      }
      const amount = Math.abs(num(amts[0].replace(/,/g, ''), 0));
      if (!amount) return;
      let name = l; if (d) name = name.replace(d[3], '');
      name = name.replace(/(-?\d{1,3}(?:,\d{3})+|-?\d{3,})\s*원?/g, ' ').replace(/\d{1,2}:\d{2}(:\d{2})?/g, '').replace(/일시불|할부|\d+개월|승인|체크|신용|국내|해외|취소|환불|\[|\]|\(|\)|[*]|원/g, ' ').replace(/\s+/g, ' ').trim();
      if (!name && pending.length) name = pending[pending.length - 1];
      pending = [];
      const cancel = /취소|환불/.test(l) || /^-/.test(amts[0]);
      out.push({ date: curDate || todayStr(), name: name || '카드 사용', amount, cancel, on: !cancel });
    });
    const led = st.data.Ledger || [];
    out.forEach(r => {
      r.cat = guessCat(r.name);
      r.dup = led.some(x => String(x.date).slice(0, 10) === r.date && num(x.amount, 0) === r.amount);
      if (r.dup) r.on = false;
    });
    return out;
  }
  function pasteHtml() {
    if (st.ltype === 'income') return '';
    const rows = st.paste || [];
    const catOpts = c => allExpCats().map(x => '<option' + (x === c ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
    return '<details class="card paste-card"' + (st.pasteOpen ? ' open' : '') + '><summary><h2>카드 내역 붙여넣기</h2><span class="small muted">카드사 앱에서 복사한 사용 내역을 한 번에 가계부로</span></summary>' +
      '<label class="f" for="pasteTxt">카드사 앱 또는 문자에서 복사한 내용</label><textarea id="pasteTxt" rows="6" placeholder="예)\n10.05 스타벅스 강남점 6,500원\n10.05 이마트 성수점 54,300원\n10.04 카카오T 12,800원"></textarea>' +
      '<div class="toolbar"><button class="primary" id="pasteParse">내역 읽기</button>' + (rows.length ? '<button class="ghost" id="pasteClear">비우기</button>' : '') + '</div>' +
      (rows.length ? '<div class="tbl-wrap"><table class="paste"><thead><tr><th>추가</th><th>날짜</th><th>가맹점</th><th class="r">금액</th><th>분류</th></tr></thead><tbody>' +
        rows.map((r, i) => '<tr' + (r.on ? '' : ' class="off"') + '><td><input type="checkbox" data-pon="' + i + '"' + (r.on ? ' checked' : '') + ' aria-label="추가"></td><td>' + esc(r.date.slice(5)) + '</td><td>' + esc(r.name) + (r.cancel ? ' <span class="badge">취소</span>' : '') + (r.dup ? ' <span class="badge plain">이미 있음?</span>' : '') + '</td><td class="r">' + won(r.amount) + '</td><td><select data-pcat="' + i + '">' + catOpts(r.cat) + '</select></td></tr>').join('') +
        '</tbody></table></div><p class="legend-note">취소 건과 같은 날·같은 금액이 이미 있는 건은 체크를 꺼 두었습니다. 입력자는 위에서 고른 사람(' + esc(($('#lgWho') || {}).value === 'wife' ? names().wife : names().me) + ')으로, 결제는 카드로 적힙니다.</p>' +
        '<div class="toolbar"><button class="primary" id="pasteAdd">선택한 ' + rows.filter(r => r.on).length + '건 가계부에 추가</button></div>' : '<p class="legend-note">줄마다 날짜·가맹점·금액이 있으면 읽을 수 있습니다. 복사한 그대로 붙여 넣으면 됩니다. 저장 전에 표에서 분류를 확인하세요.</p>') +
      '</details>';
  }
  async function addPasted() {
    const rows = (st.paste || []).filter(r => r.on);
    if (!rows.length) { toast('추가할 내역을 선택하세요.', 'err'); return; }
    const who = (() => { try { return localStorage.getItem('am_who') || 'me'; } catch (e) { return 'me'; } })();
    const btn = $('#pasteAdd'); if (btn) btn.disabled = true;
    let ok = 0, held = 0;
    status('저장 중…');
    for (const r of rows) {
      const row = { id: newId('led'), date: r.date, type: 'expense', amount: r.amount, category: r.cat, who, pay: '카드', memo: r.name };
      (st.data.Ledger = st.data.Ledger || []).push(row);
      try { await api('save', { tab: 'Ledger', row }); ok++; } catch (e) { const q = loadPending(); q.push({ tab: 'Ledger', row }); savePending(q); held++; }
    }
    st.dirty = true; st.paste = null; st.pasteOpen = false; st.ledgerMonth = rows[0].date.slice(0, 7);
    status(held ? '저장 대기' : '저장됨');
    renderLedger();
    toast(ok + '건을 추가했습니다.' + (held ? ' ' + held + '건은 이 기기에 보관 중입니다.' : ''), held ? 'err' : '');
  }

  /* ---------- 자동 기록 (매달 정해진 날 가계부에 적기) ---------- */
  let recRunning = false;
  async function runRecurring() {
    if (recRunning || !st.data || st.local) return;
    const rules = (st.data.Recurring || []).filter(r => E.isActive(r.active) && num(r.amount, 0) > 0);
    if (!rules.length) return;
    recRunning = true;
    const now = new Date(), curYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const led = (st.data.Ledger = st.data.Ledger || []);
    const addYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
    let added = 0;
    try {
      for (const rule of rules) {
        const day = Math.max(1, Math.min(31, Math.round(num(rule.day, 1))));
        const start = /^\d{4}-\d{2}/.test(String(rule.start)) ? String(rule.start).slice(0, 7) : curYm;
        let ym = /^\d{4}-\d{2}/.test(String(rule.last_ym)) ? addYm(String(rule.last_ym).slice(0, 7), 1) : start;
        if (ym < start) ym = start;
        if (ym < addYm(curYm, -11)) ym = addYm(curYm, -11);   // 최대 12개월만 채운다
        const end = /^\d{4}-\d{2}/.test(String(rule.end)) ? String(rule.end).slice(0, 7) : '9999-12';
        let last = null;
        for (; ym <= curYm && ym <= end; ym = addYm(ym, 1)) {
          const [y, m] = ym.split('-').map(Number);
          const d = Math.min(day, new Date(y, m, 0).getDate());
          if (ym === curYm && now.getDate() < d) break;
          const id = 'rec_' + rule.id + '_' + ym;
          if (!led.some(x => String(x.id) === id)) {
            const row = { id, date: ym + '-' + String(d).padStart(2, '0'), type: rule.type === 'income' ? 'income' : 'expense', amount: num(rule.amount, 0), category: rule.category || (rule.type === 'income' ? '기타수입' : '기타'), who: rule.who === 'wife' ? 'wife' : 'me', pay: rule.pay || '카드', memo: (rule.name || '') + ' (자동)' };
            await apiOnce('save', { tab: 'Ledger', row });
            led.push(row); added++;
          }
          last = ym;
        }
        if (last && last !== String(rule.last_ym).slice(0, 7)) { rule.last_ym = last; await apiOnce('save', { tab: 'Recurring', row: rule }); }
      }
    } catch (e) { /* 다음 접속 때 이어서 (id가 같아 중복되지 않음) */ }
    recRunning = false;
    if (added) { st.dirty = true; toast('자동 기록 ' + added + '건을 가계부에 적었습니다.'); render(); }
  }

  /* ---------- 분석 ---------- */
  const subEl = () => $('#sub');
  function renderAnalysis() {
    const s = st.subs.analysis;
    const desc = {
      advice: '지금 상황에서 먼저 챙길 것과, 매달 남는 돈을 어디에 쓰면 좋을지 정리했습니다.',
      invest: '보유 종목의 손익, 비중, 분야 쏠림을 점검합니다. 종목 수정은 [관리 > 투자 종목]에서 합니다.',
      future: '은퇴 나이·집값·수익률 가정을 바꿔 30년 뒤를 미리 봅니다.',
      tesla: '테슬라를 사면, 안 사면, 할부로 사면 집 잔금 후 현금이 얼마나 남는지 비교합니다.',
      sell: '목표 매도가에 언제 닿는지, 팔고 나면 현금흐름이 어떻게 바뀌는지 봅니다.',
    }[s];
    main.innerHTML = pageHead('분석', desc) + subnav('analysis') + '<div id="sub"></div>';
    ({ advice: renderAdvice, invest: renderInvestCheck, future: renderSim, tesla: renderScnPlan, sell: renderScnSell })[s]();
  }
  function allocTable(rows) {
    if (!rows.length) return '<p class="muted small">배분할 잉여금이 없습니다.</p>';
    return '<div class="tbl-wrap"><table><thead><tr><th>용도</th><th class="r">월 금액</th><th>이유</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + esc(r.name) + '</td><td class="r"><b>' + fm(r.amt) + '</b></td><td class="muted wrap">' + esc(r.why) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function renderAdvice() {
    ensureScenarios();
    const { adv } = st;
    const order = { risk: 0, warn: 1, info: 2, ok: 3 };
    subEl().innerHTML =
      '<section class="card"><h2>매달 남는 돈, 어디에 쓸까</h2><div class="grid g2">' +
      '<div><h3>다음 달 (남는 돈 ' + fm(adv.nowSurplus) + ')</h3>' + allocTable(adv.allocNow) + '</div>' +
      '<div><h3>입주 후 안정기 (월 평균 ' + fm(adv.steadySurplus) + ')</h3>' + allocTable(adv.allocSteady) + '</div></div>' +
      '<p class="legend-note">순서: 현금 확보 → 비상금 → 세액공제 → 자녀 적립 → 대출 상환·ISA 투자. 규칙에 따른 제안이며 투자 권유가 아닙니다.</p></section>' +
      adv.cards.slice().sort((a, b) => order[a.level] - order[b.level]).map(noteCard).join('');
  }
  function investReport() {
    const hr = A.holdingsReport(st.data);
    if (!hr.rows.length) return '<div class="empty">입력한 종목이 없습니다. ' + link('종목 추가하기', 'manage', 'holdings') + '</div>';
    return '<div class="tbl-wrap"><table><thead><tr><th>종목</th><th>계좌</th><th class="r">매입금</th><th class="r">평가금</th><th class="r">손익</th><th class="r">수익률</th><th class="r">비중</th><th>시세</th><th>점검</th></tr></thead><tbody>' +
      hr.rows.map(r => '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.account) + '</td><td class="r">' + fm(r.cost) + '</td><td class="r">' + fm(r.value) + '</td><td class="r">' + signed(r.loss) + '</td><td class="r ' + (r.pnl < 0 ? 'neg' : 'pos') + '">' + pct(r.pnl) + '</td><td class="r">' + pct(r.weight) + '</td><td class="small muted">' + ago(r.price_at) + '</td><td class="small wrap">' + (r.flags.length ? r.flags.map(f => '<span class="badge">' + esc(f) + '</span>').join(' ') : dash) + '</td></tr>').join('') +
      '<tr class="strongrow"><td><b>합계</b></td><td></td><td class="r">' + fm(hr.totalCost) + '</td><td class="r">' + fm(hr.total) + '</td><td class="r">' + signed(hr.total - hr.totalCost) + '</td><td class="r">' + pct(hr.pnl) + '</td><td></td><td></td><td></td></tr></tbody></table></div>' +
      '<h3 class="mt">분야별 비중</h3>' + hr.sectorList.map(s => '<div class="row-between small"><span>' + esc(s.sector) + '</span><span>' + fm(s.value) + ' · ' + pct(s.weight) + '</span></div><div class="bar thin"><i style="width:' + (s.weight * 100) + '%;background:var(--s1)"></i></div>').join('');
  }
  function renderInvestCheck() {
    ensureCompute();
    const card = st.adv.cards.find(c => c.tag === '투자 점검');
    subEl().innerHTML = '<section class="card"><div class="row-between"><h2>보유 종목 점검</h2>' + link('종목·시세 관리', 'manage', 'holdings') + '</div>' + investReport() +
      '<p class="legend-note">손익은 현재가 기준입니다. 시세 코드가 있는 종목은 1시간마다 현재가가 자동으로 바뀝니다.</p></section>' + (card ? noteCard(card) : '');
  }

  /* 은퇴·미래 */
  const SIM_FIELDS = [['retire_age_me', '본인 은퇴 나이'], ['retire_age_wife', '와이프 은퇴 나이'], ['house_mean', '집값 연평균 %'], ['house_vol', '집값 변동폭 %'], ['house_seed', '변동 경로 번호'], ['invest_return', '투자수익률 %'], ['inflation', '물가상승률 %'], ['salary_growth', '연봉상승률 %']];
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
    subEl().innerHTML =
      '<section class="card"><h2>가정 바꿔보기</h2><div class="ctl">' + SIM_FIELDS.map(([k, l]) => '<div><label class="f" for="sim_' + k + '">' + l + '</label><input id="sim_' + k + '" data-sim="' + k + '" inputmode="decimal" value="' + esc(S[k]) + '"></div>').join('') +
      '</div><div class="toolbar"><button class="primary" id="simRun">다시 계산</button><button id="simSave">이 가정을 저장</button><button class="ghost" id="simReset">처음 값으로</button></div>' +
      '<p class="small muted">집값은 평균이 정확히 ' + S.house_mean + '%가 되도록 만든 가상의 오르내림입니다. 경로 번호를 바꾸면 다른 흐름이 나옵니다. 예측이 아니라 가정에 따른 계산입니다.</p></section>' +
      '<section class="card"><h2>순자산 30년</h2><div class="chart-box tall"><canvas id="simChart" role="img" aria-label="순자산 시뮬레이션"></canvas></div></section>' +
      '<section class="card"><h2>은퇴 시기별 비교</h2><div class="tbl-wrap"><table><thead><tr><th>은퇴 나이</th><th class="r">금융자산 바닥나는 나이</th><th class="r">10년 후 순자산</th><th class="r">20년 후 순자산</th><th class="r">65세' + kidTag(65) + ' 순자산</th><th class="r">65세 금융자산</th></tr></thead><tbody>' +
      sc.map(s => '<tr><td>' + esc(s.label) + '</td><td class="r ' + (s.depleteAge ? 'neg' : 'pos') + '">' + (s.depleteAge ? s.depleteAge + '세' + kidTag(s.depleteAge) : '바닥나지 않음') + '</td><td class="r">' + fm(s.nw10) + '</td><td class="r">' + fm(s.nw20) + '</td><td class="r">' + fm(s.nw65) + '</td><td class="r">' + fm(s.fin65) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="legend-note">금융자산 = 현금 + 비상금 + 투자(IRP 포함), 부채 차감. 집 매각·주택연금은 넣지 않았고 국민연금은 임시 추정값입니다. 본인 88세까지 봅니다.</p></section>' +
      '<section class="card"><h2>연도별 표</h2><div class="tbl-wrap mini"><table><thead><tr><th>연도</th><th class="r">본인 나이</th><th class="r">' + names().child + ' 나이</th><th class="r">수입</th><th class="r">지출(대출 포함)</th><th class="r">순자산</th><th class="r">금융자산</th><th class="r">집</th><th class="r">부채</th></tr></thead><tbody>' +
      yrs.map(r => '<tr><td>' + r.y + '</td><td class="r">' + r.age + '</td><td class="r">' + kidAge(r.age) + '</td><td class="r">' + fm(r.inc) + '</td><td class="r">' + fm(r.exp) + '</td><td class="r"><b>' + fm(r.nw) + '</b></td><td class="r' + (r.short ? ' neg' : '') + '">' + fm(r.fin) + '</td><td class="r">' + fm(r.house) + '</td><td class="r">' + fm(r.debt) + '</td></tr>').join('') + '</tbody></table></div></section>';
    nwCharts('simChart', sim);
  }

  /* 테슬라 · 집 매도 */
  function scnState() {
    if (!st.scn) {
      const S = E.settings(st.data);
      st.scn = { pct: 60, rate: 6, term: 60, toYm: '2027-04', target: S.house_target, deposit: S.after_deposit, rent: S.after_rent, rentDep: S.after_rent_deposit, sellYm: '' };
    }
    return st.scn;
  }
  const numIn = (id, label, val) => '<div><label class="f" for="' + id + '">' + label + '</label><input id="' + id + '" data-num="1" inputmode="decimal" value="' + esc(commaFmt(String(val))) + '"></div>';
  const readNum = id => num((($('#' + id) || {}).value || '').replace(/,/g, ''), 0);

  function renderScnPlan() {
    const sc = scnState();
    const defs = [
      ['구매 안 함', { tesla: 'skip' }],
      ['할부 ' + sc.pct + '%', { tesla: 'buy', tesla_fin_pct: sc.pct, tesla_rate: sc.rate, tesla_term: sc.term }],
      ['현금으로 구매', { tesla: 'buy', tesla_fin_pct: 0 }],
    ];
    const plans = defs.map(([label, o]) => ({ label, o, p: A.fundingPlan(st.data, o, sc.toYm) }));
    const [skip, fin, buy] = plans;
    const carCost = -buy.p.rows.find(r => /자동차/.test(r.label)).val;
    const principal = (st.data.Events || []).filter(e => E.isActive(e.active) && String(e.category) === 'car' && num(e.amount, 0) < 0 && /잔금/.test(e.name)).reduce((q, e) => q - num(e.amount, 0), 0) * sc.pct / 100;
    const totalInterest = principal > 0 ? E.payment(principal, sc.rate / 1200, sc.term) * sc.term - principal : 0;
    const after = pl => { const t0 = pl.p.sim.ym.indexOf(sc.toYm); let m = Infinity, k = t0; for (let t = t0; t < Math.min(pl.p.sim.N, t0 + 12); t++) if (pl.p.sim.low[t] < m) { m = pl.p.sim.low[t]; k = t; } return { v: m, ym: pl.p.sim.ym[k] }; };
    const S = buy.p.sim.S;
    const curPlan = S.tesla === 'skip' ? 0 : S.tesla_fin_pct > 0 ? 1 : 2;
    const kp = (pl, i) => '<div class="kpi' + (i === curPlan ? ' current' : '') + '"><div class="l">' + esc(pl.label) + (i === curPlan ? ' · 현재 계획' : '') + '</div><div class="v">' + fm(pl.p.end) + '</div><div class="s">' + esc(sc.toYm) + ' 말 현금</div></div>';
    const rowsHtml = buy.p.rows.map((r, i) => '<tr class="' + (/자동차/.test(r.label) ? 'hl' : '') + (r.strong ? ' strongrow' : '') + '"><td>' + esc(r.label) + '</td>' + plans.map(pl => '<td class="r">' + (r.strong ? '<b>' + fm(pl.p.rows[i].val) + '</b>' : sgn(pl.p.rows[i].val)) + '</td>').join('') + '</tr>').join('');
    const extra = (label, fn) => '<tr><td>' + label + '</td>' + plans.map(pl => '<td class="r">' + fn(pl) + '</td>').join('') + '</tr>';
    subEl().innerHTML =
      '<div class="grid g3 keep3">' + plans.map(kp).join('') + '</div>' +
      '<section class="card"><h2>한눈에 보기</h2><ul class="plain">' +
      '<li>사지 않으면 ' + esc(sc.toYm) + ' 말 현금이 <b>' + fm(skip.p.end) + '</b>, 현금으로 사면 <b>' + fm(buy.p.end) + '</b>입니다. 차이 ' + fm(skip.p.end - buy.p.end) + ' (차량 잔금·취득세 ' + fm(carCost) + ' + 계약금 카드 할부 등 ' + fm(skip.p.end - buy.p.end - carCost) + ').</li>' +
      '<li>할부 ' + sc.pct + '%(' + sc.rate + '%, ' + sc.term + '개월)로 사면 현금은 ' + fm(fin.p.end - buy.p.end) + ' 더 남지만 매달 ' + fm(fin.p.payAfter - buy.p.payAfter) + '를 더 갚고, 이자는 모두 약 ' + fm(totalInterest) + '입니다.</li>' +
      '<li>입주 후 12개월 중 가장 빠듯한 달: 안 삼 ' + fm(after(skip).v) + ' · 할부 ' + fm(after(fin).v) + ' · 현금 ' + fm(after(buy).v) + '</li>' +
      '<li>2년 중 가장 빠듯한 달은 ' + buy.p.minYm + ' (' + fm(buy.p.minLow) + ')이고, 테슬라와 상관없이 집 계약금 때문입니다.</li></ul>' +
      '<div class="toolbar"><button data-apply="tesla:skip">구매 안 함으로 확정</button><button data-apply="tesla:fin">할부로 확정</button><button data-apply="tesla:buy">현금 구매로 확정</button></div>' +
      '<p class="legend-note">"확정"을 누르면 홈·현금 일정·추천이 그 선택으로 계산됩니다. 언제든 바꿀 수 있습니다.</p></section>' +
      '<section class="card"><h2>할부 조건</h2><div class="ctl">' + numIn('scPct', '할부 비율(%)', sc.pct) + numIn('scRate', '할부 금리(%)', sc.rate) + numIn('scTerm', '할부 기간(개월)', sc.term) + '<div><label class="f" for="scTo">비교 기준월</label><input id="scTo" value="' + esc(sc.toYm) + '" placeholder="2027-04"></div></div>' +
      '<div class="toolbar"><button class="primary" id="scnCalc">다시 계산</button></div></section>' +
      '<section class="card"><h2>' + esc(sc.toYm) + '까지 돈의 흐름 (시작 현금 → 끝 현금)</h2><div class="tbl-wrap"><table class="cmp"><thead><tr><th></th>' + plans.map(pl => '<th class="r">' + esc(pl.label) + '</th>').join('') + '</tr></thead><tbody>' + rowsHtml +
      '<tr class="strongrow"><td><b>끝 현금</b></td>' + plans.map(pl => '<td class="r"><b>' + fm(pl.p.end) + '</b></td>').join('') + '</tr>' +
      extra('비상금 (별도)', pl => fm(pl.p.reserve)) + extra('투자·연금 자산', pl => fm(pl.p.invest)) + extra('순자산', pl => fm(pl.p.nw)) + extra('다음 달 대출·할부 상환', pl => fm(pl.p.payAfter)) +
      '</tbody></table></div>' +
      '<p class="legend-note">남는 돈은 투자로 옮기지 않고 모두 현금으로 둔 계산입니다. 구매 안 함은 계약금 500만원 환불과 카드 할부 취소를 가정했습니다(실제 조건 확인 필요). 할부 금리·기간은 견적을 받으면 위에서 바꾸세요.</p></section>';
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
    const yRows = sa.yearly.slice(0, 27).map(r => '<tr' + (r.price >= S.house_target ? ' class="hl"' : '') + '><td>' + r.ym + '</td><td class="r">' + r.age + '세</td><td class="r">' + kidAge(r.age) + '세</td><td class="r">' + fm(r.price) + '</td><td class="r">' + Math.round(r.price / S.house_target * 100) + '%</td><td class="r">' + fm(-r.tax) + '</td><td class="r">' + fm(-r.fee) + '</td><td class="r">' + fm(-r.repay) + '</td><td class="r"><b>' + fm(r.net) + '</b></td><td class="r">' + (r.annual * 100).toFixed(1) + '%</td></tr>').join('');
    const col = fn => cmp.map(c => '<td class="r">' + fn(c) + '</td>').join('');
    const hasSale = c => !!c.sale;
    subEl().innerHTML =
      '<section class="card"><h2>목표 매도가 ' + fm(S.house_target) + '</h2>' +
      (sa.hit ? '<div class="big-num">' + sa.hit.ym + ' <span class="small muted">본인 ' + sa.hit.age + '세 · ' + names().child + ' ' + kidAge(sa.hit.age) + '세 · 집값 ' + fm(sa.hit.price) + '</span></div>' +
        '<p class="small">양도세 ' + fm(sa.hit.tax) + ' · 중개보수 ' + fm(sa.hit.fee) + ' · 대출 상환 ' + fm(sa.hit.repay) + ' → <b>손에 쥐는 돈 ' + fm(sa.hit.net) + '</b></p>' :
        '<div class="note warn"><div class="body">지금 가정(연평균 ' + S.house_mean + '%)으로는 목표가에 닿지 않습니다. 목표가를 낮추거나 [은퇴·미래]에서 상승률을 바꿔 보세요.</div></div>') +
      '<ul class="plain">' +
      '<li>가장 빨리 팔 수 있는 때: <b>' + sa.earliestYm + '</b> (입주 ' + S.move_in_ym + ' 후 2년 실거주). 토지거래허가 구역은 2년 실거주 의무가 있습니다.</li>' +
      '<li>1세대 1주택은 12억 이하면 양도세가 없고, 넘는 부분만 과세됩니다. 오래 보유·거주할수록 공제가 커집니다(각 연 4%, 최대 80%).</li>' +
      (later && sa.hit ? '<li>목표 도달 후 2년 더 보유하면: 양도세 ' + fm(sa.hit.tax) + ' → ' + fm(later.tax) + ', 손에 쥐는 돈 ' + fm(sa.hit.net) + ' → ' + fm(later.net) + '</li>' : '') +
      '<li>세금은 대략적인 추정입니다. 실제로 팔기 전에 세무사에게 확인하세요.</li></ul></section>' +
      '<section class="card"><h2>조건 바꾸기</h2><div class="ctl">' + numIn('sTarget', '목표 매도가(만원)', sc.target) + '<div><label class="f" for="sYm">매도 월 (비우면 자동)</label><input id="sYm" value="' + esc(sc.sellYm) + '" placeholder="2044-01"></div>' +
      numIn('sDep', '판 뒤 전세 보증금(만원)', sc.deposit) + numIn('sRent', '월세로 가면 월세(만원)', sc.rent) + numIn('sRentDep', '월세 보증금(만원)', sc.rentDep) + '</div>' +
      '<div class="toolbar"><button class="primary" id="scnCalc">다시 계산</button></div></section>' +
      '<section class="card"><h2>' + ym + '에 팔면</h2>' + (ymNote ? '<p class="small muted">' + ymNote + '</p>' : '') +
      '<div class="tbl-wrap"><table class="cmp"><thead><tr><th></th>' + cmp.map(c => '<th class="r">' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
      '<tr><td>집 매도가</td>' + col(c => hasSale(c) ? fm(c.sale.price) : dash) + '</tr>' +
      '<tr><td>양도세</td>' + col(c => hasSale(c) ? fm(-c.sale.tax) : dash) + '</tr>' +
      '<tr><td>중개보수</td>' + col(c => hasSale(c) ? fm(-c.sale.fee) : dash) + '</tr>' +
      '<tr><td>대출 상환</td>' + col(c => hasSale(c) ? fm(-c.sale.repay) : dash) + '</tr>' +
      '<tr class="strongrow"><td><b>손에 쥐는 돈</b></td>' + col(c => hasSale(c) ? '<b>' + fm(c.sale.net) + '</b>' : dash) + '</tr>' +
      '<tr><td>새 집 보증금</td>' + col(c => hasSale(c) ? fm(-c.sale.deposit) : dash) + '</tr>' +
      '<tr class="strongrow"><td><b>투자로 돌릴 돈</b></td>' + col(c => hasSale(c) ? '<b>' + fm(c.sale.net - c.sale.deposit) + '</b>' : dash) + '</tr>' +
      '<tr><td>월 수입 (전 → 후)</td>' + col(c => fm(c.incBefore) + ' → ' + fm(c.incAfter)) + '</tr>' +
      '<tr><td>월 지출 (전 → 후)</td>' + col(c => fm(c.expBefore) + ' → ' + fm(c.expAfter)) + '</tr>' +
      '<tr class="strongrow"><td><b>월 남는 돈 (전 → 후)</b></td>' + col(c => '<b>' + fm(c.surBefore) + ' → ' + fm(c.surAfter) + '</b>') + '</tr>' +
      '<tr><td>65세' + kidTag(65) + ' 순자산</td>' + col(c => fm(c.nw65)) + '</tr>' +
      '<tr><td>65세 금융자산</td>' + col(c => fm(c.fin65)) + '</tr>' +
      '<tr><td>금융자산 바닥나는 나이</td>' + col(c => (c.depleteAge ? '<span class="neg">' + c.depleteAge + '세' + kidTag(c.depleteAge) + '</span>' : '<span class="pos">없음</span>')) + '</tr>' +
      '</tbody></table></div>' +
      '<div class="toolbar"><button data-apply="sell:jeonse:' + ym + '">전세 이주로 확정</button><button data-apply="sell:rent:' + ym + '">월세 이주로 확정</button><button class="ghost" data-apply="sell:clear">매도 계획 지우기</button></div>' +
      '<p class="legend-note">판 뒤에는 대출 상환과 재산세가 없어지고, 전세는 보증금이 묶이며 월세는 매달 나갑니다. 남는 돈은 연 ' + S.invest_return + '% 투자를 가정했습니다. 수입 변화에는 은퇴 시점의 영향도 섞여 있습니다.</p></section>' +
      '<section class="card"><h2>팔 시점별 손에 쥐는 돈 (매년 4월)</h2><div class="tbl-wrap mini"><table><thead><tr><th>시점</th><th class="r">본인</th><th class="r">' + names().child + '</th><th class="r">집값</th><th class="r">목표 대비</th><th class="r">양도세</th><th class="r">중개보수</th><th class="r">대출 상환</th><th class="r">손에 쥐는 돈</th><th class="r">연 환산 수익률</th></tr></thead><tbody>' + yRows + '</tbody></table></div>' +
      '<p class="legend-note">강조된 줄은 목표가 이상인 해입니다. 수익률은 세금·중개보수를 뺀 매도가를 총 취득비용과 비교해 1년 단위로 환산했습니다(대출 이자·보유비 제외).</p></section>';
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
      status('저장됨'); st.dirty = true; toast('기본 계획에 반영했습니다. 홈과 현금 일정이 이 선택으로 계산됩니다.'); render();
    } catch (err) { status('저장 실패'); toast(err.message, 'err'); }
  }
  async function saveSettingValue(key, value, note) {
    const list = (st.data.Settings = st.data.Settings || []);
    let row = list.find(r => r.id === key);
    if (!row) { row = { id: key, value: '', note: note || '' }; list.push(row); }
    row.value = value; st.dirty = true;
    await api('save', { tab: 'Settings', row });
  }

  /* ---------- 관리 ---------- */
  const KNOWN_SYMBOLS = { '기아': 'KRX:000270', 'CJ CGV': 'KRX:079160', '스튜디오드래곤': 'KRX:253450', '레인보우로보틱스': 'KRX:277810', 'TIGER 미국S&P500': 'KRX:360750' };
  function priceStatusHtml() {
    const m = st.meta || {}, hs = (st.data.Holdings || []).filter(h => E.isActive(h.active));
    const withSym = hs.filter(h => String(h.symbol || '').trim()).length;
    const mins = m.pricesAt ? (Date.now() - new Date(m.pricesAt).getTime()) / 60000 : null;
    const stale = withSym > 0 && (mins == null || mins > 180);
    return '<section class="card"><div class="row-between"><h2>시세 자동 갱신</h2><span class="badge' + (stale || m.fails ? '' : ' plain') + '">' + (m.auto ? '켜짐 · 1시간마다' : '꺼짐') + '</span></div>' +
      '<p class="small">시세 코드가 있는 종목 ' + withSym + '/' + hs.length + '개 · 마지막 갱신 <b>' + ago(m.pricesAt) + '</b>' + (stale ? ' <b class="neg">(오래됨)</b>' : '') + '</p>' +
      (m.lastErr ? '<div class="note warn"><div class="body">최근 문제: ' + esc(m.lastErr) + '</div></div>' : '') +
      (!m.auto ? '<p class="small muted">자동 갱신은 구글 시트 메뉴 [자산관리 > ④ 시세 자동 갱신 켜기]로 켭니다.</p>' : '') +
      '<div class="toolbar"><button class="primary" id="priceRefresh">지금 갱신</button><button id="fillSymbols">시세 코드 자동 채우기</button><span class="small muted" id="priceMsg"></span></div></section>';
  }
  function inviteLink() {
    const u = localStorage.getItem('am_api') || '';
    return u ? location.origin + location.pathname + '#u=' + encodeURIComponent(u) : '';
  }
  const NO_COMMA = ['birth_me', 'birth_wife', 'child_birth_year', 'house_seed', 'years', 'retire_age_me', 'retire_age_wife'];
  function settingInput(k, unit, v) {
    if (unit.indexOf('sel:') === 0) {
      const opts = unit.slice(4).split(',').map(x => x.split('='));
      return '<select data-set="' + k + '">' + opts.map(o => '<option value="' + o[0] + '"' + (String(v) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    }
    if (NO_COMMA.indexOf(k) >= 0) return '<input data-set="' + k + '" inputmode="numeric" value="' + esc(v) + '">';
    if (typeof E.DEFAULTS[k] === 'number') return '<input data-set="' + k + '" data-num="1" inputmode="decimal" value="' + esc(commaFmt(String(v))) + '">';
    return '<input data-set="' + k + '" value="' + esc(v) + '"' + (unit === 'YYYY-MM' ? ' placeholder="YYYY-MM"' : '') + '>';
  }
  function renderSettingsBody() {
    const S = E.settings(st.data);
    return SETTING_GROUPS.map(([g, items], i) => (i === SETTING_GROUPS.length - 1 ? '<details class="card adv"><summary><h2>' + g + '</h2></summary>' : '<section class="card"><h2>' + g + '</h2>') +
      '<div class="efields">' + items.map(([k, label, unit]) => '<label class="fld"><span class="fl">' + label + (unit && unit.indexOf('sel:') !== 0 && unit !== 'YYYY-MM' ? ' <em>' + unit + '</em>' : '') + '</span>' + settingInput(k, unit, S[k]) + '</label>').join('') + '</div>' +
      (i === SETTING_GROUPS.length - 1 ? '</details>' : '</section>')).join('');
  }
  function renderConnectBody() {
    return '<section class="card"><h2>와이프 폰에 연결하기</h2><p class="small">아래 링크를 개인 채팅으로 보내 한 번 열게 하면, 그 폰은 이후 보안코드만 입력하면 됩니다.</p>' +
      '<input id="inviteLink" readonly value="' + esc(inviteLink()) + '"><div class="toolbar"><button class="primary" id="copyInvite">링크 복사</button><span class="small muted" id="copyMsg"></span></div>' +
      '<p class="small muted">보안코드는 링크에 들어 있지 않으니 따로 알려주세요. 링크에는 연결 주소가 들어 있으니 공개된 곳에 올리지 마세요.</p></section>' +
      '<section class="card"><h2>보안</h2><ul class="plain"><li>데이터는 구글 시트에만 있고, 이 사이트 코드에는 개인정보가 없습니다.</li><li>보안코드는 구글 시트 메뉴 [자산관리 > ② 보안코드 설정]에서 바꿉니다. 5번 틀리면 15분 잠깁니다.</li><li>접속은 6시간 뒤 자동으로 끝납니다.</li></ul>' +
      '<div class="toolbar"><button id="moreSync">시트에서 다시 불러오기</button><button class="ghost" id="moreOut">나가기</button></div></section>' +
      '<section class="card"><h2>시장 데이터 (예정)</h2><p class="small">주가는 GOOGLEFINANCE로 1시간마다 갱신됩니다. 금리·환율(한국은행 ECOS, 미국 FRED) 수집과 시장 추천은 다음 단계에서 추가합니다.</p></section>';
  }
  function renderManage() {
    const s = st.subs.manage;
    if (s === 'settings') {
      main.innerHTML = pageHead('관리', '계산에 쓰는 가정값입니다. 바꾸면 바로 저장되고 모든 화면에 반영됩니다.') + subnav('manage') + renderSettingsBody();
      return;
    }
    if (s === 'connect') {
      main.innerHTML = pageHead('관리', '가족 기기 연결과 보안 설정입니다.') + subnav('manage') + renderConnectBody();
      return;
    }
    const [tab, title, desc] = MANAGE_INFO[s];
    main.innerHTML = pageHead('관리', '가진 돈, 수입, 정해진 지출, 대출, 큰 일정을 입력하는 곳입니다. 항목을 누르면 펼쳐서 고칠 수 있습니다.') + subnav('manage') +
      (s === 'holdings' ? priceStatusHtml() : '') + (s === 'debts' ? checksHtml() : '') +
      '<section class="card"><h2>' + title + '</h2><p class="small muted">' + desc + '</p>' + editList(tab, st.data[tab] || []) + '</section>';
    if (st.openId) { const d = main.querySelector('details[data-id="' + st.openId + '"] input'); if (d) d.focus(); st.openId = null; }
  }

  /* ---------- 라우팅 ---------- */
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (k === 'manage' ? ' class="nav-manage' + (st.tab === k ? ' on' : '') + '"' : st.tab === k ? ' class="on"' : '') + (st.tab === k ? ' aria-current="page"' : '') + '>' + l + '</button>').join('');
    $('#bottomnav').innerHTML = TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (st.tab === k ? ' class="on" aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg>' + l + '</button>').join('');
  }
  function render() {
    if (!st.data) return;
    applyNames();
    Object.keys(st.charts).forEach(k => { try { st.charts[k].destroy(); } catch (e) { /* ignore */ } delete st.charts[k]; });
    ({ home: renderHome, ledger: renderLedger, flow: renderFlow, analysis: renderAnalysis, manage: renderManage })[st.tab]();
    nameTexts(main);
  }
  function go(tab, sub) {
    st.tab = tab; if (sub && st.subs[tab] !== undefined) st.subs[tab] = sub;
    renderTabs(); render(); window.scrollTo(0, 0);
  }

  /* ---------- 이벤트 ---------- */
  ['#tabs', '#bottomnav'].forEach(sel => $(sel).addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); }));
  $('#loginBtn').addEventListener('click', doLogin);
  $('#apiChange').addEventListener('click', e => { e.preventDefault(); $('#apiBox').classList.remove('hidden'); $('#apiSaved').classList.add('hidden'); $('#apiUrl').focus(); });
  $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#logoutBtn').addEventListener('click', () => logout(false));
  $('#reloadBtn').addEventListener('click', () => loadAll(true).then(() => toast('시트에서 다시 불러왔습니다.')).catch(e => toast(e.message, 'err')));

  function onFieldEdit(t) {
    const list = t.closest('.elist');
    if (list) {
      const det = t.closest('[data-id]'); if (!det || !t.dataset.k) return true;
      const tab = list.dataset.etab, row = (st.data[tab] || []).find(r => String(r.id) === det.dataset.id);
      if (!row) return true;
      row[t.dataset.k] = liveFormat(t); queueSave(tab, row);
      const sum = det.querySelector('summary'); if (sum) sum.innerHTML = summaryHtml(tab, row);
      det.classList.toggle('off', !E.isActive(row.active));
      return true;
    }
    if (t.dataset && t.dataset.set) {
      const k = t.dataset.set, raw = liveFormat(t);
      clearTimeout(timers['set' + k]); status('수정됨…');
      timers['set' + k] = setTimeout(() => saveSettingValue(k, raw).then(() => status('저장됨')).catch(err => { status('저장 실패'); toast(err.message, 'err'); }), 700);
      return true;
    }
    return false;
  }
  main.addEventListener('input', e => {
    const t = e.target;
    if (onFieldEdit(t)) return;
    if (t.dataset && t.dataset.num) liveFormat(t);
  });
  main.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'lgMonth') { st.ledgerMonth = t.value; renderLedger(); return; }
    if (t.dataset && t.dataset.pon != null) { st.paste[+t.dataset.pon].on = t.checked; renderLedger(); return; }
    if (t.dataset && t.dataset.pcat != null) { st.paste[+t.dataset.pcat].cat = t.value; return; }
    if (t.tagName === 'SELECT') onFieldEdit(t);
  });

  main.addEventListener('click', async e => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-tab]'))) { go(b.dataset.tab, b.dataset.sub); return; }
    if ((b = t.closest('[data-subnav]'))) { st.subs[st.tab] = b.dataset.subnav; render(); return; }
    if (t.closest('#moreSync')) { loadAll(true).then(() => toast('시트에서 다시 불러왔습니다.')).catch(err => toast(err.message, 'err')); return; }
    if (t.closest('#moreOut')) { logout(false); return; }
    if ((b = t.closest('[data-ltype]'))) { st.ltype = b.dataset.ltype; renderLedger(); return; }
    if ((b = t.closest('[data-who]'))) {
      $('#lgWho').value = b.dataset.who; try { localStorage.setItem('am_who', b.dataset.who); } catch (err) { /* ignore */ }
      main.querySelectorAll('[data-who]').forEach(x => x.classList.toggle('on', x === b)); return;
    }
    if ((b = t.closest('[data-cat]'))) {
      $('#lgCat').value = b.dataset.cat; main.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === b)); return;
    }
    if ((b = t.closest('[data-add]'))) {
      const tab = b.dataset.add, row = Object.assign({ id: newId(tab.slice(0, 3).toLowerCase()) }, DEFAULT_ROW[tab] || {});
      FIELDS[tab].forEach(f => { if (row[f.k] === undefined) row[f.k] = ''; });
      try { await api('save', { tab, row }); (st.data[tab] = st.data[tab] || []).push(row); st.dirty = true; st.openId = row.id; render(); } catch (err) { toast('추가하지 못했습니다: ' + err.message, 'err'); }
      return;
    }
    if (t.closest('[data-del]')) {
      const det = t.closest('[data-id]'), tab = t.closest('.elist').dataset.etab;
      if (!confirm('이 항목을 삭제할까요?')) return;
      try { await api('del', { tab, id: det.dataset.id }); st.data[tab] = st.data[tab].filter(r => String(r.id) !== det.dataset.id); st.dirty = true; render(); toast('삭제했습니다.'); } catch (err) { toast('삭제하지 못했습니다: ' + err.message, 'err'); }
      return;
    }
    if (t.closest('#saveNames')) {
      const a = $('#nmMe').value.trim(), b2 = $('#nmWife').value.trim(), c3 = $('#nmKid').value.trim();
      if (!a || !b2 || !c3) { toast('이름을 모두 입력하세요.', 'err'); return; }
      try { await saveSettingValue('name_me', a); await saveSettingValue('name_wife', b2); await saveSettingValue('name_child', c3); toast('이름을 저장했습니다.'); render(); } catch (err) { toast(err.message, 'err'); }
      return;
    }
    if (t.closest('#lgAdd')) { addLedger(); return; }
    if (t.closest('#retryPending')) { flushPending().then(() => { if (st.tab === 'ledger') renderLedger(); }); return; }
    if (t.closest('[data-ledit]')) { st.editLid = t.closest('[data-lid]').dataset.lid; renderLedger(); const a = $('#leAmt'); if (a) a.focus(); return; }
    if (t.closest('[data-lcancel]')) { st.editLid = null; renderLedger(); return; }
    if (t.closest('[data-lsave]')) { saveLedgerEdit(t.closest('[data-lid]').dataset.lid); return; }
    if (t.closest('#pasteParse')) {
      const rows = parseCardText($('#pasteTxt').value);
      st.pasteOpen = true; st.paste = rows; renderLedger();
      toast(rows.length ? rows.length + '건을 읽었습니다. 분류를 확인하고 추가하세요.' : '읽을 수 있는 내역이 없습니다. 줄마다 날짜·가맹점·금액이 있는지 확인하세요.', rows.length ? '' : 'err');
      return;
    }
    if (t.closest('#pasteClear')) { st.paste = null; renderLedger(); return; }
    if (t.closest('#pasteAdd')) { addPasted(); return; }
    if (t.closest('[data-ldel]')) {
      const id = t.closest('[data-lid]').dataset.lid;
      if (!confirm('이 내역을 삭제할까요?')) return;
      try { await api('del', { tab: 'Ledger', id }); st.data.Ledger = st.data.Ledger.filter(r => String(r.id) !== id); st.dirty = true; renderLedger(); toast('삭제했습니다.'); } catch (err) { toast('삭제하지 못했습니다: ' + err.message, 'err'); }
      return;
    }
    if (t.closest('#applyAvg')) {
      const bc = A.budgetCap(st.data, st.sim, st.data.Ledger || [], new Date());
      if (!(bc.avgVar > 0)) return;
      try { await saveSettingValue('variable_override', Math.round(bc.avgVar), '가계부 최근 평균 생활비'); status('저장됨'); toast('미래 계산의 생활비를 월 ' + Math.round(bc.avgVar) + '만원으로 바꿨습니다.'); } catch (err) { toast(err.message, 'err'); }
      return;
    }
    if ((b = t.closest('[data-apply]'))) { if (confirm('이 선택을 기본 계획으로 확정할까요? (설정에 저장되고 언제든 바꿀 수 있습니다)')) applyScenario(b.dataset.apply); return; }
    if (t.closest('#scnCalc')) {
      const sc = scnState();
      if (st.subs.analysis === 'tesla') { sc.pct = Math.max(0, Math.min(100, readNum('scPct'))); sc.rate = readNum('scRate'); sc.term = Math.max(1, readNum('scTerm')); const to = ($('#scTo').value || '').trim(); if (/^\d{4}-\d{2}$/.test(to)) sc.toYm = to; }
      else { sc.target = readNum('sTarget'); sc.deposit = readNum('sDep'); sc.rent = readNum('sRent'); sc.rentDep = readNum('sRentDep'); sc.sellYm = ($('#sYm').value || '').trim(); }
      render(); return;
    }
    if (t.closest('#priceRefresh')) {
      const btn = t.closest('#priceRefresh'); btn.disabled = true; $('#priceMsg').textContent = '갱신 중… (최대 20초)'; status('시세 갱신 중…');
      try {
        const r = await api('refresh');
        if (r.holdings) { st.data.Holdings = r.holdings; st.meta = r.meta || {}; st.dirty = true; }
        status(''); render();
        const res = r.result || {};
        toast(res.skipped ? res.message : (res.message || '완료') + ((res.failed || []).length ? ' · 조회 실패: ' + res.failed.join(', ') : ''), (res.failed || []).length || (res.warnings || []).length ? 'err' : '');
      } catch (err) { status(''); btn.disabled = false; $('#priceMsg').textContent = '실패: ' + err.message; }
      return;
    }
    if (t.closest('#fillSymbols')) {
      let n = 0;
      (st.data.Holdings || []).forEach(h => { const k = String(h.name || '').trim(); if (!String(h.symbol || '').trim() && KNOWN_SYMBOLS[k]) { h.symbol = KNOWN_SYMBOLS[k]; queueSave('Holdings', h); n++; } });
      st.dirty = true; render();
      toast(n ? n + '개 종목에 코드를 채웠습니다. 목록에 없는 종목은 직접 입력하세요.' : '채울 수 있는 종목이 없습니다 (종목 이름이 같을 때만 채웁니다).');
      return;
    }
    if (t.closest('#copyInvite')) {
      const inp = $('#inviteLink'); inp.select();
      let ok = false;
      try { await navigator.clipboard.writeText(inp.value); ok = true; } catch (err) { try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ } }
      $('#copyMsg').textContent = ok ? '복사했습니다' : '길게 눌러 직접 복사하세요';
      return;
    }
    if (t.closest('#simRun') || t.closest('#simSave')) {
      st.over = {};
      main.querySelectorAll('[data-sim]').forEach(i => { const v = i.value.trim(); if (v !== '' && !isNaN(Number(v))) st.over[i.dataset.sim] = Number(v); });
      if (t.closest('#simSave')) {
        try { for (const k of Object.keys(st.over)) await saveSettingValue(k, st.over[k]); st.over = {}; status('저장됨'); toast('가정을 저장했습니다.'); } catch (err) { toast(err.message, 'err'); }
      }
      render(); return;
    }
    if (t.closest('#simReset')) { st.over = {}; render(); return; }
  });
  main.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'lgAmt') addLedger(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (st.data) render(); });

  /* ---------- 돌아왔을 때 조용히 새로고침 ---------- */
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !st.data || st.local || Date.now() - (st.loadedAt || 0) < 15 * 60 * 1000) return;
    try {
      const r = await api('all');
      st.data = r.data; st.meta = r.meta || {}; st.loadedAt = Date.now(); st.dirty = true;
      const typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (!typing && ['home', 'flow', 'analysis'].indexOf(st.tab) >= 0) { const y = window.scrollY; render(); window.scrollTo(0, y); }
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
  window.__AM = { st, go, runRecurring, start: data => { st.local = true; st.data = data; st.dirty = true; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); renderTabs(); render(); } };
  if (window.__TEST_DATA) { window.__AM.start(window.__TEST_DATA); return; }
  if (getToken() && localStorage.getItem('am_api')) loadAll().catch(() => showLogin(''));
  else showLogin('');
})();
