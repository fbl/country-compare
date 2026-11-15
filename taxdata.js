/*
 * Country tax models — SIMPLIFIED ESTIMATES of tax year 2026 rules.
 *
 * The numbers were fact-checked in November 2026, mostly against secondary sources
 * (accounting firms, tax portals, a few official calculators). Some items could not
 * be confirmed and many simplifications remain — see each country's notes. Treat
 * results as a first screening, not as advice. All parameters live in this one file
 * so they are easy to correct.
 *
 * Each country implements (amounts per year, in the country's own currency):
 *   corpTax(profit, ctx)        corporate tax on profit after owner salary; ctx = {ownerSalary}
 *   employeeSS(gross)           -> {ee, er}  social contributions of a regular employee
 *   ownerSS(gross)              -> {ee, er}  same for the owner-director (defaults to employeeSS)
 *   personalTax(h)              -> {incomeTax, dividendTax, childBenefit}
 *                                  h = {salaryA, salaryB, eeA, eeB, divA, divB, ownerA, ownerB, single, kids, beVvprbis}
 *                                  A / B are the two partners: gross salary, own social contributions (ee), dividend
 *                                  from their own company, and whether they are a company owner. With single = true
 *                                  there is no partner B (all B fields are 0).
 *   Investment amounts and thresholds are written for a couple; the engine halves them for a single person.
 *   invest                      how an accumulating equity ETF is taxed:
 *     buyTax / sellTax          transaction tax (fraction of amount)
 *     cgt(gain, h)              tax on the realised gain when everything is sold at the end
 *     cgtExempt                 household exemption applied to that gain
 *     assetTax(value, yearGain) yearly tax on the holding itself (wealth tax, deemed-return tax)
 *     mtm {every, tax(gain,h)}  gains taxed while unrealised, every N years per yearly cohort
 *     accrual {baseRate, rate}  yearly prepayment on a notional return, credited at sale (DE)
 *     yieldTax {rate, stepUp}   (rate may be a function of h) yearly tax on the fund's internal dividends (assumed 1.5 % yield)
 *     gainFactor(years)         share of a purchase's gain that is taxable after that holding period
 *     wrapper {name, annualCap, lifetimeCap, cgtRate}  tax-advantaged account filled first
 *   fx                          EUR per unit of local currency (omit for euro countries)
 */
