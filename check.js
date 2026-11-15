// Sanity check: prints the comparison for a sample household.
// Run: node check.js [--opt] [--all] [--no-vvpr] [--single] [--employees] [--owners] [--routes] [--best] [--no-harvest] [--pli]
const { COUNTRIES } = require('./taxdata.js');
const Engine = require('./engine.js');
const has = f => process.argv.includes(f);
const inp = {
  role1: has('--employees') ? 'employee' : 'owner', profit1: 80000, salary1: 50000,
  hasPartner2: !has('--single'), role2: has('--owners') ? 'owner' : 'employee', profit2: 80000, salary2: 50000,
  optimizeSalary: has('--opt'), kids: 2, living: 50000, mode: has('--all') ? 'all' : 'fixed', monthly: 1500,
  startCapital: 0, returnPct: 7, years: 20, useWrappers: true, beVvprbis: !has('--no-vvpr'),
  beRoyalty: has('--routes') ? 20000 : 0, bePension: has('--routes') ? 15000 : 0, beCompanyInvest: has('--routes') ? 10000 : 0,
  beOptimize: has('--best'), beHarvest: !has('--no-harvest'), adjustLiving: has('--pli'), livingRef: 'BE',
};
const k = x => (x / 1000).toFixed(1).padStart(7);
console.log('cc     salA    salB    corp  social   incTx   divTx   child     NET  kept%  living  inv/mo  invTax finalGross  finalNet');
for (const r of Engine.compare(COUNTRIES, inp)) {
  const h = r.hh;
  console.log(r.country.code, k(h.salaryA), k(h.salaryB), k(h.corpTax), k(h.social), k(h.incomeTax), k(h.dividendTax), k(h.childBenefit),
    k(h.net), (h.keptShare * 100).toFixed(0).padStart(6), k(h.living), String(Math.round(r.sim.monthly)).padStart(7), k(r.investTax), k(r.finalGross).padStart(10), k(r.finalNet).padStart(9));
  for (const v of [h.net, r.finalNet, r.finalGross]) if (!Number.isFinite(v)) throw new Error('non-finite result for ' + r.country.code);
}
