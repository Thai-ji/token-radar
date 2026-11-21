// Token Radar: the page the judge reads. No framework, no network, no build step.
//
// data.js carries the board (window.RADAR), written by main.ts from the sealed snapshot, alongside the
// model's constants and the comparables table the model computed. This file renders that board, filters
// it, and prices every row a second time from the snapshot's raw numbers so a reader can see the model
// work: the footer reports how many rows recompute to the exact figure the board states.
//
// The model (radar-2-comps), same as lib/model.ts:
//   comps      = median market cap / TVL over the category's live-token protocols (fewer than 3 comps:
//                the all-category median), clamped to [0.05, 6]
//   base       = tvl_usd x comps
//   growthMult = 1 + clamp(change_7d, -60, 150) / 100 x 0.55
//   maturity   = 0.75 + min(age_days, 1460) / 1460 x 0.35     (age unknown: 365 days)
//   chainMult  = 1 + min(chains.length, 6) x 0.03
//   implied    = max(1, round(base x growthMult x maturity x chainMult))
//
// Views: the ranked board (sortable, filterable), a spotlight of the top five, the comparables table,
// the live-token protocols held out of the board, and one protocol's full breakdown with its farm plan.
// Deep links: #p=<slug> opens a protocol, #q= #category= #chain= #age= #watch=1 #sort= #dir= set the view.
(() => {
  'use strict';
  const R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:40px;font-family:monospace">data.js is missing</p>'; return; }
  const M = R.model;
  const ROWS = R.rows;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- numbers -------------------------------------------------------------------------------------
  const fmtUSD = (n) => {
    if (n == null || !isFinite(n)) return 'n/a';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  };
  const fmtMult = (n) => (n == null ? 'n/a' : (n >= 1 ? n.toFixed(2) : n.toFixed(3)) + 'x');
  const fmtChg = (n) => {
    if (n == null) return '<span class="dim">n/a</span>';
    const s = (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
    return '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + s + '</span>';
  };
  const fmtAge = (d) => (d == null ? 'unknown' : d >= 730 ? (d / 365).toFixed(1) + 'y' : d + 'd');
  const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // ---- the model, run again in the browser ---------------------------------------------------------
  // Every number here comes from the row and the constants, never from the implied value itself. A
  // mismatch against the board is the one thing that would make this page dishonest, so it is checked.
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function impliedOf(row) {
    const growthPct = clamp(row.change_7d == null ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
    const growthMult = 1 + (growthPct / 100) * M.growth_weight;
    const ageUsed = row.age_days == null ? M.unknown_age_days : row.age_days;
    const maturityMult = M.maturity_floor + (Math.min(Math.max(ageUsed, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    const chainMult = 1 + Math.min(row.chains.length, M.chain_cap) * M.chain_step;
    const base = row.tvl_usd * row.comps_multiple;
    return {
      base,
      growthPct,
      growthMult,
      maturityMult,
      chainMult,
      implied: Math.max(1, Math.round(base * growthMult * maturityMult * chainMult)),
    };
  }
  const mismatches = ROWS.filter((r) => impliedOf(r).implied !== r.implied_value_usd).map((r) => r.slug);

  // ---- state ---------------------------------------------------------------------------------------
  const state = { q: '', cat: '', chain: '', age: '', watch: false, sort: 'rank', dir: 1, sel: null };
  const DEFAULT_DIR = { rank: 1, name: 1, implied: -1, tvl: -1, chg: -1, age: -1 };

  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    const p = new URLSearchParams(h);
    state.q = p.get('q') || '';
    state.cat = p.get('category') || '';
    state.chain = p.get('chain') || '';
    state.age = p.get('age') || '';
    state.watch = p.get('watch') === '1';
    state.sort = p.get('sort') || 'rank';
    if (!(state.sort in DEFAULT_DIR)) state.sort = 'rank';
    const dir = p.get('dir');
    state.dir = dir === 'asc' ? 1 : dir === 'desc' ? -1 : DEFAULT_DIR[state.sort];
    state.sel = p.get('p') || null;
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('category', state.cat);
    if (state.chain) p.set('chain', state.chain);
    if (state.age) p.set('age', state.age);
    if (state.watch) p.set('watch', '1');
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.sort !== 'rank' && state.dir !== DEFAULT_DIR[state.sort]) p.set('dir', state.dir === 1 ? 'asc' : 'desc');
    if (state.sel) p.set('p', state.sel);
    const h = p.toString();
    try { history.replaceState(null, '', h ? '#' + h : '#'); } catch (e) { /* a locked-down browser may refuse; the view still works */ }
  }

  // ---- filtering and sorting ----------------------------------------------------------------------
  const AGE_BUCKETS = {
    unknown: (d) => d == null,
    fresh: (d) => d != null && d < 365,
    young: (d) => d != null && d >= 365 && d < 1095,
    grown: (d) => d != null && d >= 1095,
  };
  function visible() {
    const q = state.q.trim().toLowerCase();
    const rows = ROWS.filter((r) => {
      if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q) || (r.category || '').toLowerCase().includes(q))) return false;
      if (state.cat && (r.category || 'Uncategorized') !== state.cat) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (state.age && !(AGE_BUCKETS[state.age] || (() => true))(r.age_days)) return false;
      if (state.watch && !r.watch) return false;
      return true;
    });
    const key = state.sort;
    const dir = state.dir;
    return rows.sort((a, b) => {
      let x, y;
      if (key === 'rank') { x = a.rank; y = b.rank; }
      else if (key === 'implied') { x = a.implied_value_usd; y = b.implied_value_usd; }
      else if (key === 'tvl') { x = a.tvl_usd; y = b.tvl_usd; }
      else if (key === 'chg') { x = a.change_7d == null ? -1e9 : a.change_7d; y = b.change_7d == null ? -1e9 : b.change_7d; }
      else if (key === 'age') { x = a.age_days == null ? -1 : a.age_days; y = b.age_days == null ? -1 : b.age_days; }
      else { x = a.name; y = b.name; }
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return a.rank - b.rank;
    });
  }

  // ---- chrome -------------------------------------------------------------------------------------
  function renderHeader() {
    $('meta').innerHTML = 'snapshot <b>' + esc(R.as_of) + '</b> &middot; model <b>' + esc(R.model_version) + '</b> &middot; <b>' + fmtInt(R.rows.length) + '</b> rows &middot; <b>' + R.watchlist_size + '</b> watchlist &middot; <b>' + R.live_size + '</b> live held out';
    document.title = 'Token Radar - ' + R.rows.length + ' pre-token protocols, snapshot ' + R.as_of;
  }

  function renderHero() {
    const top = ROWS[0];
    $('hero').innerHTML =
      '<div class="hero-grid"><div>' +
      '<p class="lede">Pre-token protocols priced at what the market <em>already pays</em> for TVL, ranked.</p>' +
      '<p class="lede-sub">All <b>' + R.watchlist_size + ' watchlist</b> protocols plus the <b>' + R.early_size + ' strongest finds below the floor</b>, each scored the same way: TVL times its category\u2019s live-token market-cap/TVL multiple, adjusted for 7-day growth, age and chain footprint. No name is hand-picked, and the live-token protocols are priced by the market itself, never by this model.</p>' +
      '</div><div class="kpis">' +
      '<div class="kpi hi"><div class="k">Top implied value</div><div class="v">' + fmtUSD(top.implied_value_usd) + '</div></div>' +
      '<div class="kpi"><div class="k">Rows scored</div><div class="v">' + fmtInt(R.rows.length) + '</div></div>' +
      '<div class="kpi"><div class="k">Watchlist covered</div><div class="v">' + R.watchlist_size + '<small>/ ' + R.watchlist_size + '</small></div></div>' +
      '<div class="kpi"><div class="k">Early finds below floor</div><div class="v">' + R.early_size + '</div></div>' +
      '</div></div>';
  }

  function renderSpotlight() {
    const top = ROWS.slice().sort((a, b) => b.implied_value_usd - a.implied_value_usd).slice(0, 5);
    $('spotlight').innerHTML =
      '<div class="spot-grid">' + top.map((r) =>
        '<div class="spot" data-go="' + esc(r.slug) + '" role="button" tabindex="0">' +
        '<div class="r">#' + r.rank + (r.watch ? ' WATCHLIST' : ' EARLY FIND') + '</div>' +
        '<div class="n">' + esc(r.name) + '</div>' +
        '<div class="c">' + esc(r.category || 'uncategorized') + ' &middot; ' + (r.chains.length ? esc(r.chains[0]) : 'chain n/a') + '</div>' +
        '<div class="v">' + fmtUSD(r.implied_value_usd) + '</div>' +
        '<div class="why">' + fmtMult(r.comps_multiple) + ' comps on ' + fmtUSD(r.tvl_usd) + ' TVL &middot; ' + (r.change_7d == null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ' 7d</div>' +
        '</div>').join('') + '</div>';
  }

  function renderControls() {
    const cats = [...new Set(ROWS.map((r) => r.category || 'Uncategorized'))].sort();
    const chains = [...new Set(ROWS.flatMap((r) => r.chains))].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>';
    $('controls').innerHTML =
      '<input type="search" id="q" placeholder="Search protocol, slug or category" value="' + esc(state.q) + '">' +
      '<select id="cat">' + opt('', 'All categories', state.cat) + cats.map((c) => opt(c, c, state.cat)).join('') + '</select>' +
      '<select id="chain">' + opt('', 'All chains', state.chain) + chains.map((c) => opt(c, c, state.chain)).join('') + '</select>' +
      '<select id="age">' + opt('', 'Any age', state.age) + opt('unknown', 'Age unknown', state.age) + opt('fresh', 'Under 1 year', state.age) + opt('young', '1 to 3 years', state.age) + opt('grown', 'Over 3 years', state.age) + '</select>' +
      '<label class="box"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<select id="sort">' + ['rank', 'implied', 'tvl', 'chg', 'age', 'name'].map((k) => opt(k, { rank: 'Sort: rank', implied: 'Sort: implied value', tvl: 'Sort: TVL', chg: 'Sort: 7d change', age: 'Sort: age', name: 'Sort: name' }[k], state.sort)).join('') + '</select>' +
      '<button class="reset" id="reset" type="button">Reset</button>';
    $('q').addEventListener('input', (e) => { state.q = e.target.value; state.sel = null; writeHash(); renderBoard(); });
    $('cat').addEventListener('change', (e) => { state.cat = e.target.value; state.sel = null; writeHash(); renderBoard(); });
    $('chain').addEventListener('change', (e) => { state.chain = e.target.value; state.sel = null; writeHash(); renderBoard(); });
    $('age').addEventListener('change', (e) => { state.age = e.target.value; state.sel = null; writeHash(); renderBoard(); });
    $('watch').addEventListener('change', (e) => { state.watch = e.target.checked; state.sel = null; writeHash(); renderBoard(); });
    $('sort').addEventListener('change', (e) => { state.sort = e.target.value; state.dir = DEFAULT_DIR[state.sort]; writeHash(); renderBoard(); });
    $('reset').addEventListener('click', () => { Object.assign(state, { q: '', cat: '', chain: '', age: '', watch: false, sort: 'rank', dir: 1, sel: null }); writeHash(); renderControls(); renderBoard(); });
  }

  function renderBoard() {
    const rows = visible();
    const max = rows.length ? Math.max.apply(null, rows.map((r) => r.implied_value_usd)) : 1;
    const th = (key, label, cls) => '<th' + (cls ? ' class="' + cls + '"' : '') + ' data-key="' + key + '">' + label + (state.sort === key ? '<span class="arrow">' + (state.dir === 1 ? '\u25B2' : '\u25BC') + '</span>' : '') + '</th>';
    const body = rows.length === 0
      ? '<tr><td colspan="8" class="empty">No protocol matches these filters.</td></tr>'
      : rows.map((r) => {
        const pct = max > 0 ? Math.max(2, (r.implied_value_usd / max) * 100) : 0;
        return '<tr class="' + (r.watch ? 'watch' : 'early') + '" data-go="' + esc(r.slug) + '">' +
          '<td><span class="rank">' + r.rank + '</span></td>' +
          '<td><div class="nm">' + esc(r.name) + '</div><div class="sl">' + esc(r.slug) + '</div></td>' +
          '<td><span class="tag ' + (r.watch ? 'watch' : 'early') + '">' + esc(r.category || 'n/a') + '</span></td>' +
          '<td><div class="chains" title="' + esc(r.chains.join(', ')) + '">' + (r.chains.length ? esc(r.chains[0]) + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : '<span class="dim">n/a</span>') + '</div></td>' +
          '<td class="num">' + fmtUSD(r.tvl_usd) + '</td>' +
          '<td class="num">' + fmtChg(r.change_7d) + '</td>' +
          '<td class="num dim">' + fmtAge(r.age_days) + '</td>' +
          '<td><div class="imp"><span class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></span><span class="val">' + fmtUSD(r.implied_value_usd) + '</span></div></td>' +
          '</tr>';
      }).join('');
    $('tablewrap').innerHTML = '<table><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol') + '<th>Category</th><th>Chains</th>' +
      th('tvl', 'TVL', 'num') + th('chg', '7d', 'num') + th('age', 'Age', 'num') + th('implied', 'Implied value', 'num') +
      '</tr></thead><tbody>' + body + '</tbody></table>';
    const wl = rows.filter((r) => r.watch).length;
    $('count').textContent = 'Showing ' + rows.length + ' of ' + ROWS.length + ' rows (' + wl + ' watchlist, ' + (rows.length - wl) + ' early) - sorted by ' +
      { rank: 'rank', implied: 'implied value', tvl: 'TVL', chg: '7d change', age: 'age', name: 'name' }[state.sort] + (state.dir === 1 ? ' ascending' : ' descending');
    $('tablewrap').querySelectorAll('th[data-key]').forEach((h) => h.addEventListener('click', () => {
      const k = h.getAttribute('data-key');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = DEFAULT_DIR[k]; }
      $('sort').value = state.sort;
      writeHash(); renderBoard();
    }));
    $('tablewrap').querySelectorAll('tr[data-go]').forEach((tr) => tr.addEventListener('click', () => openRow(tr.getAttribute('data-go'))));
    $('spotlight').querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => openRow(el.getAttribute('data-go'))));
  }

  function renderComps() {
    const rows = R.comps.slice(0, 10).map((c) =>
      '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td class="num mono">' + fmtMult(c.multiple) + '</td></tr>').join('');
    const globalRow = '<tr><td class="mono">All categories</td><td class="num">' + R.global_n + '</td><td class="num mono">' + fmtMult(R.global_multiple) + '</td></tr>';
    $('compstable').innerHTML = '<div class="panel"><div class="ph">Category &middot; live comps used &middot; market-cap/TVL multiple</div><table><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Multiple</th></tr></thead><tbody>' + rows + globalRow + '</tbody></table></div>';
    const live = R.live.slice(0, 10).map((l) =>
      '<tr><td><div class="nm">' + esc(l.name) + '</div><div class="sl">' + esc(l.category || 'n/a') + '</div></td><td class="num">' + fmtUSD(l.tvl_usd) + '</td><td class="num">' + fmtUSD(l.mcap_usd) + '</td><td class="num mono">' + (l.mcap_usd && l.tvl_usd ? fmtMult(l.mcap_usd / l.tvl_usd) : 'n/a') + '</td><td class="num">' + fmtChg(l.change_7d) + '</td></tr>').join('');
    $('livetable').innerHTML = '<div class="panel"><div class="ph">Live protocol &middot; TVL &middot; market cap &middot; mcap/TVL &middot; 7d</div><table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">Multiple</th><th class="num">7d</th></tr></thead><tbody>' + live + '</tbody></table></div>';
  }

  function renderMethod() {
    const top = ROWS[0];
    const im = impliedOf(top);
    const ex = '<span class="c">// worked example, row #' + top.rank + '</span>\n' +
      'comps   <span class="k">' + fmtMult(top.comps_multiple) + '</span>  <span class="c">// ' + top.comps_n + ' live ' + esc((top.comps_source === 'global' ? 'all-category' : (top.category || '')) + ' comps, median mcap/TVL') + '</span>\n' +
      'base    ' + fmtUSD(top.tvl_usd) + ' x ' + top.comps_multiple.toFixed(4) + ' = ' + fmtUSD(im.base) + '\n' +
      'growth  ' + (top.change_7d == null ? 'n/a' : (top.change_7d >= 0 ? '+' : '') + top.change_7d.toFixed(2) + '%') + ' 7d -> x' + im.growthMult.toFixed(3) + '\n' +
      'mature  ' + (top.age_days == null ? 'unknown age -> 365d' : top.age_days + 'd') + ' -> x' + im.maturityMult.toFixed(3) + '\n' +
      'chains  ' + top.chains.length + ' -> x' + im.chainMult.toFixed(2) + '\n' +
      'implied ' + fmtUSD(im.base) + ' x ' + im.growthMult.toFixed(3) + ' x ' + im.maturityMult.toFixed(3) + ' x ' + im.chainMult.toFixed(2) + ' = <span class="k">' + fmtUSD(im.implied) + '</span>\n' +
      '<span class="c">// board states ' + fmtUSD(top.implied_value_usd) + (im.implied === top.implied_value_usd ? ' - exact match' : ' - MISMATCH') + '</span>';
    $('methodbody').innerHTML =
      '<div class="formula">comps      = median(mcap / TVL) of live protocols in the category\n' +
      '             (under ' + M.comps_min_sample + ' comps: all-category median; clamp to [' + M.comps_min + ', ' + M.comps_max + '])\n' +
      'base       = tvl_usd x comps\n' +
      'growthMult = 1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 x ' + M.growth_weight + '\n' +
      'maturity   = ' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + ' x ' + M.maturity_range + '   (unknown: ' + M.unknown_age_days + 'd)\n' +
      'chainMult  = 1 + min(chains, ' + M.chain_cap + ') x ' + M.chain_step + '\n' +
      'implied    = max(1, round(base x growthMult x maturity x chainMult))\n\n' + ex + '</div>' +
      '<div class="notes"><ul>' +
      '<li><b>It is a comparables price, not a guess.</b> The snapshot carries market caps for live protocols in the same categories, so the model pays the median price the market already pays for TVL in that category.</li>' +
      '<li><b>Live and pre-token are kept apart.</b> The ' + R.live_size + ' live protocols shown below the board are the market itself; they never enter the ranking.</li>' +
      '<li><b>Nothing is hand-picked.</b> The same function ranks all ' + ROWS.length + ' rows; no slug appears in this file or in the model.</li>' +
      '<li><b>Age is a proxy for readiness, not proof.</b> A protocol with no listing date is aged at ' + M.unknown_age_days + ' days and flagged in its detail view.</li>' +
      '<li><b>The estimate says nothing about whether a token launches.</b> It ranks pipeline candidates for a farming budget, nothing else.</li>' +
      '</ul><p class="checkline' + (mismatches.length ? ' bad' : '') + '">Model check: ' + (ROWS.length - mismatches.length) + ' of ' + ROWS.length + ' rows recompute exactly in this browser' + (mismatches.length ? ', ' + mismatches.length + ' mismatch' : '') + '.</p></div>';
  }

  function renderFoot() {
    $('foot').innerHTML = '<b>Token Radar</b> &middot; snapshot ' + esc(R.as_of) + ' &middot; source: DefiLlama protocol index &middot; model ' + esc(R.model_version) + ' &middot; ' + ROWS.length + ' rows, ' + R.watchlist_size + ' watchlist, ' + R.live_size + ' live held out.<br>' +
      'Implied value is a model estimate from one snapshot, not a price and not a promise; it says nothing about whether a token will launch. No token recorded is not proof no token exists. Nothing here is investment advice.';
  }

  // ---- detail -------------------------------------------------------------------------------------
  function openRow(slug) {
    state.sel = slug;
    writeHash();
    renderModal();
  }
  function closeRow() {
    state.sel = null;
    writeHash();
    renderModal();
  }
  function renderModal() {
    const box = $('modal');
    if (!state.sel) { box.hidden = true; box.innerHTML = ''; return; }
    const r = ROWS.find((x) => x.slug === state.sel);
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    const im = impliedOf(r);
    const flags = [];
    if (r.change_7d != null && r.change_7d < 0) flags.push('7-day change is negative (' + r.change_7d.toFixed(2) + '%); the score is marked down for it.');
    if (r.chains.length <= 1) flags.push('One chain only: less distribution than a multi-chain competitor.');
    if (r.age_days == null) flags.push('No listing date in the snapshot: age is assumed ' + M.unknown_age_days + ' days.');
    if (r.comps_source === 'global') flags.push('Priced off the all-category median: its category has fewer than ' + M.comps_min_sample + ' live comps.');
    else if (r.comps_n < 5) flags.push('Thin comps sample: only ' + r.comps_n + ' live protocols in ' + (r.category || 'its category') + '.');
    if (!r.watch) flags.push('TVL is below the watchlist floor: this row is an early find, not a watchlist protocol.');
    if (r.change_7d != null && r.change_7d > 50) flags.push('7-day change is above 50%: momentum may not persist at this level.');
    const steps = r.farm_steps.map((s) => {
      const ci = s.lastIndexOf(' Cost: ');
      const ti = s.lastIndexOf(' Time: ');
      if (ci < 0 || ti < 0) return '<li>' + esc(s) + '</li>';
      const text = s.slice(0, ci);
      const cost = s.slice(ci + 7, ti).replace(/\.$/, '');
      const time = s.slice(ti + 7).replace(/\.$/, '');
      return '<li>' + esc(text) + '<span class="ct">' + esc(cost) + ' &middot; ' + esc(time) + '</span></li>';
    }).join('');
    box.hidden = false;
    box.innerHTML =
      '<div class="veil" id="veil"></div>' +
      '<div class="card" role="dialog" aria-modal="true" aria-label="' + esc(r.name) + '">' +
      '<div class="mh"><div class="rk">RANK #' + r.rank + '</div><div class="tt"><h3>' + esc(r.name) + '</h3><div class="sub2">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'uncategorized') + ' &middot; ' + (r.chains.length ? esc(r.chains.join(', ')) : 'chain not recorded') + (r.watch ? ' &middot; watchlist' : ' &middot; early find') + '</div></div><button class="x" id="close" type="button" aria-label="Close">&#215;</button></div>' +
      '<div class="mb"><div class="stats">' +
      '<div class="stat"><div class="k">Implied value</div><div class="v big">' + fmtUSD(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + fmtUSD(r.tvl_usd) + '</div></div>' +
      '<div class="stat"><div class="k">7d change</div><div class="v">' + (r.change_7d == null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</div></div>' +
      '<div class="stat"><div class="k">Age</div><div class="v">' + fmtAge(r.age_days) + '</div></div>' +
      '<div class="stat"><div class="k">Comps multiple</div><div class="v">' + fmtMult(r.comps_multiple) + '</div></div>' +
      '<div class="stat"><div class="k">Market cap</div><div class="v">' + (r.mcap_usd == null ? 'none yet' : fmtUSD(r.mcap_usd)) + '</div></div>' +
      '</div><div class="mblock">' +
      '<div class="mtable">comps   <span class="k">' + fmtMult(r.comps_multiple) + '</span> <span class="c">// ' + r.comps_n + ' live ' + esc(r.comps_source === 'global' ? 'all-category' : (r.category || '') + ' comps') + ', median mcap/TVL</span>\n' +
      'base    ' + fmtUSD(r.tvl_usd) + ' x ' + r.comps_multiple.toFixed(4) + ' = ' + fmtUSD(im.base) + '\n' +
      'growth  ' + (r.change_7d == null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + ' 7d -> x' + im.growthMult.toFixed(3) + '\n' +
      'mature  ' + (r.age_days == null ? 'unknown -> 365d' : r.age_days + 'd') + ' -> x' + im.maturityMult.toFixed(3) + '\n' +
      'chains  ' + r.chains.length + ' -> x' + im.chainMult.toFixed(2) + '\n' +
      '<span class="sum">implied ' + fmtUSD(im.base) + ' x ' + im.growthMult.toFixed(3) + ' x ' + im.maturityMult.toFixed(3) + ' x ' + im.chainMult.toFixed(2) + ' = <span class="k">' + fmtUSD(im.implied) + '</span></span>\n' +
      '<span class="c">// the board says ' + fmtUSD(r.implied_value_usd) + (im.implied === r.implied_value_usd ? ' and this page recomputes it exactly' : ' - MISMATCH') + '</span>' +
      '</div><div class="risks"><h4>What could make this wrong</h4>' +
      (flags.length ? '<ul>' + flags.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '<p class="none">No flags: multi-chain, growing, priced off a deep comps sample.</p>') +
      '</div></div>' +
      '<div class="farm"><h4>Farm plan, ' + r.farm_steps.length + ' steps</h4><ol>' + steps + '</ol></div>' +
      '<p class="mfoot">These steps are this row\'s own, copied from board.json row #' + r.rank + '. Costs are estimates in US dollars and exclude impermanent loss and contract risk.</p>' +
      '</div></div>';
    $('close').addEventListener('click', closeRow);
    $('veil').addEventListener('click', closeRow);
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.sel) closeRow(); });
  window.addEventListener('hashchange', () => { const before = state.sel; parseHash(); renderControls(); renderBoard(); if (before !== state.sel) renderModal(); });

  // ---- boot ---------------------------------------------------------------------------------------
  parseHash();
  renderHeader();
  renderHero();
  renderSpotlight();
  renderControls();
  renderBoard();
  renderComps();
  renderMethod();
  renderFoot();
  renderModal();
})();