(function (root) {
  'use strict';

  /** Progressive tax: table = [[upperLimit, rate], ...], last limit Infinity. */
  function BR(x, table) {
    let tax = 0, lo = 0;
    for (const [hi, rate] of table) {
      if (x <= lo) break;
      tax += (Math.min(x, hi) - lo) * rate;
      lo = hi;
    }
    return tax;
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pos = x => Math.max(0, x);
  const flat = rate => gain => gain * rate;
  const INF = Infinity;

  const C = [];

  /* ───────────── Belgium ───────────── */
  {
    const T = [[16720, .25], [29510, .40], [51070, .45], [INF, .50]];
    const kidAllow = k => k <= 0 ? 0 : [0, 2130, 5130, 11440, 18510][Math.min(k, 4)] + pos(k - 4) * 7070;
    const person = (gross, ee, director, allowance) => {
      const afterSS = gross - ee;
      const exp = director ? Math.min(.03 * afterSS, 3200) : Math.min(.30 * afterSS, 6070);
      return pos(BR(pos(afterSS - exp), T) - BR(allowance, T)) * 1.07; // 7 % avg municipal surcharge
    };
    C.push({
      code: 'BE', name: 'Belgium', flag: '🇧🇪',
      corpTax: (p, ctx) => ctx.ownerSalary >= Math.min(51000, p)
        ? BR(p, [[100000, .20], [INF, .25]]) : .25 * p,
      employeeSS: g => ({ ee: .1307 * g, er: .25 * g }),
      ownerSS: g => ({ ee: (.205 * Math.min(g, 75024.54) + .1416 * clamp(g - 75024.54, 0, 110562.42 - 75024.54)) * 1.04, er: 0 }),
      personalTax: h => {
        const aHigher = h.salaryA >= h.salaryB;
        const ka = kidAllow(h.kids);
        return {
          incomeTax: person(h.salaryA, h.eeA, h.ownerA, 11550 + (aHigher ? ka : 0))
            + person(h.salaryB, h.eeB, h.ownerB, 11550 + (aHigher ? 0 : ka)),
          dividendTax: (h.beVvprbis ? .18 : .30) * (h.divA + h.divB), // VVPRbis reduced rate vs standard withholding tax
          childBenefit: 2200 * h.kids,
        };
      },
      invest: {
        buyTax: .0012, sellTax: .0012, cgt: flat(.10),
        cgtExempt: 30000, // €10k per person, +€1k per unused year up to €15k
        harvest: { perYear: 20000, cost: .0024 }, // optional: realise €10k of gain per person every year (sell + rebuy)
        assetTax: v => v > 1e6 ? .003 * v : 0, // annual tax on securities accounts above €1M
        assetTaxPerAccount: true, // threshold is per account, not per person
      },
      // Optional ways to take money out of, or invest through, the owner's company (amounts entered by the user).
      routes: {
        // copyright royalties: 15 % on the gross amount, no social contributions, at most 30 % of total pay
        royalty: { rate: .15, maxShare: .30, cap: 77220 },
        // company pension plan (IPT): 4.4 % premium tax; at payout 3.55 % health levy, 2 % solidarity levy
        // (+2 % above €150k), then 10 % income tax plus ~7 % municipal surcharge on the rest
        pension: { premiumTax: .044, payout: v => { const s = .0555 * v + .02 * pos(v - 150000); return (v - s) * (1 - .10 * 1.07); } },
        // equity fund held by the company (DBI/RDT fund): 5 % on the gain, then dividend tax when paid out
        companyInvest: { gainTax: .05, assetTax: v => v > 1e6 ? .003 * v : 0, payoutRate: h => h.beVvprbis ? .18 : .30 },
      },
      notes: [
        'Owner is a self-employed director: ~20.5 % social contributions (capped), no employer contributions.',
        'Corporate tax 20 % on the first €100k if the owner salary is at least €51k, otherwise 25 %.',
        'Dividends at 18 % when the reduced-rate option is ticked, otherwise the standard 30 %. Two routes reach 18 %: VVPRbis (small company, new registered shares issued for cash since July 2013, from the third financial year after the contribution) or a liquidation reserve (10 % paid by the company when reserving, 9.8 % at payout after a three-year wait).',
        'Copyright royalties (optional): 15 % tax on the gross amount and no social contributions, limited to 30 % of total pay and €77,220 a year. Software qualifies again from 2026, but only if the work is licensed for exploitation and reaches a wide public; the 30 % share is also tested as a four-year average.',
        'Company pension (optional, IPT): premium deductible for the company, 4.4 % premium tax; the payout loses about 16 % (3.55 % health levy, 2 % solidarity levy plus 2 % above €150k, 10 % tax plus municipal surcharge). The money is locked until retirement and the premium must fit the "80 % rule", which the tool does not check. Insurer fees are ignored.',
        'Investing in the company (optional, DBI/RDT fund): profit is invested after corporate tax but before dividend tax; 5 % tax on the gain at exit, then dividend tax on everything paid out. Needs the €51k owner salary. Fund fees, usually higher than an ETF, are ignored.',
        'Pension and company investing are paid for out of the monthly amount: the private ETF purchase is reduced by what these routes cost in net income.',
        'With "best use of the routes" ticked, royalties are set to the legal maximum and the tool searches for the pension premium (up to the amount entered) and the amount kept in the company that give the most wealth, while living costs stay covered.',
        'ETF: 0.12 % stock-exchange tax on buy and sell; 10 % capital gains tax (from 2026). With the yearly-exemption option ticked, the couple sells and rebuys each year to realise €10k of gain per person tax-free, paying the stock-exchange tax twice on that slice; otherwise one final sale with an exemption of up to €15k per person. Belgium has no explicit rule against selling and rebuying, but the general anti-abuse rule has not been tested on this; 0.3 % yearly securities-account tax once the account exceeds €1M. Funds registered in Belgium pay 1.32 % stock-exchange tax instead of 0.12 %.',
        'Child benefit: Flemish Groeipakket base amount.',
      ],
    });
  }

  /* ───────────── Netherlands ───────────── */
  {
    const T = [[38883, .3575], [78426, .3756], [INF, .495]];
    const ahk = g => g <= 29736 ? 3115 : pos(3115 - .06398 * (g - 29736));
    const ak = g => g <= 11965 ? .08324 * g
      : g <= 25845 ? 996 + .31009 * (g - 11965)
      : g <= 45592 ? 5300 + .0195 * (g - 25845)
      : pos(5685 - .0651 * (g - 45592));
    // other: income from other boxes, which also counts for the general tax credit phase-out
    const person = (g, iack, other) => pos(BR(g, T) - ahk(g + (other || 0)) - ak(g) - iack);
    C.push({
      code: 'NL', name: 'Netherlands', flag: '🇳🇱', minOwnerSalary: 58000,
      corpTax: p => BR(p, [[200000, .19], [INF, .258]]),
      employeeSS: g => ({ ee: 0, er: .18 * Math.min(g, 79409) }),
      ownerSS: g => ({ ee: 0, er: .061 * Math.min(g, 79409) }),
      personalTax: h => {
        const lo = h.single ? h.salaryA : Math.min(h.salaryA, h.salaryB);
        const iack = h.kids > 0 ? Math.min(3032, .1145 * pos(lo - 6239)) : 0;
        const aIsLo = h.single || h.salaryA <= h.salaryB;
        return {
          incomeTax: person(h.salaryA, aIsLo ? iack : 0, h.divA) + (h.single ? 0 : person(h.salaryB, aIsLo ? 0 : iack, h.divB)),
          dividendTax: BR(h.divA + h.divB, [[h.single ? 68843 : 137686, .245], [INF, .31]]),
          childBenefit: 1430 * h.kids,
        };
      },
      invest: {
        cgt: null,
        // Box 3 (2026): 36 % of a deemed 6 % return on assets above €59,357 per partner, or of the actual return if lower.
        assetTax: (v, yearGain) => v <= 118714 ? 0 : .36 * Math.min(.06 * (v - 118714), pos(yearGain)),
      },
      notes: [
        'Owner (DGA) must take the customary salary of at least €58k; company pays only the health-insurance levy on it.',
        'National insurance is inside the first income-tax bracket, so employee contributions show as 0. Pension-fund premiums are ignored.',
        'Dividends in box 2: 24.5 % up to €137.7k for fiscal partners, 31 % above.',
        'ETF in box 3: yearly ~2.16 % of the value above €118.7k (36 % of a deemed 6 % return, or of the actual return if lower). No tax on sale. A switch to taxing actual returns is planned for 2028 but not yet law.',
      ],
    });
  }

  /* ───────────── Germany ───────────── */
  {
    const tariff = z => {
      if (z <= 12348) return 0;
      if (z <= 17799) { const y = (z - 12348) / 1e4; return (914.51 * y + 1400) * y; }
      if (z <= 69878) { const y = (z - 17799) / 1e4; return (173.10 * y + 2397) * y + 1034.87; }
      if (z <= 277825) return .42 * z - 11135.63;
      return .45 * z - 19470.38;
    };
    const split = z => 2 * tariff(pos(z) / 2);
    const soli = t => t > 40700 ? Math.min(.055 * t, .119 * (t - 40700)) : 0;
    const HC = 69750, PC = 101400; // health / pension ceilings
    C.push({
      code: 'DE', name: 'Germany', flag: '🇩🇪',
      corpTax: p => .30 * p,
      employeeSS: g => {
        const x = .093 * Math.min(g, PC) + .013 * Math.min(g, PC) + (.0875 + .018) * Math.min(g, HC);
        return { ee: x, er: x };
      },
      ownerSS: g => { const x = .1055 * Math.min(g, HC); return { ee: x, er: x }; },
      personalTax: h => {
        // deductible contributions: everything except unemployment insurance (owners pay none)
        const net = (g, ee, owner) => pos(g - 1230 - (owner ? ee : ee - .013 * Math.min(g, PC)));
        const n = h.single ? 1 : 2;
        const scale = z => n * tariff(pos(z) / n); // income splitting for couples
        const relief = h.single && h.kids > 0 ? 4260 + 240 * (h.kids - 1) : 0; // single-parent relief
        const zvE = net(h.salaryA, h.eeA, h.ownerA) + net(h.salaryB, h.eeB, h.ownerB) - 36 * n - relief;
        const base = scale(zvE), withAllowance = scale(zvE - 9756 * h.kids);
        const kindergeld = 3108 * h.kids;
        const useAllowance = base - withAllowance > kindergeld;
        return {
          incomeTax: (useAllowance ? withAllowance : base) + soli(withAllowance * 2 / n) * n / 2,
          dividendTax: .26375 * pos(h.divA + h.divB - 1000 * n),
          childBenefit: useAllowance ? 0 : kindergeld,
        };
      },
      invest: {
        cgt: flat(.184625), // 26.375 % × 70 % (equity-fund partial exemption)
        accrual: { baseRate: .032 * .7, rate: .184625 }, // Vorabpauschale, 2026 base rate 3.2 %
      },
      notes: [
        'Corporate tax ~30 % (15 % + solidarity surcharge + trade tax at a 400 % multiplier).',
        'Owner holding ≥50 % is outside statutory social insurance; modelled with voluntary health and care insurance only (no pension).',
        'Joint assessment with income splitting; the better of Kindergeld or child allowance is applied.',
        'ETF: 26.375 % on 70 % of the gain (equity-fund partial exemption), plus the yearly Vorabpauschale prepayment. The €2,000 saver allowance is assumed used by dividends.',
      ],
    });
  }

  /* ───────────── France ───────────── */
  {
    const T = [[11600, 0], [29579, .11], [84577, .30], [181917, .41], [INF, .45]]; // scale for 2025 income; 2026 not yet voted
    const CAP = 192240; // 4 × social security ceiling
    const netTaxable = (g, ee) => { const n = g - ee + .029 * .9825 * g; return n - Math.min(.10 * n, 14555); };
    C.push({
      code: 'FR', name: 'France', flag: '🇫🇷',
      corpTax: p => BR(p, [[42500, .15], [INF, .25]]),
      employeeSS: g => ({ ee: .22 * Math.min(g, CAP) + .10 * pos(g - CAP), er: .42 * Math.min(g, CAP) + .25 * pos(g - CAP) }),
      // company president: no unemployment insurance
      ownerSS: g => ({ ee: .21 * Math.min(g, CAP) + .10 * pos(g - CAP), er: .39 * Math.min(g, CAP) + .25 * pos(g - CAP) }),
      personalTax: h => {
        const R = netTaxable(h.salaryA, h.eeA) + netTaxable(h.salaryB, h.eeB);
        const k = h.kids, n = h.single ? 1 : 2;
        const parts = n + (k <= 2 ? .5 * k : 1 + (k - 2)) + (h.single && k > 0 ? .5 : 0); // single parents get an extra half part
        const tax = Math.max(parts * BR(R / parts, T), n * BR(R / n, T) - 1807 * 2 * (parts - n));
        let cb = k < 2 ? 0 : 1810 + 2320 * (k - 2);
        const ceil = 79980 + 6664 * pos(k - 2);
        if (R > ceil + 26624) cb *= .25; else if (R > ceil) cb *= .5;
        return { incomeTax: pos(tax), dividendTax: .314 * (h.divA + h.divB), childBenefit: cb };
      },
      invest: {
        // flat tax, plus the high-income surcharge (3 % above €500k, 4 % above €1M for a couple) on a large one-off gain
        cgt: g => .314 * g + .03 * clamp(g - 5e5, 0, 5e5) + .04 * pos(g - 1e6),
        wrapper: { name: 'PEA', lifetimeCap: 300000, cgtRate: .186 },
      },
      notes: [
        'Owner treated as a salaried president (SAS), without unemployment insurance. Social charges are rough averages: ~21–22 % employee, ~39–42 % employer.',
        'Income tax with the family quotient (capped benefit per child).',
        'Dividends and gains under the flat tax, taken as 31.4 % (12.8 % + 18.6 % social levies from 2026).',
        'With tax wrappers on: contributions go to two PEA accounts first (€150k each), where only social levies apply after 5 years. PEA-eligible ETFs only.',
      ],
    });
  }

  /* ───────────── Luxembourg ───────────── */
  {
    const T = (() => {
      const t = [[13230, 0]]; let u = 13230;
      for (const r of [8, 9, 10, 11, 12]) { u += 2205; t.push([u, r / 100]); }
      for (let r = 14; r <= 38; r += 2) { u += 2295; t.push([u, r / 100]); }
      t.push([117450, .39], [176160, .40], [234870, .41], [INF, .42]);
      return t;
    })();
    const CAP = 164590;
    const class2 = x => 2 * BR(pos(x) / 2, T) * 1.07;
    C.push({
      code: 'LU', name: 'Luxembourg', flag: '🇱🇺',
      corpTax: p => {
        const cit = p <= 175000 ? .14 * p : p <= 200000 ? 24500 + .30 * (p - 175000) : .16 * p;
        return cit * 1.07 + .0675 * p; // solidarity surcharge + Luxembourg City municipal business tax
      },
      employeeSS: g => ({ ee: .1155 * Math.min(g, CAP) + .014 * g, er: .145 * Math.min(g, CAP) }),
      personalTax: h => {
        const ded = (g, ee) => g > 0 ? g - (ee - .014 * g) - 540 - 480 : 0;
        const n = h.single ? 1 : 2, D = h.divA + h.divB;
        const tariff = x => n * BR(pos(x) / n, T) * 1.07; // class 2 splitting for couples, class 1 for a single person
        const both = h.salaryA > 0 && h.salaryB > 0;
        const base = ded(h.salaryA, h.eeA) + ded(h.salaryB, h.eeB) - (both ? 4500 : 0);
        const t0 = tariff(base);
        return {
          incomeTax: t0,
          dividendTax: tariff(base + pos(.5 * D - 1500 * n)) - t0 + .014 * D, // €1,500 allowance per person
          childBenefit: 4200 * h.kids,
        };
      },
      invest: { cgt: null },
      notes: [
        'Married couple taxed in class 2 (splitting), 7 % employment-fund surcharge.',
        'Dividends: 50 % exempt, the rest taxed at the marginal rate, plus 1.4 % dependency contribution.',
        'ETF: gains on holdings kept longer than 6 months are tax-free for private investors (a draft budget would extend this to 12 months from 2027).', 'Class 2 splitting is due to be replaced by a single tax class from 2028.',
      ],
    });
  }

  /* ───────────── Spain ───────────── */
  {
    const T = [[12450, .19], [20200, .24], [35200, .30], [60000, .37], [300000, .45], [INF, .47]];
    const SAV = [[6000, .19], [50000, .21], [200000, .23], [300000, .27], [INF, .30]];
    const WT = [[167129, .002], [334253, .003], [668500, .005], [1337000, .009], [2673999, .013], [5347998, .017], [10695996, .021], [INF, .035]];
    const CAP = 61214.40;
    // Self-employed (autónomo societario) minimum monthly quota by net monthly income tier, 2026
    const RETA = [[3190, 448.69], [3620, 478.68], [4050, 504.41], [6000, 545.59], [INF, 607.35]];
    const kidMin = k => { let s = 0; for (let i = 0; i < k; i++) s += [2400, 2700, 4000, 4500][Math.min(i, 3)]; return s; };
    C.push({
      code: 'ES', name: 'Spain', flag: '🇪🇸',
      corpTax: p => p < 1e6 ? BR(p, [[50000, .19], [INF, .21]]) : .23 * p, // profit used as a stand-in for the €1M turnover test
      employeeSS: g => ({ ee: .065 * Math.min(g, CAP), er: .3215 * Math.min(g, CAP) }),
      ownerSS: g => ({ ee: 12 * RETA.find(([hi]) => g * .97 / 12 <= hi)[1], er: 0 }),
      personalTax: h => {
        const min = 5550 + kidMin(h.kids) / (h.single ? 1 : 2);
        const person = (g, ee) => pos(BR(pos(g - ee - 2000), T) - BR(min, T));
        return {
          incomeTax: person(h.salaryA, h.eeA) + person(h.salaryB, h.eeB),
          dividendTax: BR(h.divA, SAV) + BR(h.divB, SAV),
          childBenefit: 0,
        };
      },
      invest: {
        cgt: gain => 2 * BR(gain / 2, SAV), // jointly owned: half the gain each
        assetTax: v => 2 * BR(pos(v / 2 - 700000), WT),
      },
      notes: [
        'Income tax uses the generic state + regional scale; real rates differ per region.',
        'Owner pays self-employed (autónomo) contributions on the minimum base, roughly €5.4k–€7.3k a year.',
        'Corporate tax: reduced micro-company rates (19 % / 21 %) for turnover below €1M (approximated by profit below €1M), else 23 %.',
        'ETF gains on the savings scale (19–30 %). Wealth tax on the state scale above €700k per person; Madrid charges nothing below about €3M, and other regions use different exemptions.',
      ],
    });
  }

  /* ───────────── Portugal ───────────── */
  {
    const T = [[8342, .122], [12587, .152], [17838, .207], [23089, .236], [29397, .306], [43090, .346], [46566, .431], [86634, .446], [INF, .48]];
    const sol = x => .025 * clamp(x - 80000, 0, 170000) + .05 * pos(x - 250000);
    C.push({
      code: 'PT', name: 'Portugal', flag: '🇵🇹',
      corpTax: p => BR(p, [[50000, .15], [INF, .19]]) + .015 * p,
      employeeSS: g => ({ ee: .11 * g, er: .2375 * g }),
      personalTax: h => {
        const base = (g, ee) => pos(g - Math.max(4587.09, ee));
        const R = base(h.salaryA, h.eeA) + base(h.salaryB, h.eeB);
        const n = h.single ? 1 : 2, D = h.divA + h.divB;
        const joint = x => n * (BR(x / n, T) + sol(x / n)); // income splitting for couples
        return {
          incomeTax: pos(joint(R) - 600 * h.kids),
          // flat 28 %, or opt to add half of the dividend to taxable income if that is cheaper
          dividendTax: Math.min(.28 * D, joint(R + .5 * D) - joint(R)),
          childBenefit: 0,
        };
      },
      invest: {
        cgt: flat(.28),
        // share of the gain that is taxed, by years held: 10 / 20 / 30 % excluded after 2 / 5 / 8 years
        gainFactor: yrs => yrs > 8 ? .7 : yrs > 5 ? .8 : yrs > 2 ? .9 : 1,
      },
      notes: [
        'Joint taxation with income splitting; €600 tax credit per child.',
        'Dividends at a flat 28 %, or half of the dividend taxed at progressive rates when that is cheaper.', 'ETF: 28 % on gains, with 10 / 20 / 30 % of the gain excluded after 2 / 5 / 8 years of holding.',
        'Child benefit is income-tested and assumed to be zero.',
      ],
    });
  }

  /* ───────────── Italy ───────────── */
  {
    const T = [[28000, .23], [50000, .33], [INF, .43]];
    const CAP = 122295;
    const extra = b => b <= 20000 ? 0 : b <= 32000 ? 1000 : b <= 40000 ? 1000 * (40000 - b) / 8000 : 0; // further employee credit
    const credit = b => (b <= 15000 ? 1955 : b <= 28000 ? 1910 + 1190 * (28000 - b) / 13000 : b <= 50000 ? 1910 * (50000 - b) / 22000 : 0) + extra(b);
    const person = (g, ee) => { const b = pos(g - ee); return pos(BR(b, T) - (g > 0 ? credit(b) : 0)) + .023 * b; };
    C.push({
      code: 'IT', name: 'Italy', flag: '🇮🇹',
      corpTax: (p, ctx) => .24 * p + .039 * (p + ctx.ownerSalary), // director fees are not deductible for IRAP
      employeeSS: g => ({ ee: .0949 * Math.min(g, CAP), er: .30 * Math.min(g, CAP) }),
      ownerSS: g => ({ ee: .1168 * Math.min(g, CAP), er: .2335 * Math.min(g, CAP) }),
      personalTax: h => ({
        incomeTax: person(h.salaryA, h.eeA) + person(h.salaryB, h.eeB),
        dividendTax: .26 * (h.divA + h.divB),
        childBenefit: 700 * h.kids,
      }),
      invest: { cgt: flat(.26), assetTax: v => .002 * v },
      notes: [
        'Corporate tax 27.9 % (IRES 24 % + IRAP 3.9 %; the owner\'s director fee stays in the IRAP base).',
        'Owner paid as a director only, through the INPS separate scheme (~35 %, one third borne by the owner). An owner who also works in the business day to day owes traders\' scheme contributions on top (not modelled).',
        'Income tax includes ~2.3 % regional and municipal surcharges.',
        'ETF: 26 % on gains plus a 0.2 % yearly stamp duty on the portfolio value.',
        'Child benefit: minimum universal allowance for higher incomes.',
      ],
    });
  }

  /* ───────────── Ireland ───────────── */
  {
    const USC = [[12012, .005], [28700, .02], [70044, .03], [INF, .08]];
    const usc = x => x < 13000 ? 0 : BR(x, USC);
    const it = (a, b, h) => {
      let band, credits;
      if (h.single) { // single person; single parents get a wider band and an extra credit
        band = Math.min(a, h.kids > 0 ? 48000 : 44000);
        credits = 2000 + (a > 0 ? 2000 : 0) + (h.kids > 0 ? 1900 : 0);
      } else {
        const hi = Math.max(a, b), lo = Math.min(a, b);
        band = Math.max(Math.min(hi, 53000) + Math.min(lo, 35000), Math.min(hi, 35000) + Math.min(lo, 53000));
        credits = 4000 + (a > 0 ? 2000 : 0) + (b > 0 ? 2000 : 0);
      }
      return pos(.2 * band + .4 * (a + b - band) - credits) + usc(a) + usc(b);
    };
    C.push({
      code: 'IE', name: 'Ireland', flag: '🇮🇪',
      corpTax: p => .125 * p,
      employeeSS: g => ({ ee: .0424 * g, er: .1129 * g }),
      ownerSS: g => ({ ee: .0424 * g, er: 0 }),
      personalTax: h => {
        const t0 = it(h.salaryA, h.salaryB, h);
        return {
          incomeTax: t0,
          dividendTax: it(h.salaryA + h.divA, h.salaryB + h.divB, h) - t0 + .0424 * (h.divA + h.divB)
            + .03 * (pos(h.divA - 100000) + pos(h.divB - 100000)), // 11 % USC on non-PAYE income above €100k
          childBenefit: 1680 * h.kids,
        };
      },
      invest: { cgt: flat(.35), mtm: { every: 8, tax: flat(.35) } }, // 38 % in 2026, 35 % from 2027
      notes: [
        'Corporate tax 12.5 % on trading income.',
        'Owner-director pays class S PRSI; no employer PRSI on the owner salary.',
        'Dividends are taxed as ordinary income (income tax + USC + PRSI) — usually the costliest way to extract profit.',
        'ETF: 35 % exit tax on gains (the rate from 2027; 38 % in 2026), with a deemed disposal every 8 years (taxed even if not sold). The Investment Account proposed for mid-2027 is not modelled.',
      ],
    });
  }

  /* ───────────── United Kingdom ───────────── */
  {
    const SAL = [[37700, .20], [125140, .40], [INF, .45]];
    const DIV = [[37700, .1075], [125140, .3575], [INF, .3935]];
    const person = (sal, div) => {
      const pa = 12570 - clamp((sal + div - 100000) / 2, 0, 12570);
      const ts = pos(sal - pa), td = pos(div - pos(pa - sal));
      const divTax = td > 500 ? BR(ts + td, DIV) - BR(ts + 500, DIV) : 0;
      return { sal: BR(ts, SAL), div: divTax };
    };
    C.push({
      code: 'UK', name: 'United Kingdom', flag: '🇬🇧', fx: 1.18,
      corpTax: p => p <= 50000 ? .19 * p : p <= 250000 ? 9500 + .265 * (p - 50000) : .25 * p,
      employeeSS: g => ({ ee: .08 * clamp(g - 12570, 0, 37700) + .02 * pos(g - 50270), er: .15 * pos(g - 5000) }),
      personalTax: h => {
        const a = person(h.salaryA, h.divA), a0 = person(h.salaryA, 0), b = person(h.salaryB, h.divB), b0 = person(h.salaryB, 0);
        const k = h.kids, cb = k < 1 ? 0 : 1406.60 + 930.80 * (k - 1);
        const hi = Math.max(h.salaryA + h.divA, h.salaryB + h.divB);
        return {
          incomeTax: a0.sal + b0.sal,
          dividendTax: a.div + (a.sal - a0.sal) + b.div + (b.sal - b0.sal), // includes loss of personal allowance caused by dividends
          childBenefit: cb * (1 - clamp((hi - 60000) / 20000, 0, 1)),
        };
      },
      invest: {
        cgt: flat(.24), cgtExempt: 6000,
        yieldTax: { rate: .3575, stepUp: true }, // reinvested fund income taxed yearly as a dividend (outside the ISA)
        wrapper: { name: 'ISA', annualCap: 40000, cgtRate: 0 },
      },
      notes: [
        'Converted at £1 = €1.18. Corporate tax 19–25 % with marginal relief.',
        'Dividend rates 10.75 % / 35.75 % / 39.35 % (from April 2026), £500 allowance.',
        'Child benefit is clawed back when the higher earner exceeds £60k.',
        'With tax wrappers on: up to £20k per person a year goes into ISAs (no tax at all). The rest is taxed at 24 % CGT with a £3k exemption each, plus yearly dividend tax on the fund\'s reinvested income (UK reporting fund assumed).',
      ],
    });
  }

  /* ───────────── Switzerland (Zurich) ───────────── */
  {
    // Effective combined federal + cantonal + communal income tax, married couple with two children, city of Zurich.
    const PTS = [[0, 0], [50000, 0], [80000, .0275], [100000, .0464], [150000, .0963], [200000, .1414], [300000, .21], [500000, .2833], [1e6, .3454], [2e6, .3693]];
    const tax = inc => {
      if (inc <= 0) return 0;
      for (let i = 1; i < PTS.length; i++) {
        if (inc <= PTS[i][0]) {
          const [x0, r0] = PTS[i - 1], [x1, r1] = PTS[i];
          return inc * (r0 + (r1 - r0) * (inc - x0) / (x1 - x0));
        }
      }
      return 2e6 * .3693 + (inc - 2e6) * .393;
    };
    const bvg = g => .06 * clamp(g - 26460, 0, 64260);
    const ALV = 148200;
    // The curve is for a married couple with two children. Single parents use the same tariff;
    // a single person without children is approximated by reversing income splitting.
    const hhTax = (h, extra) => {
      const inc = h.salaryA - h.eeA + h.salaryB - h.eeB + extra, shift = (2 - h.kids) * 12000;
      return h.single && h.kids === 0 ? tax(2 * inc + shift) / 2 : tax(inc + shift);
    };
    C.push({
      code: 'CH', name: 'Switzerland (Zurich)', flag: '🇨🇭', fx: 1.08,
      corpTax: p => .196 * p,
      employeeSS: g => ({
        ee: .053 * g + .021 * Math.min(g, ALV) + bvg(g),
        er: .053 * g + .011 * Math.min(g, ALV) + .018 * g + bvg(g),
      }),
      personalTax: h => {
        const t0 = hhTax(h, 0);
        return { incomeTax: t0, dividendTax: hhTax(h, .55 * (h.divA + h.divB)) - t0, childBenefit: 2580 * h.kids };
      },
      invest: {
        cgt: null,
        buyTax: .0015, sellTax: .0015, // stamp duty on a foreign-domiciled ETF through a Swiss broker
        assetTax: v => BR(v, [[161000, 0], [403000, .00107], [805000, .00214], [1452000, .00321], [2418000, .00428], [3384000, .00535], [INF, .00642]]),
        // fund dividends are taxed at the household's marginal income-tax rate
        yieldTax: { rate: h => { const x = .55 * (h.divA + h.divB); return (hhTax(h, x + 1000) - hhTax(h, x)) / 1000; }, stepUp: false },
      },
      notes: [
        'Converted at CHF 1 = €1.08. City of Zurich; low-tax cantons such as Zug or Schwyz are markedly cheaper.',
        'Income tax is an effective-rate curve fitted to the federal tax calculator for 2026 (married, two earners, city of Zurich), not the statutory tariffs.',
        'Mandatory pension-fund (BVG) contributions are deducted like a tax although they are really the owner\'s own retirement savings.',
        'Dividends from an own company (≥10 % stake) are taxed on roughly 55 % of the amount.',
        'ETF: no capital gains tax; yearly wealth tax (~0.1–0.6 %), income tax on the fund\'s internal dividends, and 0.15 % stamp duty per trade (Swiss broker assumed).',
      ],
    });
  }

  /* ───────────── Austria ───────────── */
  {
    const T = [[13539, 0], [21992, .20], [36458, .30], [70365, .40], [104859, .48], [1e6, .50], [INF, .55]];
    const BONUS = [[24380, .06], [49380, .27], [82713, .3575], [INF, .50]];
    const CAP = 97020;
    C.push({
      code: 'AT', name: 'Austria', flag: '🇦🇹',
      corpTax: p => .23 * p,
      employeeSS: g => ({ ee: .1807 * Math.min(g, CAP), er: .21 * Math.min(g, CAP) + .086 * g }),
      ownerSS: g => ({ ee: .2683 * Math.min(g, CAP), er: .071 * g }),
      personalTax: h => {
        const employee = (g, ee) => g > 0
          ? pos(BR(pos(g * 6 / 7 - ee * 6 / 7 - 132), T) - 496) + BR(pos(g / 7 - ee / 7 - 620), BONUS) : 0;
        const owner = (g, ee) => { const n = pos(g - ee); return BR(n - Math.min(.15 * n, 4950), T); }; // basic profit allowance
        const one = (g, ee, isOwner) => isOwner ? owner(g, ee) : employee(g, ee);
        // GSVG contributions on dividends until the contribution ceiling is reached
        const gsvg = (div, sal, isOwner) => isOwner ? .2683 * clamp(div, 0, pos(CAP - sal)) : 0;
        return {
          incomeTax: pos(one(h.salaryA, h.eeA, h.ownerA) + one(h.salaryB, h.eeB, h.ownerB) - 2000 * h.kids),
          dividendTax: .275 * (h.divA + h.divB) + gsvg(h.divA, h.salaryA, h.ownerA) + gsvg(h.divB, h.salaryB, h.ownerB),
          childBenefit: 2900 * h.kids,
        };
      },
      invest: { cgt: flat(.275), yieldTax: { rate: .275, stepUp: true } },
      notes: [
        'Owner (shareholder-manager above 25 %) insured under the self-employed scheme (GSVG, ~27 % capped). Dividends also carry these contributions until salary plus dividend reach the ceiling (shown under dividend tax).',
        'Spouse\'s 13th/14th salary taxed at the reduced 6 % rate; Familienbonus Plus of €2,000 per child.',
        'ETF: 27.5 % on gains, and 27.5 % yearly on the fund\'s internal dividends (credited against the final gain).',
      ],
    });
  }

  /* ───────────── Denmark ───────────── */
  {
    const share = x => BR(x, [[158800, .27], [INF, .42]]);
    const afterAM = g => .92 * g;
    const person = g => {
      if (g <= 0) return 0;
      const a = afterAM(g);
      const ded = Math.min(.1275 * g, 63300) + Math.min(.045 * pos(g - 235200), 3100);
      return .08 * g + .2505 * pos(a - ded - 54100) + .1201 * pos(a - 54100)
        + .075 * pos(a - 641200) + .075 * pos(a - 777900) + .05 * pos(a - 2592700);
    };
    C.push({
      code: 'DK', name: 'Denmark', flag: '🇩🇰', fx: 1 / 7.46,
      corpTax: p => .22 * p,
      employeeSS: g => g > 0 ? { ee: 1190, er: 15000 } : { ee: 0, er: 0 },
      personalTax: h => {
        const cb = 13368 * h.kids; // age 7–17 rate; younger children get more
        const cut = .02 * (pos(afterAM(h.salaryA) - 961100) + pos(afterAM(h.salaryB) - 961100));
        const D = h.divA + h.divB;
        return {
          incomeTax: person(h.salaryA) + person(h.salaryB),
          dividendTax: h.single ? share(2 * D) / 2 : share(D), // thresholds double for married couples
          childBenefit: pos(cb - cut),
        };
      },
      invest: {
        cgt: (gain, h) => share(h.divA + h.divB + gain) - share(h.divA + h.divB),
        mtm: { every: 1, tax: (gain, h) => share(h.divA + h.divB + gain) - share(h.divA + h.divB) },
      },
      notes: [
        'Converted at DKK 7.46 = €1. Income tax uses the 2026 bracket structure (8 % labour-market contribution, ~25 % municipal, state bottom/middle/top taxes).',
        'Almost no social contributions; welfare is funded from income tax.',
        'Dividends and ETF gains are share income: 27 % up to DKK 158,800 for a couple, 42 % above — dividends use the low band first.',
        'ETF gains are taxed every year on the unrealised increase (mark-to-market). Assumes an ETF on the tax authority\'s list of equity-based funds; others are taxed as capital income (about 37–42 %). The Aktiesparekonto (17 %, small deposit ceiling) is not modelled.',
      ],
    });
  }

  /* ───────────── Sweden ───────────── */
  {
    const P = 59200, KI = .3238; // 2026 price base amount; average municipal + regional rate
    const allowance = g => { // basic allowance (grundavdrag)
      const a = g <= .99 * P ? .423 * P : g <= 2.72 * P ? .423 * P + .2 * (g - .99 * P)
        : g <= 3.11 * P ? .77 * P : g <= 7.88 * P ? .77 * P - .1 * (g - 3.11 * P) : .293 * P;
      return Math.min(g, Math.ceil(a / 100) * 100);
    };
    const jsa = e => { // earned-income tax credit (jobbskatteavdrag)
      const b = e <= .91 * P ? e : e <= 3.24 * P ? .91 * P + .3874 * (e - .91 * P)
        : e <= 8.08 * P ? 1.813 * P + .251 * (e - 3.24 * P) : 3.027 * P;
      return pos(b - allowance(e)) * KI;
    };
    // earnedBase: salary that earns the work tax credit; g: total taxed as employment income
    const person = (g, earnedBase) => {
      const t = pos(g - allowance(g));
      return pos(KI * t + .20 * pos(t - 643000) - jsa(earnedBase));
    };
    C.push({
      code: 'SE', name: 'Sweden', flag: '🇸🇪', fx: 1 / 11,
      corpTax: p => .206 * p,
      employeeSS: g => ({ ee: 0, er: .3142 * g }),
      personalTax: h => {
        // 3:12 rules per owner: dividends within the allowance at 20 %, the excess taxed as salary
        const divTax = (sal, div) => {
          const within = Math.min(div, 322400 + .5 * pos(sal - 644800));
          return .20 * within + person(sal + div - within, sal) - person(sal, sal);
        };
        const k = h.kids;
        return {
          incomeTax: person(h.salaryA, h.salaryA) + person(h.salaryB, h.salaryB),
          dividendTax: divTax(h.salaryA, h.divA) + divTax(h.salaryB, h.divB),
          childBenefit: 15000 * k + [0, 0, 1800, 8760, 20880, 35880][Math.min(k, 5)],
        };
      },
      invest: { cgt: null, assetTax: v => .01065 * pos(v - 600000) },
      notes: [
        'Converted at SEK 11 = €1. Employer contributions 31.42 %; municipal tax 32.38 % plus 20 % state tax on high incomes.',
        'Closely-held company (3:12) rules: dividends within the yearly allowance are taxed at 20 %, the excess as salary income.',
        'ETF held in an ISK account: ~1.07 % of the value per year above SEK 300k per person, no tax on gains.',
      ],
    });
  }

  /* ───────────── Poland ───────────── */
  {
    const CAP = 282600;
    const OWNER_ZUS = 31400; // sole shareholder insured like a self-employed person (social + health), per year
    const soc = g => .1126 * Math.min(g, CAP) + .0245 * g;
    const half = x => pos(BR(x, [[120000, .12], [INF, .32]]) - 3600);
    const kidRelief = k => { let s = 0; for (let i = 0; i < k; i++) s += [1112.04, 1112.04, 2000.04, 2700][Math.min(i, 3)]; return s; };
    C.push({
      code: 'PL', name: 'Poland', flag: '🇵🇱', fx: 1 / 4.40,
      corpTax: p => (p <= 8.431e6 ? .09 : .19) * p, // 9 % needs revenue ≤ €2M; profit is used as a loose stand-in
      employeeSS: g => ({ ee: soc(g) + .09 * (g - soc(g)), er: .1626 * Math.min(g, CAP) + .0422 * g }),
      ownerSS: g => ({ ee: .09 * g + OWNER_ZUS, er: 0 }),
      personalTax: h => {
        const base = (g, owner) => pos(g - (owner ? 0 : soc(g)) - 3000);
        const R = base(h.salaryA, h.ownerA) + base(h.salaryB, h.ownerB);
        const n = h.single && h.kids === 0 ? 1 : 2; // couples and single parents split income
        const relief = h.kids === 1 && R > 112000 ? 0 : kidRelief(h.kids); // one-child relief is income-limited
        return {
          incomeTax: pos(n * half(R / n) - relief),
          dividendTax: .19 * (h.divA + h.divB),
          childBenefit: 9600 * h.kids,
        };
      },
      invest: { cgt: g => .19 * g + .04 * pos(g - 2e6) }, // 4 % solidarity levy above PLN 1M per person
      notes: [
        'Converted at PLN 4.40 = €1. Corporate tax 9 % for small taxpayers (revenue up to €2M, not checked here), 19 % otherwise.',
        'Owner paid as a board member by appointment (9 % health contribution) and, as sole shareholder, also pays self-employed social and health contributions of about PLN 31,400 a year. With a genuine second shareholder that fixed cost falls away.',
        'Joint filing, 12 % / 32 % scale, child tax relief and the universal 800+ child benefit.',
        'ETF: 19 % on gains, plus the 4 % solidarity levy on very large gains. IKE/IKZE retirement accounts and the personal investment account starting in 2027 are not modelled.',
      ],
    });
  }

  /* ───────────── Czechia ───────────── */
  {
    const CAP = 2350416;
    const kidCredit = k => { let s = 0; for (let i = 0; i < k; i++) s += [15204, 22320, 27840][Math.min(i, 2)]; return s; };
    const person = g => pos(BR(g, [[1762812, .15], [INF, .23]]) - (g > 0 ? 30840 : 0));
    C.push({
      code: 'CZ', name: 'Czechia', flag: '🇨🇿', fx: 1 / 24.4,
      corpTax: p => .21 * p,
      employeeSS: g => ({ ee: .071 * Math.min(g, CAP) + .045 * g, er: .248 * Math.min(g, CAP) + .09 * g }),
      personalTax: h => ({
        incomeTax: person(h.salaryA) + person(h.salaryB) - kidCredit(h.kids),
        dividendTax: .15 * (h.divA + h.divB),
        childBenefit: 0,
      }),
      invest: { cgt: null },
      notes: [
        'Converted at CZK 24.4 = €1. Flat 15 % income tax (23 % on very high salaries), high employer contributions (33.8 %).',
        'Child tax credits can exceed the tax due and are then paid out.',
        'ETF: gains are tax-free after a 3-year holding period. Purchases from the last 3 years would be taxed as ordinary income at 15 % / 23 % (not modelled).',
      ],
    });
  }

  /* ───────────── Estonia ───────────── */
  C.push({
    code: 'EE', name: 'Estonia', flag: '🇪🇪',
    corpTax: p => .22 * p, // 22/78 of the net dividend — only due because profit is distributed
    employeeSS: g => ({ ee: .016 * g, er: .338 * g }),
    ownerSS: g => ({ ee: 0, er: .33 * g }), // board-member fee: social tax only, no unemployment insurance
    personalTax: h => {
      const person = (g, ee) => .22 * pos(g - ee - 8400);
      const k = h.kids;
      return {
        incomeTax: person(h.salaryA, h.eeA) + person(h.salaryB, h.eeB),
        dividendTax: 0,
        childBenefit: k <= 2 ? 960 * k : 1920 + 1200 * (k - 2) + 5400,
      };
    },
    invest: { cgt: flat(.22) },
    notes: [
      'Company profit is untaxed until distributed; a distribution costs 22 % and the dividend is then tax-free for the owner. Profit left in the company would stay untaxed (not modelled — everything is paid out).',
      'Flat 22 % income tax with a €8,400 basic exemption; employer social tax 33 %. Owner paid as a board member (no unemployment insurance).',
      'ETF: 22 % on gains at sale.',
    ],
  });

  /* ───────────── Bulgaria ───────────── */
  {
    const CAP = 27600; // €2,300 a month from 1 August 2026
    const kidRelief = k => [0, 306.78, 613.55, 920.33][Math.min(k, 3)]; // 10 % of the child deduction, one parent claims
    C.push({
      code: 'BG', name: 'Bulgaria', flag: '🇧🇬',
      corpTax: p => .10 * p,
      employeeSS: g => ({ ee: .1378 * Math.min(g, CAP), er: .192 * Math.min(g, CAP) }),
      personalTax: h => ({
        incomeTax: pos(.10 * (pos(h.salaryA - h.eeA) + pos(h.salaryB - h.eeB)) - kidRelief(h.kids)),
        dividendTax: .05 * (h.divA + h.divB),
        childBenefit: 0,
      }),
      invest: { cgt: null },
      notes: [
        'Flat 10 % corporate and income tax, 5 % dividend tax; social contributions capped at about €27.6k of salary. Owner assumed to work under a management contract.',
        'ETF: gains are tax-free only when sold on an EU/EEA regulated market (e.g. Xetra, Euronext); otherwise about 9–10 %.',
        'Child tax relief is included; the income-tested child allowance is assumed to be zero.',
      ],
    });
  }

  /* ───────────── Cyprus ───────────── */
  {
    const T = [[22000, 0], [32000, .20], [42000, .25], [72000, .30], [INF, .35]];
    const SC = 68904, GC = 180000;
    // 2026 family deduction per parent, only below a family-income limit
    const kidDed = (k, famInc) => famInc > (k <= 2 ? 100000 : k <= 4 ? 150000 : 200000) ? 0
      : [0, 1000, 2250, 3750][Math.min(k, 3)] + 1500 * pos(k - 3);
    C.push({
      code: 'CY', name: 'Cyprus', flag: '🇨🇾',
      corpTax: p => .15 * p,
      employeeSS: g => ({
        ee: .088 * Math.min(g, SC) + .0265 * Math.min(g, GC),
        er: .105 * Math.min(g, SC) + .029 * Math.min(g, GC) + .02 * g,
      }),
      personalTax: h => {
        const d = kidDed(h.kids, h.salaryA + h.salaryB + h.divA + h.divB);
        return {
          incomeTax: BR(pos(h.salaryA - h.eeA - d), T) + BR(pos(h.salaryB - h.eeB - d), T),
          dividendTax: .05 * (h.divA + h.divB) + .0265 * (Math.min(h.divA, pos(GC - h.salaryA)) + Math.min(h.divB, pos(GC - h.salaryB))),
          childBenefit: 0,
        };
      },
      invest: { cgt: null },
      notes: [
        'Uses the 2026 tax reform: 15 % corporate tax, new income-tax brackets, child deductions for family income up to €100k (more with 3+ children), 5 % defence contribution on dividends for domiciled residents. Housing deductions are not modelled.',
        'Newcomers with non-dom status pay no defence contribution on dividends for 17 years (only 2.65 % health contribution).',
        'ETF: gains on securities are tax-free.',
      ],
    });
  }

  /* ───────────── Greece ───────────── */
  {
    const CAP = 7761.94 * 14; // monthly ceiling, 14 salaries a year
    const OWNER_EFKA = 250.77 * 12; // self-employed scheme, lowest category
    // 2026 scale (law 5246/2025); the rates on the first €30k fall with the number of dependent children
    const LOW = [[.09, .20, .26], [.09, .18, .24], [.09, .16, .22], [.09, .09, .20], [0, 0, .18]];
    const scale = k => { const r = LOW[Math.min(k, 4)]; return [[10000, r[0]], [20000, r[1]], [30000, r[2]], [40000, .34], [60000, .39], [INF, .44]]; };
    // tax reduction for employment income, shrinking by €20 per €1,000 of income above €12,000 (not with 5+ children)
    const credit = (b, k) => pos([777, 900, 1120, 1340, 1580][Math.min(k, 4)] + 220 * pos(k - 4) - (k >= 5 ? 0 : .02 * pos(b - 12000)));
    const person = (g, ee, k) => { const b = pos(g - ee); return g > 0 ? pos(BR(b, scale(k)) - credit(b, k)) : 0; };
    C.push({
      code: 'GR', name: 'Greece', flag: '🇬🇷',
      corpTax: p => .22 * p,
      employeeSS: g => ({ ee: .1337 * Math.min(g, CAP), er: .2179 * Math.min(g, CAP) }),
      ownerSS: () => ({ ee: OWNER_EFKA, er: 0 }),
      personalTax: h => ({
        incomeTax: person(h.salaryA, h.eeA, h.kids) + person(h.salaryB, h.eeB, h.kids),
        dividendTax: .05 * (h.divA + h.divB),
        childBenefit: 0,
      }),
      invest: { cgt: null },
      notes: [
        'Corporate tax 22 %, dividends taxed at 5 %.',
        'Owner paid as the manager of their own company, taxed as employment income. Insured in the self-employed scheme at the lowest contribution category, about €3,000 a year whatever the salary; a higher category costs more and builds a larger pension.',
        'Income tax uses the 2026 scale (9 % to 44 %), with lower rates on the first €30k and a larger tax reduction for each dependent child. Both parents are assumed to get the child rates. The child rates and reduction amounts could not be confirmed against the law text.',
        'Child benefit is means-tested and assumed to be zero at these incomes.',
        'ETF: gains on EU-domiciled UCITS funds are tax-free for individuals. Funds from outside the EU/EEA are taxed at 15 %.',
      ],
    });
  }

  /* ───────────── Romania ───────────── */
  {
    const MW = 4050; // gross minimum monthly wage, RON
    // 10 % health contribution on investment income, on a base stepped at 6 / 12 / 24 minimum wages
    const cass = x => .10 * MW * (x >= 24 * MW ? 24 : x >= 12 * MW ? 12 : x >= 6 * MW ? 6 : 0);
    C.push({
      code: 'RO', name: 'Romania', flag: '🇷🇴', fx: 1 / 5.34,
      corpTax: p => .16 * p,
      employeeSS: g => ({ ee: .35 * g, er: .0225 * g }),
      personalTax: h => ({
        incomeTax: .10 * (pos(h.salaryA - h.eeA) + pos(h.salaryB - h.eeB)),
        dividendTax: .16 * (h.divA + h.divB) + cass(h.divA) + cass(h.divB),
        childBenefit: 3504 * h.kids,
      }),
      invest: { cgt: (g, h) => .03 * g + pos(cass(g + h.divA + h.divB) - cass(h.divA + h.divB)) },
      notes: [
        'Converted at RON 5.34 = €1. Standard 16 % profit tax; the 1 % micro-company turnover tax (turnover up to €100k) is not modelled.',
        'Salaries: 35 % employee contributions (pension + health), 10 % income tax, 2.25 % employer contribution.',
        'Dividends at 16 % (from 2026) plus a health contribution capped at 10 % of 24 minimum wages.',
        'ETF: 3 % on gains for holdings kept over a year through a Romanian broker (6 % under a year, not modelled), plus the capped health contribution if dividends have not already reached the cap. Through a foreign broker the rate is 16 %.',
      ],
    });
  }

  /* Convert local-currency models to EUR in/out. */
  function localize(c) {
    const k = c.fx;
    if (!k || k === 1) return c;
    const L = x => x / k, E = x => x * k;
    const hL = h => ({ ...h, salaryA: L(h.salaryA), salaryB: L(h.salaryB), eeA: L(h.eeA), eeB: L(h.eeB), divA: L(h.divA), divB: L(h.divB) });
    const ss = f => g => { const r = f(L(g)); return { ee: E(r.ee), er: E(r.er) }; };
    const inv = c.invest, out = { ...inv };
    if (inv.cgt) out.cgt = (g, h) => E(inv.cgt(L(g), hL(h)));
    if (inv.cgtExempt) out.cgtExempt = E(inv.cgtExempt);
    if (inv.assetTax) out.assetTax = (v, yg, h) => E(inv.assetTax(L(v), L(yg), hL(h)));
    if (inv.mtm) out.mtm = { every: inv.mtm.every, tax: (g, h) => E(inv.mtm.tax(L(g), hL(h))) };
    if (inv.yieldTax && typeof inv.yieldTax.rate === 'function') out.yieldTax = { ...inv.yieldTax, rate: h => inv.yieldTax.rate(hL(h)) };
    if (inv.wrapper) out.wrapper = {
      ...inv.wrapper,
      annualCap: inv.wrapper.annualCap && E(inv.wrapper.annualCap),
      lifetimeCap: inv.wrapper.lifetimeCap && E(inv.wrapper.lifetimeCap),
    };
    return {
      ...c,
      minOwnerSalary: c.minOwnerSalary && E(c.minOwnerSalary),
      corpTax: (p, ctx) => E(c.corpTax(L(p), { ownerSalary: L(ctx.ownerSalary) })),
      employeeSS: ss(c.employeeSS),
      ownerSS: c.ownerSS && ss(c.ownerSS),
      personalTax: h => { const r = c.personalTax(hL(h)); return { incomeTax: E(r.incomeTax), dividendTax: E(r.dividendTax), childBenefit: E(r.childBenefit) }; },
      invest: out,
    };
  }

  // Eurostat price level index 2024, household final consumption expenditure (EU27 = 100). National averages.
  const PLI = { BE: 116.5, NL: 116.0, DE: 108.6, FR: 111.2, LU: 132.8, ES: 90.9, PT: 87.0, IT: 97.5, IE: 138.1, UK: 124.7,
    CH: 174.4, AT: 112.8, DK: 143.1, SE: 115.1, PL: 72.2, CZ: 88.4, EE: 100.0, BG: 59.7, CY: 92.8, RO: 63.7, GR: 86.0 };
  for (const c of C) c.priceLevel = PLI[c.code];

  const COUNTRIES = C.map(localize);
  if (typeof module !== 'undefined' && module.exports) module.exports = { COUNTRIES };
  else root.COUNTRIES = COUNTRIES;
})(typeof window !== 'undefined' ? window : globalThis);
