/*
 * Calculation engine: household net income per country, then a year-by-year
 * simulation of monthly ETF investing under that country's investment taxes.
 *
 * Inputs (inp):
 *   role1, role2        'owner' | 'employee'
 *   profit1, profit2    company profit before owner pay (owners only)
 *   salary1, salary2    gross salary (for an owner: the salary taken from the company)
 *   hasPartner2         false = single person household
 *   optimizeSalary      pick the best salary/dividend split for each owner, per country
 *   kids, living, mode ('fixed' | 'all'), monthly, startCapital, returnPct, years,
 *   useWrappers, beVvprbis
 *   beRoyalty, bePension, beCompanyInvest   €/year through the company routes of a country that has them (c.routes)
 *   beHarvest                               realise the yearly tax-free gain allowance where a country has one (invest.harvest)
 *   beOptimize                              pick the route amounts that give the most final wealth (bePension = ceiling)
 *   adjustLiving, livingRef, pli_XX         scale living costs by each country's price level
 */
(function (root) {
  'use strict';

  const DIV_YIELD = 0.015; // assumed internal dividend yield of a global equity ETF
  const pos = x => Math.max(0, x);

  /** Largest owner salary the company can pay (salary + employer contributions ≤ profit). */
  function maxOwnerSalary(c, profit) {
    const ownerSS = c.ownerSS || c.employeeSS;
    let lo = 0, hi = profit;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (mid + ownerSS(mid).er <= profit) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** The partners of the household as {role, profit, salary}, partner 2 only if present. */
  function partners(inp) {
    const list = [{ role: inp.role1, profit: inp.profit1, salary: inp.salary1 }];
    if (inp.hasPartner2) list.push({ role: inp.role2, profit: inp.profit2, salary: inp.salary2 });
    return list.map(p => ({ role: p.role === 'owner' ? 'owner' : 'employee', profit: pos(p.profit || 0), salary: pos(p.salary || 0) }));
  }

  /** Money flow for one partner at a given salary. rt = amounts for the country's company routes, or null. */
  function partnerAt(c, p, salary, rt) {
    if (p.role === 'owner') {
      const ss = (c.ownerSS || c.employeeSS)(salary);
      const R = rt && c.routes ? c.routes : null;
      let avail = pos(p.profit - salary - ss.er);
      // royalties: deductible for the company, capped as a share of total pay (salary + royalties)
      const royalty = R && R.royalty
        ? Math.min(pos(rt.royalty), R.royalty.cap, salary * R.royalty.maxShare / (1 - R.royalty.maxShare), avail) : 0;
      avail -= royalty;
      const pension = R && R.pension ? Math.min(pos(rt.pension), avail) : 0;
      const taxableProfit = avail - pension;
      const corpTax = c.corpTax(taxableProfit, { ownerSalary: salary });
      const after = taxableProfit - corpTax;
      const retained = R && R.companyInvest ? Math.min(pos(rt.companyInvest), after) : 0;
      return { role: 'owner', profit: p.profit, salary, ee: ss.ee, er: ss.er, royalty, pension, taxableProfit, corpTax, retained, dividend: after - retained, gross: p.profit };
    }
    const ss = salary > 0 ? c.employeeSS(salary) : { ee: 0, er: 0 };
    return { role: 'employee', profit: 0, salary, ee: ss.ee, er: ss.er, royalty: 0, pension: 0, taxableProfit: 0, corpTax: 0, retained: 0, dividend: 0, gross: salary };
  }

  /** One year of household cash flow for given salaries (one per partner). */
  function householdAt(c, inp, ps, salaries, rt) {
    const fo = ps.findIndex(p => p.role === 'owner'); // company routes apply to the first owner's company
    const a = partnerAt(c, ps[0], salaries[0], fo === 0 ? rt : null);
    const b = ps[1] ? partnerAt(c, ps[1], salaries[1], fo === 1 ? rt : null) : null;
    const h = {
      salaryA: a.salary, eeA: a.ee, divA: a.dividend, ownerA: a.role === 'owner',
      salaryB: b ? b.salary : 0, eeB: b ? b.ee : 0, divB: b ? b.dividend : 0, ownerB: !!b && b.role === 'owner',
      single: !b, kids: inp.kids, beVvprbis: !!inp.beVvprbis,
    };
    const pt = c.personalTax(h);
    const list = b ? [a, b] : [a];
    const sum = f => list.reduce((s, x) => s + f(x), 0);
    const gross = sum(x => x.gross);
    const royalty = sum(x => x.royalty);
    const royaltyTax = royalty > 0 ? royalty * c.routes.royalty.rate : 0;
    const net = sum(x => x.salary - x.ee + x.dividend) + royalty - royaltyTax - pt.incomeTax - pt.dividendTax + pt.childBenefit;
    return {
      ...h, a, b,
      salaries: sum(x => x.salary),
      dividend: sum(x => x.dividend),
      royalty, royaltyTax,
      pension: sum(x => x.pension),
      retained: sum(x => x.retained),
      corpTax: sum(x => x.corpTax),
      // owners bear both sides of their contributions; an employee's employer share is not the family's cost
      social: sum(x => x.ee + (x.role === 'owner' ? x.er : 0)),
      incomeTax: pt.incomeTax,
      dividendTax: pt.dividendTax,
      childBenefit: pt.childBenefit,
      gross, net,
      keptShare: gross > 0 ? net / gross : 0,
    };
  }

  /** Price level used for a country: the user's override if given, else the country's own. */
  function priceLevel(c, inp) {
    const o = inp['pli_' + c.code];
    return o > 0 ? o : c.priceLevel || 100;
  }

  /** Living costs in this country: the entered amount scaled from the reference country's price level. */
  function livingFor(c, inp, countries) {
    if (!inp.adjustLiving) return inp.living;
    const ref = (countries || []).find(x => x.code === inp.livingRef);
    return ref ? inp.living * priceLevel(c, inp) / priceLevel(ref, inp) : inp.living;
  }

  /** Household result, with owner salaries either as entered or optimised for this country. */
  function household(c, inp, countries, rtOverride, cache) {
    const ps = partners(inp);
    // allowed salary range per partner; employees are fixed at their salary
    const range = ps.map(p => {
      if (p.role !== 'owner') return [p.salary, p.salary];
      const max = maxOwnerSalary(c, p.profit);
      return [Math.min(c.minOwnerSalary || 0, max), max];
    });
    const solve = rt => {
      if (!inp.optimizeSalary) {
        const s = ps.map((p, i) => Math.min(Math.max(p.salary, range[i][0]), range[i][1]));
        return { ...householdAt(c, inp, ps, s, rt), salaryAdjusted: s.some((v, i) => Math.abs(v - ps[i].salary) > 1) };
      }
      const grid = ([lo, hi], n) => hi - lo < 1 ? [lo] : Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n);
      const owners = ps.filter(p => p.role === 'owner').length;
      const n = owners > 1 ? 60 : 200;
      let best = null;
      for (const s0 of grid(range[0], n)) {
        for (const s1 of ps[1] ? grid(range[1], n) : [0]) {
          const r = householdAt(c, inp, ps, [s0, s1], rt);
          if (!best || r.net > best.net) best = r;
        }
      }
      return { ...best, salaryAdjusted: false };
    };
    const rt = !c.routes ? null : rtOverride || { royalty: +inp.beRoyalty || 0, pension: +inp.bePension || 0, companyInvest: +inp.beCompanyInvest || 0 };
    // Salaries are settled first, on income alone; pension and company investing then divert profit at those salaries.
    const saving = rt && (rt.pension > 0 || rt.companyInvest > 0);
    let base = cache && cache.base;
    if (!base) { base = solve(saving ? { ...rt, pension: 0, companyInvest: 0 } : rt); if (cache) cache.base = base; }
    const hh = saving
      ? { ...householdAt(c, inp, ps, [base.a.salary, base.b ? base.b.salary : 0], rt), salaryAdjusted: base.salaryAdjusted }
      : base;
    // what the pension and company-investing routes cost the household in net income
    return { ...hh, routeCost: pos(base.net - hh.net), living: livingFor(c, inp, countries) };
  }

  /** Simulate monthly investing for inp.years years. Returns yearly points incl. year 0. */
  function simulate(c, hh, inp) {
    const inv = c.invest;
    const mg = Math.pow(1 + inp.returnPct / 100, 1 / 12) - 1;
    const living = hh.living === undefined ? inp.living : hh.living;
    const surplus = pos(hh.net - living) / 12;
    // company routes are paid for out of the same monthly saving effort, so countries stay comparable
    const routeCost = (hh.routeCost || 0) / 12;
    const target = pos(inp.monthly - routeCost);
    const monthly = inp.mode === 'all' ? surplus : Math.min(target, surplus);
    const R = c.routes || {};
    const penM = hh.pension > 0 ? hh.pension / 12 / (1 + R.pension.premiumTax) : 0;
    const coM = hh.retained > 0 ? hh.retained / 12 : 0;
    const pen = { v: 0 }, comp = { v: 0, b: 0 }; // company pension plan, portfolio held by the company
    let companyExtra = 0; // pre-tax money the company puts in beyond what it costs the household
    const buyTax = inv.buyTax || 0, sellTax = inv.sellTax || 0;

    // Country models are written for a couple who own the portfolio jointly. For a single person the
    // per-person thresholds are half as large: evaluate each tax at twice the amount and halve the result.
    const S = hh.single, k = S ? 0.5 : 1;
    const hS = S ? { ...hh, divA: 2 * hh.divA } : hh;
    const cgt = g => inv.cgt ? (S ? inv.cgt(2 * g, hS) / 2 : inv.cgt(g, hh)) : 0;
    const mtmTax = g => S ? inv.mtm.tax(2 * g, hS) / 2 : inv.mtm.tax(g, hh);
    const assetTax = (v, yg) => S && !inv.assetTaxPerAccount ? inv.assetTax(2 * v, 2 * yg, hS) / 2 : inv.assetTax(v, yg, hh);
    // yearly harvesting: sell and rebuy enough to realise the tax-free gain allowance, which lifts the cost basis
    const harvest = inp.beHarvest && inv.harvest ? inv.harvest : null;
    const exempt = harvest ? 0 : (inv.cgtExempt || 0) * k; // with harvesting, the year's allowance is already used
    const W = inp.useWrappers && inv.wrapper ? inv.wrapper : null;
    const annualCap = W && W.annualCap ? W.annualCap * k : Infinity;
    const lifetimeCap = W && W.lifetimeCap ? W.lifetimeCap * k : Infinity;

    const wrap = { v: 0, b: 0 };
    const cohorts = []; // taxable account, one cohort per contribution year
    if (inp.startCapital > 0) cohorts.push({ v: inp.startCapital, b: inp.startCapital, age: 0 });
    let contributed = inp.startCapital || 0, taxesPaid = 0;

    const sumV = () => cohorts.reduce((s, x) => s + x.v, 0);
    const sumB = () => cohorts.reduce((s, x) => s + x.b, 0);
    const pay = tax => { // sell a slice of the taxable account to pay a tax bill
      const V = sumV();
      if (tax <= 0 || V <= 0) return;
      const f = pos(1 - tax / V);
      for (const x of cohorts) { x.v *= f; x.b *= f; }
      taxesPaid += Math.min(tax, V);
    };
    const snapshot = year => {
      const V = sumV(), B = sumB();
      const sell = V * sellTax;
      const raw = inv.gainFactor
        ? cohorts.reduce((s, x) => s + pos(x.v - x.b) * inv.gainFactor(x.age - 0.5), 0) - sell
        : V - sell - B;
      const cg = cgt(pos(raw - exempt));
      const wrapTax = W ? pos(wrap.v - wrap.b) * W.cgtRate : 0;
      const pensionNet = pen.v > 0 ? R.pension.payout(pen.v) : 0;
      // company portfolio: tax on the gain inside the company, then dividend tax to get it out
      const companyNet = comp.v > 0 ? (comp.v - R.companyInvest.gainTax * pos(comp.v - comp.b)) * (1 - R.companyInvest.payoutRate(hh)) : 0;
      return {
        year, contributed, companyExtra, pensionNet, companyNet,
        gross: V + wrap.v + pen.v + comp.v,
        net: V - sell - cg + wrap.v - wrapTax + pensionNet + companyNet,
        taxesSoFar: taxesPaid,
        exitTax: sell + cg + wrapTax + (pen.v - pensionNet) + (comp.v - companyNet),
      };
    };

    const points = [snapshot(0)];
    for (let y = 1; y <= inp.years; y++) {
      const startV = sumV();
      const co = { v: 0, b: 0, age: 0 };
      cohorts.push(co);
      let contribTaxable = 0, wrapYear = 0;
      for (let m = 0; m < 12; m++) {
        for (const x of cohorts) x.v *= 1 + mg;
        wrap.v *= 1 + mg;
        let amt = monthly;
        if (W) {
          const room = Math.min(annualCap - wrapYear, lifetimeCap - wrap.b);
          const w = Math.min(amt, pos(room));
          wrap.v += w; wrap.b += w; wrapYear += w; amt -= w;
        }
        co.v += amt * (1 - buyTax); co.b += amt;
        taxesPaid += amt * buyTax;
        contribTaxable += amt;
        contributed += monthly + routeCost;
        pen.v = pen.v * (1 + mg) + penM;
        comp.v = comp.v * (1 + mg) + coM; comp.b += coM;
        taxesPaid += hh.pension / 12 - penM; // premium tax
        companyExtra += hh.pension / 12 + coM - routeCost;
      }
      if (comp.v > 0 && R.companyInvest.assetTax) { const t = R.companyInvest.assetTax(comp.v); comp.v -= t; taxesPaid += t; }
      for (const x of cohorts) x.age++;

      const V = sumV();
      const yearGain = V - startV - contribTaxable;

      if (inv.yieldTax && V > 0) {
        const base = V * DIV_YIELD;
        if (inv.yieldTax.stepUp) for (const x of cohorts) x.b += base * x.v / V;
        const yr = inv.yieldTax.rate;
        pay(base * (typeof yr === 'function' ? yr(hh) : yr));
      }
      if (inv.accrual && V > 0) {
        const base = Math.min(pos(yearGain), startV * inv.accrual.baseRate);
        if (base > 0) {
          for (const x of cohorts) x.b += base * x.v / V;
          pay(base * inv.accrual.rate);
        }
      }
      if (inv.mtm) {
        const elig = cohorts.filter(x => x.age % inv.mtm.every === 0 && x.v > x.b);
        const G = elig.reduce((s, x) => s + x.v - x.b, 0);
        if (G > 0) {
          const T = mtmTax(G);
          for (const x of elig) {
            const t = T * (x.v - x.b) / G;
            x.v -= t; x.b = x.v;
          }
          taxesPaid += T;
        }
      }
      if (inv.assetTax) pay(assetTax(sumV(), yearGain));
      if (harvest) {
        const Vh = sumV(), G = cohorts.reduce((s, x) => s + pos(x.v - x.b), 0);
        const g = Math.min(harvest.perYear * k, G);
        if (g > 0) {
          const cost = harvest.cost * g * Vh / G; // transaction tax on the slice sold and bought back
          for (const x of cohorts) x.b += g * pos(x.v - x.b) / G;
          pay(cost);
        }
      }

      points.push(snapshot(y));
    }
    return { monthly, capped: inp.mode !== 'all' && monthly < target - 0.5, surplusLeft: (surplus - monthly) * 12, points, wrapper: W ? W.name : null };
  }

  /**
   * Best use of a country's company routes: royalties at the legal maximum, then the pension premium
   * (up to the entered ceiling) and the amount invested inside the company that give the most final wealth.
   * The household must still cover its living costs, and with a fixed monthly amount the routes may not
   * cost more net income than that amount.
   */
  function optimizeRoutes(c, inp, countries) {
    const budget = inp.mode === 'all' ? Infinity : inp.monthly * 12;
    const cache = {};
    const run = (pension, companyInvest) => {
      const hh = household(c, inp, countries, { royalty: Infinity, pension, companyInvest }, cache);
      const ok = hh.net >= hh.living - 1 && hh.routeCost <= budget + 1;
      return { hh, ok };
    };
    const maxCompany = partners(inp).filter(p => p.role === 'owner').reduce((m, p) => Math.max(m, p.profit), 0);
    const ceiling = pos(+inp.bePension || 0);
    let best = null;
    const consider = (pension, companyInvest) => {
      const { hh, ok } = run(pension, companyInvest);
      if (!ok && best) return;
      const sim = simulate(c, hh, inp);
      const net = sim.points[sim.points.length - 1].net;
      if (!best || !best.ok && ok || best.ok === ok && (net > best.net + 1 || Math.abs(net - best.net) <= 1 && hh.net > best.hh.net)) best = { hh, sim, net, ok };
    };
    const NP = ceiling > 0 ? 8 : 0, NC = 8;
    for (let i = 0; i <= NP; i++) {
      const pension = NP ? ceiling * i / NP : 0;
      if (i > 0 && !run(pension, 0).ok) break;
      let lo = 0, hi = maxCompany; // largest affordable amount to keep in the company
      for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (run(pension, mid).ok) lo = mid; else hi = mid; }
      for (let j = 0; j <= NC; j++) consider(pension, lo * j / NC);
    }
    return best;
  }

  /** Full comparison across all countries, sorted by final after-tax wealth. */
  function compare(countries, inp) {
    return countries.map(c => {
      const opt = inp.beOptimize && c.routes ? optimizeRoutes(c, inp, countries) : null;
      const hh = opt ? opt.hh : household(c, inp, countries);
      const sim = opt ? opt.sim : simulate(c, hh, inp);
      const last = sim.points[sim.points.length - 1];
      return { country: c, hh, sim, finalNet: last.net, finalGross: last.gross, contributed: last.contributed, investTax: last.taxesSoFar + last.exitTax };
    }).sort((a, b) => (Math.abs(b.finalNet - a.finalNet) > 1 ? b.finalNet - a.finalNet : b.hh.net - a.hh.net));
  }

  const Engine = { household, simulate, compare, maxOwnerSalary, priceLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
