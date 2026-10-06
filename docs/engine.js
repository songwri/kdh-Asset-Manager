/* 월별 시뮬레이션 엔진 (금액 단위: 만원). 브라우저/Node 공용 */
(function (g) {
  'use strict';

  const DEFAULTS = {
    sim_start: '2026-10', years: 30,
    birth_me: 1988, birth_wife: 1988, retire_age_me: 57, retire_age_wife: 50,
    inflation: 2.5, salary_growth: 3, invest_return: 5, cash_rate: 2.5,
    house_mean: 5, house_vol: 6, house_seed: 17,
    buffer_months: 3, sweep_pct: 100, emergency_months: 6, save_rate_target: 20,
    liquidity_floor: 500, child_birth_year: 2022,
    house_purchase_ym: '2027-03', house_price: 102000, variable_override: 0,
    house_target: 200000, move_in_ym: '2027-04', sell_ym: '', sell_mode: 'jeonse', sell_fee_pct: 0.77,
    house_basis_extra: 4101, house_capex: 700, after_deposit: 60000, after_rent: 150, after_rent_deposit: 5000,
    tesla: 'buy', tesla_fin_pct: 0, tesla_rate: 6, tesla_term: 60,
    name_me: '', name_wife: '', name_child: '',
    no_draw: 0, // 1이면 현금이 모자라도 투자·비상금에서 꺼내지 않고 마이너스로 둔다(사실 기반 현금표용)
  };

  const num = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v));
  const isY = v => /^(y|yes|true|1)$/i.test(String(v == null ? '' : v).trim());
  const isActive = v => !/^(n|no|false|0)$/i.test(String(v == null ? '' : v).trim());
  const idxOf = s => {
    const m = /^(\d{4})-(\d{1,2})/.exec(String(s == null ? '' : s));
    return m ? (+m[1]) * 12 + (+m[2] - 1) : null;
  };
  const ymOf = i => Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');

  function settings(data, over) {
    const S = Object.assign({}, DEFAULTS);
    (data.Settings || []).forEach(r => {
      if (!(r.id in DEFAULTS)) return;
      const d = DEFAULTS[r.id];
      if (typeof d === 'number') S[r.id] = num(r.value, d);
      else if (String(r.value).trim()) S[r.id] = String(r.value).trim();
    });
    return Object.assign(S, over || {});
  }

  function inRange(row, idx) {
    if (!isActive(row.active)) return false;
    const s = idxOf(row.start), e = idxOf(row.end);
    if (s != null && idx < s) return false;
    if (e != null && idx > e) return false;
    return true;
  }

  function hits(row, idx) {
    if (!inRange(row, idx)) return false;
    const kind = String(row.kind || 'monthly');
    if (kind === 'yearly') {
      const ms = String(row.months || '').split(/[,\s]+/).filter(Boolean).map(Number);
      return ms.indexOf((idx % 12) + 1) >= 0;
    }
    if (kind === 'once') return idxOf(row.start) === idx;
    return true;
  }

  function incomeAt(row, idx, S, t) {
    if (!hits(row, idx)) return 0;
    const y = Math.floor(idx / 12);
    if (isY(row.retire_stop)) {
      const wife = row.owner === 'wife';
      const age = y - (wife ? S.birth_wife : S.birth_me);
      if (age >= (wife ? S.retire_age_wife : S.retire_age_me)) return 0;
    }
    const pf = idxOf(row.pause_from), pt = idxOf(row.pause_to);
    if (pf != null && idx >= pf && (pt == null || idx <= pt)) return 0;
    let a = num(row.amount, 0);
    if (isY(row.grow)) a *= Math.pow(1 + S.salary_growth / 100, Math.floor(t / 12));
    else if (/^i$/i.test(String(row.grow || '').trim())) a *= Math.pow(1 + S.inflation / 100, t / 12);
    return a;
  }

  /** 고정 지출 중 분류가 '저축'인 항목 = 매달 적금에 넣는 돈 */
  const isSaving = r => String(r.category || '').trim() === '저축';

  function expenseAt(row, idx, S, t, varScale) {
    if (!hits(row, idx)) return 0;
    let a = num(row.amount, 0);
    if (isY(row.variable)) a *= varScale;
    if (isY(row.inflate)) a *= Math.pow(1 + S.inflation / 100, t / 12);
    return a;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 연도별 집값 변동률: 평균이 mean이 되도록 보정한 변동 경로 (호황/정체/하락이 섞임) */
  function houseRates(mean, vol, seed, n) {
    const rnd = mulberry32(seed | 0);
    const gauss = () => {
      const u = Math.max(rnd(), 1e-9), v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const raw = [];
    for (let i = 0; i < n; i++) raw.push(Math.max(-12, Math.min(20, mean + vol * gauss())));
    const shift = mean - raw.reduce((a, b) => a + b, 0) / n;
    return raw.map(x => (x + shift) / 100);
  }

  function amortBalance(P, r, n, k) {
    if (r === 0) return P * (n - k) / n;
    const a = Math.pow(1 + r, n), b = Math.pow(1 + r, k);
    return P * (a - b) / (a - 1);
  }
  const payment = (P, r, n) => (r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n)));

  /** 1세대 1주택 양도세 개략 추정 (만원). 실제 세액은 세무사 확인 필요 */
  const BRACKETS = [[1400, 0.06, 0], [5000, 0.15, 126], [8800, 0.24, 576], [15000, 0.35, 1544], [30000, 0.38, 1994], [50000, 0.40, 2594], [100000, 0.42, 3594], [Infinity, 0.45, 6594]];
  function sellTax(S, price, saleIdx) {
    const pIdx = idxOf(S.house_purchase_ym);
    const mi = idxOf(S.move_in_ym);
    const mIdx = mi == null ? pIdx : mi;
    const holdY = (saleIdx - pIdx) / 12, residY = (saleIdx - mIdx) / 12;
    const fee = price * S.sell_fee_pct / 100;
    const basis = S.house_price + S.house_basis_extra + S.house_capex;
    const gain = Math.max(0, price - basis - fee);
    let taxable = gain, ltRate = 0, exempt = false;
    if (holdY >= 2 && residY >= 2) {
      exempt = true;
      taxable = price > 120000 ? gain * (price - 120000) / price : 0;
      const hr = holdY >= 3 ? Math.min(0.4, 0.04 * Math.floor(holdY)) : 0;
      const rr = Math.min(0.4, 0.04 * Math.floor(residY));
      ltRate = hr + rr;
      taxable *= 1 - ltRate;
    }
    const base = Math.max(0, taxable - 250);
    let tax = 0;
    for (let i = 0; i < BRACKETS.length; i++) if (base <= BRACKETS[i][0]) { tax = base * BRACKETS[i][1] - BRACKETS[i][2]; break; }
    tax = Math.max(0, tax) * 1.1;
    return { price, fee, basis, gain, holdY, residY, exempt, ltRate, taxable, tax };
  }

  function simulate(data, over) {
    const S = settings(data, over);
    const N = Math.round(S.years * 12);
    const start = idxOf(S.sim_start);
    const rm = Math.pow(1 + S.invest_return / 100, 1 / 12) - 1;
    const cm = (Math.pow(1 + S.cash_rate / 100, 1 / 12) - 1) * (1 - 0.154);
    const hRates = houseRates(S.house_mean, S.house_vol, S.house_seed, Math.ceil(N / 12) + 1);

    // 기초 잔액
    let cash = 0, reserve = 0, invest = 0, re = 0, lease = 0, prepaid = 0, other = 0, car = 0;
    (data.Assets || []).forEach(a => {
      if (!isActive(a.active)) return;
      const v = num(a.value, 0), c = String(a.category || '').toLowerCase();
      const liquidN = /^(n|no|false|0)$/i.test(String(a.liquid == null ? '' : a.liquid).trim());
      if (c === 'cash' || c === 'deposit') { if (liquidN) reserve += v; else cash += v; }
      else if (c === 'emergency') reserve += v;
      else if (c === 'lease') lease += v;
      else if (c === 'prepaid') prepaid += v;
      else if (c === 'car') { if (S.tesla !== 'skip') car += v; }
      else if (c === 'real_estate') re += v;
      else if (['invest', 'isa', 'irp', 'pension', 'stock', 'fund'].indexOf(c) >= 0) invest += v;
      else other += v;
    });
    (data.Holdings || []).forEach(h => {
      if (isActive(h.active)) invest += num(h.qty, 0) * num(h.price, 0) / 10000;
    });

    // 부채
    const debts = (data.Debts || []).filter(d => isActive(d.active) && !(S.tesla === 'skip' && /테슬라/.test(String(d.name)))).map(d => {
      const P = num(d.principal, 0), r = num(d.rate, 0) / 1200, n = Math.max(1, num(d.term, 1));
      const s = idxOf(d.start);
      const disburse = isY(d.disburse);
      let bal = 0;
      if (s != null && s < start) {
        const k = Math.max(0, Math.min(n, start - s - 1));
        bal = amortBalance(P, r, n, k);
      } else if (!disburse) bal = P;
      return { name: d.name, P, r, n, s: s == null ? start : s, disburse, bal, pmt: payment(P, r, n), bad: disburse && s == null };
    }).filter(d => !d.bad); // 실행 월이 없는 대출은 계산에서 빼고 화면에서 경고

    // 이벤트
    const evByIdx = {};
    (data.Events || []).forEach(e => {
      if (!isActive(e.active)) return;
      if (S.tesla === 'skip' && String(e.category) === 'car') return;
      const i = idxOf(e.date);
      if (i == null) return;
      (evByIdx[i] = evByIdx[i] || []).push(e);
    });
    const evNetAt = i => (evByIdx[i] || []).reduce((s, e) => s + num(e.amount, 0), 0);

    const purchaseIdx = idxOf(S.house_purchase_ym);
    let house = 0;
    const sellIdx = idxOf(S.sell_ym);
    let sold = false, saleInfo = null;
    if (S.tesla === 'buy' && S.tesla_fin_pct > 0) {
      let amt = 0, when = null;
      (data.Events || []).forEach(e => {
        if (isActive(e.active) && String(e.category) === 'car' && num(e.amount, 0) < 0 && /잔금/.test(String(e.name))) { amt += -num(e.amount, 0); when = idxOf(e.date); }
      });
      const P = amt * S.tesla_fin_pct / 100;
      if (P > 0 && when != null) {
        const r = S.tesla_rate / 1200, n = Math.max(1, S.tesla_term);
        debts.push({ name: '테슬라 할부(가정)', P, r, n, s: when, disburse: true, bal: 0, pmt: payment(P, r, n) });
      }
    }

    const varRows = (data.Expenses || []).filter(r => isActive(r.active) && isY(r.variable) && String(r.kind || 'monthly') === 'monthly');
    const varBase = varRows.reduce((s, r) => s + num(r.amount, 0), 0);
    const varScale = S.variable_override > 0 && varBase > 0 ? S.variable_override / varBase : 1;

    let prevCash = cash;
    const out = {
      S, start, N, ym: [], t: [], ageMe: [], cash: [], reserve: [], invest: [], house: [], re: [], lease: [], prepaid: [], other: [], car: [],
      debt: [], networth: [], income: [], expFixed: [], expVar: [], debtPay: [], events: [], short: [], drawn: [],
      houseRates: hRates, low: [], save: [], evCat: [], disb: [], interest: [], sweep: [], sale: null,
      open: { cash, reserve, invest, lease, prepaid, car, other, re },
    };

    for (let t = 0; t < N; t++) {
      const idx = start + t;
      const y = Math.floor(idx / 12);

      let inc = 0;
      (data.Income || []).forEach(r => { inc += incomeAt(r, idx, S, t); });
      let expF = 0, expV = 0, save = 0;
      (data.Expenses || []).forEach(r => {
        if (sold && String(r.category) === '세금') return;
        if (S.tesla === 'skip' && /테슬라/.test(String(r.name))) return;
        const a = expenseAt(r, idx, S, t, varScale);
        if (isSaving(r)) save += a;           // 적금 납입: 현금 → 적금으로 옮길 뿐 비용이 아니다
        else if (isY(r.variable)) expV += a; else expF += a;
      });
      if (sold && S.sell_mode === 'rent') expF += S.after_rent * Math.pow(1 + S.inflation / 100, t / 12);

      let dpay = 0, disb = 0, debtBal = 0;
      debts.forEach(d => {
        if (d.disburse && idx === d.s) { d.bal = d.P; disb += d.P; }
        if (!d.closed && idx >= d.s + 1 && idx <= d.s + d.n && d.bal > 1e-9) {
          const interest = d.bal * d.r;
          const princ = d.r === 0 ? d.P / d.n : Math.min(d.bal, d.pmt - interest);
          d.bal -= princ;
          dpay += interest + princ;
        }
        debtBal += d.bal;
      });

      let ev = 0;
      const evc = {};
      (evByIdx[idx] || []).forEach(e => {
        const a = num(e.amount, 0), c = String(e.category || '');
        ev += a; evc[c || 'other'] = (evc[c || 'other'] || 0) + a;
        if (c === 'lease_return') lease = Math.max(0, lease - a);
        if (c === 'house_pay' && a < 0) prepaid += -a;
        if (c === 'car') car = Math.max(0, car - a);
      });
      if (purchaseIdx != null && idx === purchaseIdx && S.house_price > 0) {
        house = S.house_price; prepaid = 0;
      }

      let saleCash = 0;
      if (sellIdx != null && idx === sellIdx && house > 0 && !sold) {
        const x = sellTax(S, house, idx);
        let repay = 0;
        debts.forEach(d => { if (d.disburse && d.bal > 0) { repay += d.bal; d.bal = 0; d.closed = true; } });
        debtBal = debts.reduce((q, d) => q + d.bal, 0);
        const dep = S.sell_mode === 'rent' ? S.after_rent_deposit : S.after_deposit;
        saleCash = x.price - x.fee - x.tax - repay - dep;
        lease += dep;
        saleInfo = Object.assign({}, x, { t, ym: ymOf(idx), repay, deposit: dep, net: x.price - x.fee - x.tax - repay, mode: S.sell_mode });
        house = 0; sold = true;
      }

      const lowCash = prevCash + Math.min(0, ev + disb) - 0.5 * (expF + expV + dpay + save);
      cash += inc - expF - expV - dpay - save + ev + disb + saleCash;
      reserve += save;

      const ci = cash > 0 ? cash * cm : 0, ri = reserve * cm;
      cash += ci; reserve += ri;
      invest *= 1 + rm;
      const hf = Math.pow(1 + hRates[Math.floor(t / 12)], 1 / 12);
      house *= hf;
      re *= hf;
      car *= Math.pow(0.88, 1 / 12);

      let drawn = 0, short = 0, moved = 0;
      if (cash < 0 && S.no_draw) {
        short = -cash;
      } else if (cash < 0) {
        let need = -cash;
        const fromInv = Math.min(invest, need); invest -= fromInv; need -= fromInv; drawn += fromInv;
        const fromRes = Math.min(reserve, need); reserve -= fromRes; need -= fromRes; drawn += fromRes;
        cash = -need; short = need;
        if (need === 0) cash = 0;
      } else if (S.sweep_pct > 0) {
        let fut = 0;
        for (let k = 1; k <= 12; k++) fut += evNetAt(idx + k);
        const keep = S.buffer_months * (expF + expV + dpay) + Math.max(0, -fut);
        if (cash > keep) {
          const mv = (cash - keep) * S.sweep_pct / 100;
          cash -= mv; invest += mv; moved = mv;
        }
      }

      prevCash = cash;
      out.low.push(Math.min(lowCash, cash));
      out.ym.push(ymOf(idx)); out.t.push(t); out.ageMe.push(y - S.birth_me);
      out.cash.push(cash); out.reserve.push(reserve); out.invest.push(invest);
      out.house.push(house); out.re.push(re); out.lease.push(lease); out.prepaid.push(prepaid); out.other.push(other); out.car.push(car);
      out.debt.push(debtBal);
      out.networth.push(cash + reserve + invest + house + re + lease + prepaid + other + car - debtBal);
      out.save.push(save);
      out.income.push(inc); out.expFixed.push(expF); out.expVar.push(expV); out.debtPay.push(dpay);
      out.events.push(ev); out.short.push(short); out.drawn.push(drawn);
      out.evCat.push(evc); out.disb.push(disb); out.interest.push(ci); out.sweep.push(moved);
    }
    out.sale = saleInfo;
    return out;
  }

  /** 은퇴 시나리오 비교용 요약 */
  function scenarioMetrics(data, over, label) {
    const sim = simulate(data, Object.assign({ years: 50 }, over));
    const S = sim.S;
    let depleteAge = null;
    for (let t = 0; t < sim.N; t++) if (sim.short[t] > 0.5) { depleteAge = sim.ageMe[t]; break; }
    let t65 = sim.N - 1;
    for (let t = 0; t < sim.N; t++) if (sim.ageMe[t] >= 65) { t65 = t; break; }
    const yrIdx = n => Math.min(sim.N - 1, Math.max(0, n));
    return {
      label, over, depleteAge,
      nw10: sim.networth[yrIdx(119)], nw20: sim.networth[yrIdx(239)],
      nw65: sim.networth[t65], nwEnd: sim.networth[sim.N - 1],
      fin65: sim.cash[t65] + sim.reserve[t65] + sim.invest[t65] - sim.debt[t65],
      endAge: sim.ageMe[sim.N - 1], S, sim,
    };
  }

  const api = { DEFAULTS, settings, simulate, sellTax, scenarioMetrics, houseRates, payment, amortBalance, num, isY, isActive, isSaving, idxOf, ymOf, hits, incomeAt, expenseAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  g.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
