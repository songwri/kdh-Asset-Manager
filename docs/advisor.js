/* 규칙 기반 추천 · 가계부 분석 (금액 단위: 만원). 투자 권유가 아니라 점검용 참고 자료입니다. */
(function (g) {
  'use strict';
  const E = g.Engine || require('./engine.js');
  const { num, isActive, isY, idxOf, ymOf } = E;

  function fm(v) {
    const a = Math.abs(v);
    if (a >= 10000) return (v / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
    return Math.round(v).toLocaleString('ko-KR') + '만';
  }
  const pct = x => (x * 100).toFixed(1) + '%';

  /* ---------- 투자 보유 종목 점검 ---------- */
  function holdingsReport(data) {
    const rows = (data.Holdings || []).filter(h => isActive(h.active)).map(h => {
      const cost = num(h.qty, 0) * num(h.avg_price, 0) / 10000;
      const value = num(h.qty, 0) * num(h.price, 0) / 10000;
      return Object.assign({}, h, { cost, value, pnl: cost > 0 ? (value - cost) / cost : 0 });
    });
    const total = rows.reduce((s, r) => s + r.value, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    rows.forEach(r => {
      r.weight = total > 0 ? r.value / total : 0;
      r.loss = r.value - r.cost;
      r.flags = [];
      if (r.pnl <= -0.6) r.flags.push('손실 -60% 이하');
      else if (r.pnl <= -0.4) r.flags.push('손실 -40% 이하');
      if (r.weight >= 0.3) r.flags.push('비중 30% 이상');
      if (r.pnl <= -0.4 && !String(r.thesis || '').trim()) r.flags.push('보유 사유 미기재');
      if (/커버드콜/.test(r.name)) r.flags.push('커버드콜: 상승 제한');
    });
    const sectors = {};
    rows.forEach(r => { const k = r.sector || '미분류'; sectors[k] = (sectors[k] || 0) + r.value; });
    const sectorList = Object.keys(sectors).map(k => ({ sector: k, value: sectors[k], weight: total > 0 ? sectors[k] / total : 0 }))
      .sort((a, b) => b.value - a.value);
    const lossTotal = rows.reduce((s, r) => s + Math.min(0, r.loss), 0);
    return { rows, total, totalCost, pnl: totalCost > 0 ? (total - totalCost) / totalCost : 0, sectorList, lossTotal };
  }

  /* ---------- 대출 중도상환 효과 ---------- */
  function prepayEffect(P, ratePct, n, extra) {
    const r = ratePct / 1200, pm = E.payment(P, r, n);
    const run = ex => {
      let bal = P, m = 0, intr = 0;
      while (bal > 1e-6 && m < n + 1) {
        const i = bal * r; intr += i;
        bal -= Math.min(bal, pm - i + ex); m++;
      }
      return { months: m, interest: intr };
    };
    const a = run(0), b = run(extra);
    return { pmt: pm, base: a, extra: b, saved: a.interest - b.interest, monthsSaved: a.months - b.months };
  }

  /* ---------- 가계부 ---------- */
  const isFixedCat = c => /^고정/.test(String(c || ''));
  const toMan = v => num(v, 0) / 10000;

  function monthStats(ledger, ym) {
    const rows = (ledger || []).filter(r => String(r.date || '').slice(0, 7) === ym && r.type !== 'income');
    const byCat = {};
    let total = 0, fixed = 0, variable = 0;
    rows.forEach(r => {
      const a = toMan(r.amount);
      total += a;
      byCat[r.category || '기타'] = (byCat[r.category || '기타'] || 0) + a;
      if (isFixedCat(r.category)) fixed += a; else variable += a;
    });
    return { ym, total, fixed, variable, byCat, count: rows.length };
  }

  function ledgerMonths(ledger) {
    const set = {};
    (ledger || []).forEach(r => { const m = String(r.date || '').slice(0, 7); if (m) set[m] = 1; });
    return Object.keys(set).sort();
  }

  function curIdx(sim, now) {
    const idx = now.getFullYear() * 12 + now.getMonth();
    return Math.max(0, Math.min(sim.N - 2, idx - sim.start));
  }

  /** 다음 달 변동지출 상한 + 카테고리별 권장 */
  function budgetCap(data, sim, ledger, now) {
    const S = sim.S;
    const t = curIdx(sim, now), nt = t + 1;
    const mk = k => {
      const inc = sim.income[k], fx = sim.expFixed[k], dp = sim.debtPay[k];
      const save = inc * S.save_rate_target / 100;
      return { ym: sim.ym[k], income: inc, fixed: fx, debt: dp, save, cap: Math.max(0, inc - fx - dp - save) };
    };
    const cur = mk(t), next = mk(nt);
    // 큰 지출로 현금이 경고선 아래로 내려갈 달이 있으면, 그 전까지 추가로 줄여야 할 금액을 상한에서 뺀다
    const tight = k0 => {
      for (let k = k0; k < Math.min(sim.N, k0 + 13); k++) {
        if (sim.low[k] < S.liquidity_floor) return { amt: (S.liquidity_floor - sim.low[k]) / (k - k0 + 1), ym: sim.ym[k] };
      }
      return { amt: 0, ym: null };
    };
    [[cur, t], [next, nt]].forEach(([o, k]) => { const x = tight(k); o.tighten = x.amt; o.tightenYm = x.ym; o.cap = Math.max(0, o.cap - x.amt); });
    const months = ledgerMonths(ledger);
    const curYm = sim.ym[t];
    const past = months.filter(m => m < curYm).slice(-3);
    const stats = past.map(m => monthStats(ledger, m));
    const thisMonth = monthStats(ledger, curYm);
    const catSet = {};
    stats.concat([thisMonth]).forEach(s => Object.keys(s.byCat).forEach(c => { if (!isFixedCat(c)) catSet[c] = 1; }));
    const cats = Object.keys(catSet);
    const avgVar = stats.length ? stats.reduce((s, x) => s + x.variable, 0) / stats.length : null;
    const catRows = cats.map(c => {
      const avg = stats.length ? stats.reduce((s, x) => s + (x.byCat[c] || 0), 0) / stats.length : 0;
      const last = stats.length ? (stats[stats.length - 1].byCat[c] || 0) : 0;
      return { cat: c, thisMonth: thisMonth.byCat[c] || 0, last, avg };
    });
    const sumAvg = catRows.reduce((s, r) => s + r.avg, 0);
    const scale = sumAvg > 0 ? Math.min(1, next.cap / sumAvg) : 1;
    catRows.forEach(r => { r.rec = r.avg * scale; });
    return { cur, next, thisMonth, past, avgVar, catRows, scale, hasData: stats.length > 0 || thisMonth.count > 0 };
  }

  /* ---------- 월 잉여금 배분 ---------- */
  function allocate(surplus, o) {
    let s = Math.max(0, surplus);
    const rows = [];
    const take = (name, amt, why) => {
      amt = Math.max(0, Math.min(s, Math.round(amt)));
      if (amt > 0) { rows.push({ name, amt, why }); s -= amt; }
    };
    if (o.liquidityRisk) {
      take('현금 버퍼(입출금·단기예금)', s, '큰 지출(계약금·중도금·잔금)을 앞두고 있어 전액 현금으로 보유');
      return rows;
    }
    if (o.emergencyGap > 0) take('비상금 보충', Math.min(s * 0.5, o.emergencyGap / 12), '비상금이 목표(생활비 ' + o.emergencyMonths + '개월)에 못 미침');
    take('IRP·연금저축', Math.min(75, s * 0.3), '연 900만원 한도 세액공제(13.2~16.5%) = 사실상 확정 수익');
    take('자녀 명의 적립', Math.min(10, s * 0.08), '장기 적립식. 10년 2,000만원 증여공제 안에서 시작');
    const rest = s;
    take('대출 중도상환', rest * 0.6, '대출금리 4.5%는 확정 수익과 같음 (수수료 면제 시점 확인)');
    take('ISA·분산 ETF 투자', s, 'ISA(일반형 비과세 200만원) 우선, 지수형 ETF 중심');
    return rows;
  }

  /* ---------- 종합 조언 ---------- */
  function advise(data, sim, ctx) {
    const S = sim.S;
    const cards = [];
    const add = (level, tag, title, body, list) => cards.push({ level, tag, title, body, list: list || [] });
    const now = ctx.now || new Date();
    const hr = holdingsReport(data);

    // 1. 유동성
    const horizon = Math.min(24, sim.N);
    let minCash = Infinity, minT = 0;
    for (let t = 0; t < horizon; t++) if (sim.low[t] < minCash) { minCash = sim.low[t]; minT = t; }
    const liquidityRisk = minCash < S.liquidity_floor * 2;
    if (minCash < S.liquidity_floor) {
      add('risk', '유동성', sim.ym[minT] + ' 월중 현금 저점 약 ' + fm(minCash) + ' — 경고선(' + fm(S.liquidity_floor) + ') 아래',
        '큰 지출일(예: 11월 중순 계약금)이 월급일(25일)보다 앞선다고 보고, 지출의 절반만 나간 시점으로 추정한 값입니다(월말 잔액 ' + fm(sim.cash[minT]) + '). 아래 순서로 대비하세요.',
        ['큰 지출 직전 월의 변동지출을 평소보다 줄이기 (가계부로 관리)',
          '전세 일부 반환·인센티브·중금채 만기 날짜가 지출일보다 앞서는지 확인',
          '일반계좌 주식 평가액 ' + fm(hr.total) + ' 중 보유 사유가 약한 종목을 정리해 현금화하는 방안 검토',
          '비상금 ' + fm(sim.reserve[0]) + '은 마지막 수단. 먼저 건드리지 않기']);
    } else if (minCash < S.liquidity_floor * 2) {
      add('warn', '유동성', sim.ym[minT] + ' 월중 현금 저점 약 ' + fm(minCash) + ' — 여유가 크지 않음', '예상치 못한 지출이 생기면 바로 경고선에 닿습니다. 변동지출을 보수적으로 운영하세요.');
    } else {
      add('ok', '유동성', '향후 2년 월중 현금 저점 ' + fm(minCash) + ' (' + sim.ym[minT] + ')', '경고선 이상을 유지합니다.');
    }

    // 2. 비상금
    const tMo = Math.min(sim.N - 1, 8);
    const monthly = sim.expFixed[tMo] + sim.expVar[tMo] + sim.debtPay[tMo];
    const target = S.emergency_months * monthly;
    const reserve = sim.reserve[0];
    const gap = Math.max(0, target - reserve);
    if (gap > 0) add('warn', '비상금', '비상금 ' + fm(reserve) + ' / 목표 ' + fm(target), '입주 후 월 필수지출 약 ' + fm(monthly) + ' 기준 ' + S.emergency_months + '개월치입니다. 약 ' + fm(gap) + ' 부족합니다.');
    else add('ok', '비상금', '비상금 ' + fm(reserve) + ' ≥ 목표 ' + fm(target), '입주 후 월 필수지출 약 ' + fm(monthly) + ' 기준 ' + S.emergency_months + '개월치를 충족합니다.');

    // 3. 투자 포트폴리오
    if (hr.rows.length) {
      const bad = hr.rows.filter(r => r.pnl <= -0.4).sort((a, b) => a.pnl - b.pnl);
      const top = hr.sectorList[0];
      const items = [];
      const stock = hr.rows.filter(r => r.account !== 'ISA');
      const stockTotal = stock.reduce((s, r) => s + r.value, 0), stockCost = stock.reduce((s, r) => s + r.cost, 0);
      if (stock.length) items.push('일반계좌 ' + stock.length + '종목: 매입 ' + fm(stockCost) + ' → 평가 ' + fm(stockTotal) + ' (' + pct(stockCost > 0 ? (stockTotal - stockCost) / stockCost : 0) + ')');
      if (top && top.weight >= 0.4) items.push('가장 큰 섹터 "' + top.sector + '" 비중 ' + pct(top.weight));
      bad.forEach(r => items.push(r.name + ': ' + pct(r.pnl) + ' (비중 ' + pct(r.weight) + ')' + (r.thesis ? ' — 사유: ' + r.thesis : ' — 보유 사유를 적어두세요')));
      items.push('판단 기준은 "이미 난 손실"이 아니라 "지금 이 종목을 새로 산다면 사겠는가". 국내 직접상장 주식은 양도세가 없어 손실 확정의 세금 이득도 손해도 없습니다.');
      items.push('대출금리 ' + (E.num((data.Debts || [])[0] && data.Debts[0].rate, 4.5)) + '%는 확정 수익률과 같습니다. 반등을 기다리는 돈이 현금이 필요한 시점과 충돌하는지 먼저 확인하세요.');
      add(bad.length ? 'warn' : 'info', '투자 점검', '보유 종목 점검 (전체 ' + pct(hr.pnl) + ')', '종목별 판단은 [투자] 탭의 지표를 참고하세요. 특정 종목의 매도/보유를 대신 정하지는 않습니다.', items);
    }

    // 4. ISA
    const isa = hr.rows.filter(r => r.account === 'ISA');
    if (isa.length) {
      const cc = isa.filter(r => /커버드콜/.test(r.name));
      add(cc.length ? 'warn' : 'info', 'ISA', cc.length ? 'ISA에 커버드콜 ETF가 있습니다' : 'ISA 운용 메모',
        '일반형은 비과세 한도 200만원, 초과분 9.9% 분리과세, 의무 가입 3년, 연 납입 한도 2,000만원입니다. 해외지수 ETF처럼 오래 묻어둘 자산을 ISA에 담는 것이 세금상 유리합니다.',
        cc.length ? ['커버드콜은 상승 구간 수익이 제한되므로, 장기 성장이 목적이면 지수형 ETF가 더 어울립니다.'] : []);
    }

    // 5. 대출 vs 투자
    const mort = (data.Debts || []).filter(d => isActive(d.active)).sort((a, b) => num(b.principal, 0) - num(a.principal, 0))[0];
    if (mort && num(mort.rate, 0) >= 3 && num(mort.term, 0) > 12) {
      const pe = prepayEffect(num(mort.principal, 0), num(mort.rate, 0), num(mort.term, 360), 50);
      const pe2 = prepayEffect(num(mort.principal, 0), num(mort.rate, 0), num(mort.term, 360), 100);
      add('info', '대출', '월 원리금 ' + fm(pe.pmt) + ' · 매달 50만원 추가상환 시 이자 ' + fm(pe.saved) + ' 절감',
        '금리 ' + mort.rate + '%의 대출 상환은 위험 없는 ' + mort.rate + '% 수익과 같습니다. 대출액이 클수록 효과가 큽니다.',
        ['추가상환 50만원/월: ' + Math.floor(pe.monthsSaved / 12) + '년 ' + (pe.monthsSaved % 12) + '개월 단축, 이자 ' + fm(pe.saved) + ' 절감',
          '추가상환 100만원/월: ' + Math.floor(pe2.monthsSaved / 12) + '년 ' + (pe2.monthsSaved % 12) + '개월 단축, 이자 ' + fm(pe2.saved) + ' 절감',
          '중도상환수수료는 보통 대출 후 3년 이내에 부과됩니다. 은행 조건을 먼저 확인하세요.',
          '필요한 대출액 5억 vs 6억: 1억을 덜 받으면 연 이자 약 ' + fm(num(mort.rate, 0) * 100) + ' 절감 (은행에서 필요 자금 기준 한도 확인).']);
    }

    // 6. 휴직 기간
    const lo = sim.ym.indexOf('2027-02'), hi = sim.ym.indexOf('2027-07');
    if (lo >= 0 && hi >= lo) {
      let s = 0;
      for (let t = lo; t <= hi; t++) s += sim.income[t] - sim.expFixed[t] - sim.expVar[t] - sim.debtPay[t];
      add(s / (hi - lo + 1) < 100 ? 'warn' : 'info', '휴직', '와이프 휴직 기간(27.2~7) 월 평균 잉여 ' + fm(s / (hi - lo + 1)),
        '입주·대출 상환이 겹치는 시기입니다. 이 기간에는 투자 납입을 멈추고 현금 흐름을 우선하세요.');
    }

    // 7. 자녀
    const childRows = (data.Expenses || []).filter(r => isActive(r.active) && String(r.category) === '교육');
    if (childRows.length) {
      let total = 0, peak = 0, collegeStart = null, collegeCost = 0;
      for (let t = 0; t < sim.N; t++) {
        let m = 0, col = 0;
        childRows.forEach(r => {
          const a = E.expenseAt(r, sim.start + t, S, t, 1);
          m += a; if (/대학/.test(r.name)) col += a;
        });
        total += m; peak = Math.max(peak, m); collegeCost += col;
        if (col > 0 && collegeStart == null) collegeStart = t;
      }
      const items = [
        '입력된 가정 기준 유치원~대학 교육비 합계(물가 반영) 약 ' + fm(total) + ', 월 최대 ' + fm(peak),
        '아동수당(월 10만원)은 교육비 전용 계좌로 자동이체해 두면 따로 관리하지 않아도 쌓입니다.',
        '증여: 미성년 자녀는 10년간 2,000만원까지 증여세가 없습니다. 지금은 집 구입 때문에 현금이 빠듯하니 입주·대출 안정 후(2027년 하반기~) 월 10만원 적립식부터 시작하세요.',
      ];
      if (collegeStart != null && collegeStart > 12) {
        const months = collegeStart, r = Math.pow(1 + S.invest_return / 100, 1 / 12) - 1;
        const need = collegeCost;
        const pm = need * r / (Math.pow(1 + r, months) - 1);
        items.push('대학 4년 비용(미래가치 약 ' + fm(need) + ')을 별도로 준비한다면 지금부터 월 ' + fm(pm) + ' 적립 필요 (수익률 ' + S.invest_return + '% 가정). 교육비는 월 현금흐름으로 감당하는 안과 비교하세요.');
      }
      add('info', '자녀', '양육·교육비 계획', '초등 이후 교육비는 임의 가정입니다. [입력 > 지출]에서 수정하면 모든 계산에 반영됩니다.', items);
    }

    // 8. 세액공제
    add('info', '절세', 'IRP·연금저축 세액공제', '연 900만원까지 납입액의 13.2%(총급여 5,500만원 초과 시) 또는 16.5%를 환급받습니다. 월 75만원이면 한도를 채웁니다. 현금이 빠듯한 시기에는 12월에 가능한 만큼만 넣고, 입주 후 여유가 생기면 정기 납입하세요.');

    // 9. 은퇴 시나리오
    if (ctx.scenarios && ctx.scenarios.length) {
      const base = ctx.scenarios.find(s => s.isBase) || ctx.scenarios[0];
      const items = ctx.scenarios.map(s => s.label + ': ' + (s.depleteAge ? '금융자산 ' + s.depleteAge + '세에 소진' : '90세 전후까지 소진 없음') + ' · 65세 순자산 ' + fm(s.nw65));
      items.push('집 매각·주택연금, 국민연금 실제 수령액, 연금저축 수령은 반영하지 않았습니다. 보수적인 수치입니다.');
      add(base.depleteAge ? 'warn' : 'info', '은퇴', '은퇴 시기별 비교', '[시뮬레이션] 탭에서 나이를 바꿔 직접 비교해 보세요.', items);
    }

    // 10. 월 잉여금 배분
    const tSteady = Math.min(sim.N - 13, Math.max(0, sim.ym.indexOf('2027-09')));
    let sSum = 0;
    for (let t = tSteady; t < tSteady + 12; t++) sSum += sim.income[t] - sim.expFixed[t] - sim.expVar[t] - sim.debtPay[t];
    const steadySurplus = sSum / 12;
    const nowT = curIdx(sim, now);
    const nowSurplus = sim.income[nowT + 1] - sim.expFixed[nowT + 1] - sim.expVar[nowT + 1] - sim.debtPay[nowT + 1];
    const allocNow = allocate(nowSurplus, { liquidityRisk, emergencyGap: gap, emergencyMonths: S.emergency_months });
    const allocSteady = allocate(steadySurplus, { liquidityRisk: false, emergencyGap: gap, emergencyMonths: S.emergency_months });

    return { cards, holdings: hr, allocNow, allocSteady, nowSurplus, steadySurplus, liquidityRisk, minCash, minYm: sim.ym[minT] };
  }

  const api = { fm, pct, holdingsReport, prepayEffect, monthStats, ledgerMonths, budgetCap, allocate, advise, isFixedCat, curIdx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  g.Advisor = api;
})(typeof window !== 'undefined' ? window : globalThis);
