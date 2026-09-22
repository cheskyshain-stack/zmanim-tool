// Income and Maaser Tracker: the whole client. One plain script, no build step, no import
// from the zmanim js/ tree at all, on purpose: this is a separate feature with a separate
// backend, and keeping it out of js/ keeps it out of build-offline.py's module bundler too
// (see build-offline.py's stamp for this page instead, which hashes this one file the same
// way stamp_css_versions hashes a stylesheet).
//
// No framework: state lives in a handful of variables, every screen is rendered by setting
// root.innerHTML from a template literal, and one delegated click/submit listener on root
// reads data-action attributes to figure out what happened. Money is cents everywhere except
// the moment it is typed or displayed.

(function () {
  'use strict';

  // Set this to the deployed Worker's address (see the docblock atop worker/maaser-worker.js
  // for how to deploy one) before this page can create or open a tracker. Left blank, the
  // page explains what is missing instead of pretending to work - the same pattern
  // TRAFFIC_API uses in js/ui/traffic-view.js.
  const MAASER_API = (typeof window !== 'undefined' && window.__MAASER_API_OVERRIDE__) || '';

  const STORAGE_KEY = 'zmanim-maaser-trackers';
  const root = document.getElementById('root');

  // ---------------------------------------------------------------------------------------
  // Money and date helpers
  // ---------------------------------------------------------------------------------------

  const money = (cents) => {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(Math.round(cents));
    const dollars = Math.floor(abs / 100);
    const c = String(abs % 100).padStart(2, '0');
    return `${sign}$${dollars.toLocaleString('en-US')}.${c}`;
  };

  function parseDollarsToCents(input) {
    const s = String(input || '').trim().replace(/[$,]/g, '');
    if (!s || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
    return Math.round(parseFloat(s) * 100);
  }

  const todayIso = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

  function periodRange(period, customFrom, customTo) {
    const now = new Date();
    if (period === 'all') return null;
    if (period === 'month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
      return { from, to: todayIso() };
    }
    if (period === 'year') {
      const from = new Date(now.getFullYear(), 0, 1).toLocaleDateString('en-CA');
      return { from, to: todayIso() };
    }
    if (period === 'custom') return { from: customFrom || '0000-01-01', to: customTo || '9999-12-31' };
    return null;
  }

  function inRange(dateStr, range) {
    if (!range) return true;
    return dateStr >= range.from && dateStr <= range.to;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatDateLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  }

  // ---------------------------------------------------------------------------------------
  // Remembered trackers (convenience only; never the source of truth - see api() below,
  // which always asks the server).
  // ---------------------------------------------------------------------------------------

  function rememberedTrackers() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }
  function rememberTracker(token) {
    try {
      const list = rememberedTrackers().filter((t) => t.token !== token);
      list.unshift({ token, lastOpened: Date.now() });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 8)));
    } catch { /* private browsing or storage disabled: convenience only, safe to skip */ }
  }
  function forgetTracker(token) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rememberedTrackers().filter((t) => t.token !== token)));
    } catch { /* see above */ }
  }

  // ---------------------------------------------------------------------------------------
  // API client
  // ---------------------------------------------------------------------------------------

  let session = { token: null, pin: null }; // pin held in memory only for this page load

  class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }

  async function api(path, opts = {}) {
    if (!MAASER_API) throw new ApiError(0, 'not_configured', 'The tracker backend has not been deployed yet.');
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (session.token) headers.authorization = `Bearer ${session.token}`;
    if (session.pin) headers['x-tracker-pin'] = session.pin;
    let res;
    try {
      res = await fetch(MAASER_API + path, { ...opts, headers });
    } catch {
      throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
    }
    let body = null;
    try { body = await res.json(); } catch { /* empty body is fine for some responses */ }
    if (!res.ok) throw new ApiError(res.status, body && body.error, (body && body.message) || 'Something went wrong.');
    return body;
  }

  // ---------------------------------------------------------------------------------------
  // Calculations: pure functions over the raw state the server returns. All of the spec's
  // balance rules live here and nowhere else, so the dashboard cards, the source cards and
  // the CSV export can never disagree with each other.
  // ---------------------------------------------------------------------------------------

  function sourceTotals(data, sourceId, range) {
    const income = data.income.filter((e) => e.source_id === sourceId && inRange(e.entry_date, range));
    const openings = data.opening.filter((o) => o.source_id === sourceId && inRange(o.entry_date, range));
    const allocs = data.allocations.filter((a) => a.source_id === sourceId);
    const givingById = new Map(data.giving.map((g) => [g.id, g]));
    const givenAllocs = allocs.filter((a) => {
      const g = givingById.get(a.giving_id);
      return g && inRange(g.entry_date, range);
    });

    const incomeCents = income.reduce((s, e) => s + e.amount_cents, 0);
    const maaserCents = income.reduce((s, e) => s + e.maaser_cents, 0);
    const givenCents = givenAllocs.reduce((s, a) => s + a.amount_cents, 0);
    const openingRemaining = openings.filter((o) => o.balance_type === 'remaining').reduce((s, o) => s + o.amount_cents, 0);
    const openingAhead = openings.filter((o) => o.balance_type === 'ahead').reduce((s, o) => s + o.amount_cents, 0);

    const goalCents = maaserCents + openingRemaining;
    const givenTotalCents = givenCents + openingAhead;
    const netCents = goalCents - givenTotalCents; // > 0 remaining, < 0 ahead
    return { incomeCents, maaserCents, givenCents, goalCents, givenTotalCents, netCents, openingRemaining, openingAhead };
  }

  function overallTotals(data, range) {
    const totals = data.sources.map((s) => sourceTotals(data, s.id, range));
    return totals.reduce((acc, t) => ({
      incomeCents: acc.incomeCents + t.incomeCents,
      goalCents: acc.goalCents + t.goalCents,
      givenTotalCents: acc.givenTotalCents + t.givenTotalCents,
      netCents: acc.netCents + t.netCents,
    }), { incomeCents: 0, goalCents: 0, givenTotalCents: 0, netCents: 0 });
  }

  // ---------------------------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------------------------

  let view = { screen: 'loading' };
  let data = null; // raw state from /api/state once loaded
  let period = 'month';
  let customFrom = todayIso();
  let customTo = todayIso();
  let historyTab = 'all';

  function setView(next) { view = next; render(); }

  function showToast(message) {
    document.querySelectorAll('.mz-toast').forEach((n) => n.remove());
    const el = document.createElement('div');
    el.className = 'mz-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function trackerLink(token) {
    return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}#t=${token}`;
  }

  // ---------------------------------------------------------------------------------------
  // Loading a tracker
  // ---------------------------------------------------------------------------------------

  async function openTracker(token, { pin } = {}) {
    session = { token, pin: pin || null };
    setView({ screen: 'loading' });
    try {
      const state = await api('/api/state');
      data = state;
      rememberTracker(token);
      history.replaceState(null, '', `#t=${token}`);
      setView({ screen: 'dashboard' });
    } catch (err) {
      if (err.code === 'pin_required' || err.code === 'wrong_pin') {
        setView({ screen: 'pin', token, wrong: err.code === 'wrong_pin' });
        return;
      }
      if (err.code === 'not_configured') {
        setView({ screen: 'not-configured' });
        return;
      }
      setView({ screen: 'open-error', token, message: err.message, code: err.code });
    }
  }

  async function refreshState() {
    data = await api('/api/state');
  }

  // ---------------------------------------------------------------------------------------
  // Rendering: screens
  // ---------------------------------------------------------------------------------------

  function render() {
    if (view.screen === 'loading') return renderLoading();
    if (view.screen === 'not-configured') return renderNotConfigured();
    if (view.screen === 'landing') return renderLanding();
    if (view.screen === 'open-form') return renderOpenForm();
    if (view.screen === 'open-error') return renderOpenError();
    if (view.screen === 'pin') return renderPinScreen();
    if (view.screen === 'created') return renderCreated();
    if (view.screen === 'recover') return renderRecover();
    if (view.screen === 'recovered') return renderRecovered();
    if (view.screen === 'dashboard') return renderDashboard();
  }

  function renderLoading() {
    root.innerHTML = `<div class="mz-center-page"><div class="mz-spinner" style="width:2rem;height:2rem;"></div></div>`;
  }

  function renderNotConfigured() {
    root.innerHTML = `
      <div class="mz-page">
        <div class="mz-card">
          <h1>Maaser Tracker is not set up yet</h1>
          <p>This page needs a backend Worker and database deployed before it can create or
             open a tracker. See the instructions at the top of
             <code>worker/maaser-worker.js</code>, then set <code>MAASER_API</code> at the top
             of <code>maaser/app.js</code> to the deployed Worker's address.</p>
        </div>
        <div class="mz-card">
          <h2>Want to start now instead?</h2>
          <p><a href="local.html" class="mz-btn mz-btn-primary mz-btn-block">Use the on-this-device version</a></p>
          <p style="margin-top:0.6rem">Saves everything right in this browser, no server needed.
             It won't sync across devices or survive clearing this browser's data, so back it up
             from its own Settings once you've entered anything.</p>
        </div>
      </div>`;
  }

  function renderLanding() {
    const remembered = rememberedTrackers();
    root.innerHTML = `
      <div class="mz-page">
        <div class="mz-card mz-hero">
          <div class="mz-coin" aria-hidden="true">🪙</div>
          <h1>Income &amp; Maaser Tracker</h1>
          <p>Track what you earn, what you owe in maaser, and what you have given, by
             income source. No account and no email address, ever.</p>
          <button class="mz-btn mz-btn-primary mz-btn-lg mz-btn-block" data-action="create-tracker">
            Create My Tracker
          </button>
        </div>
        <button class="mz-btn mz-btn-block" data-action="show-open-form">Open Existing Tracker</button>
        ${remembered.length ? `
          <div class="mz-section-title">Recently opened on this device</div>
          ${remembered.map((t) => `
            <button class="mz-btn mz-btn-block" style="justify-content:space-between;margin-bottom:0.5rem" data-action="open-remembered" data-token="${escapeHtml(t.token)}">
              <span>Tracker ending in ${escapeHtml(t.token.slice(-6))}</span>
              <span aria-hidden="true">→</span>
            </button>`).join('')}
        ` : ''}
        <p style="text-align:center;margin-top:1.4rem;"><a class="mz-back-link" href="#recover" style="justify-content:center;">Lost your link? Recover with your recovery code</a></p>
      </div>`;
  }

  function renderOpenForm() {
    root.innerHTML = `
      <div class="mz-page">
        <a class="mz-back-link" href="#" data-action="back-to-landing">&larr; Back</a>
        <div class="mz-card">
          <h1>Open Existing Tracker</h1>
          <p>Paste the private link (or just the code from it) you saved when you created your tracker.</p>
          <form data-form="open">
            <div class="mz-field">
              <label for="open-link">Private link or code</label>
              <textarea id="open-link" class="mz-input" rows="2" placeholder="https://.../maaser/#t=ABCDE-FGHJK-..." autofocus></textarea>
              <div class="mz-hint" id="open-hint"></div>
            </div>
            <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit">Open Tracker</button>
          </form>
        </div>
      </div>`;
  }

  function renderOpenError() {
    root.innerHTML = `
      <div class="mz-page">
        <a class="mz-back-link" href="#" data-action="back-to-landing">&larr; Back</a>
        <div class="mz-card">
          <h1>Could not open that tracker</h1>
          <div class="mz-notice mz-notice-danger">${escapeHtml(view.message || 'That link did not open a tracker.')}</div>
          <p>Double check the link was copied in full. If you still have it, try pasting it again,
             or use your recovery code if the link itself is lost.</p>
          <button class="mz-btn mz-btn-block" data-action="show-open-form">Try Again</button>
        </div>
      </div>`;
  }

  function renderPinScreen() {
    root.innerHTML = `
      <div class="mz-page">
        <a class="mz-back-link" href="#" data-action="back-to-landing">&larr; Back</a>
        <div class="mz-card">
          <h1>Enter PIN</h1>
          <p>This tracker is protected with a PIN in addition to its private link.</p>
          ${view.wrong ? '<div class="mz-notice mz-notice-danger">Wrong PIN. Try again.</div>' : ''}
          <form data-form="pin">
            <div class="mz-field">
              <label for="pin-input">PIN</label>
              <input id="pin-input" class="mz-input" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" autofocus>
            </div>
            <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit">Unlock</button>
          </form>
        </div>
      </div>`;
  }

  function renderCreated() {
    const { token, recoveryCode } = view;
    root.innerHTML = `
      <div class="mz-page">
        <div class="mz-card">
          <h1>Your tracker is ready</h1>
          <div class="mz-notice mz-notice-warn">
            <strong>This private link is the only key to your records.</strong>
            Anyone who has it can view and change this tracker's income and giving unless you
            turn on a PIN in Settings. There is no username or password behind it, so save it
            somewhere safe before you enter any financial information.
          </div>

          <div class="mz-field">
            <label>Your private link</label>
            <div class="mz-link-box"><code>${escapeHtml(trackerLink(token))}</code></div>
            <button class="mz-btn mz-btn-block" data-action="copy-link" data-token="${escapeHtml(token)}">Copy Private Link</button>
            <div class="mz-hint">
              Bookmark it now: on a phone, use your browser's Share or Add to Home Screen
              option; on a computer, press Ctrl+D (Cmd+D on a Mac). You can also just keep
              this tab open.
            </div>
          </div>

          <div class="mz-field">
            <label>Your recovery code</label>
            <p style="margin-top:-0.2rem">If you ever lose the link above, this code is the
               only other way back in. It works on its own, separately from the link.</p>
            <div class="mz-link-box"><code>${escapeHtml(recoveryCode)}</code></div>
            <div class="mz-actions-row" style="margin:0 0 0.5rem">
              <button class="mz-btn" data-action="copy-recovery" data-code="${escapeHtml(recoveryCode)}">Copy Code</button>
              <button class="mz-btn" data-action="download-recovery" data-token="${escapeHtml(token)}" data-code="${escapeHtml(recoveryCode)}">Download</button>
            </div>
          </div>

          <label class="mz-checkbox-row">
            <input type="checkbox" id="saved-confirm">
            <span>I saved my private link and recovery code somewhere safe.</span>
          </label>
          <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" id="continue-btn" data-action="continue-to-tracker" data-token="${escapeHtml(token)}" disabled>
            Continue to My Tracker
          </button>
        </div>
      </div>`;
    const checkbox = document.getElementById('saved-confirm');
    const continueBtn = document.getElementById('continue-btn');
    checkbox.addEventListener('change', () => { continueBtn.disabled = !checkbox.checked; });
  }

  function renderRecover() {
    root.innerHTML = `
      <div class="mz-page">
        <a class="mz-back-link" href="#" data-action="back-to-landing">&larr; Back</a>
        <div class="mz-card">
          <h1>Recover Your Tracker</h1>
          <p>Enter the recovery code you were given when the tracker was created. This
             replaces your private link with a new one and, if you choose, resets your PIN.
             The old link stops working the moment recovery succeeds.</p>
          <div class="mz-notice mz-notice-warn">If both your private link and your recovery
             code are lost, this tracker cannot be recovered. There is no other way in.</div>
          <form data-form="recover">
            <div class="mz-field">
              <label for="recovery-input">Recovery code</label>
              <input id="recovery-input" class="mz-input" autocomplete="off" autofocus placeholder="ABCDE-FGHJK-...">
            </div>
            <label class="mz-checkbox-row">
              <input type="checkbox" id="reset-pin-check">
              <span>Also remove the PIN on this tracker (if any)</span>
            </label>
            <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit">Recover Access</button>
          </form>
        </div>
      </div>`;
  }

  function renderRecovered() {
    const { token, recoveryCode, pinCleared } = view;
    root.innerHTML = `
      <div class="mz-page">
        <div class="mz-card">
          <h1>Access recovered</h1>
          <div class="mz-notice mz-notice-info">Your old private link and old recovery code
             have both been turned off. ${pinCleared ? 'The PIN on this tracker was removed.' : ''}</div>
          <div class="mz-field">
            <label>Your new private link</label>
            <div class="mz-link-box"><code>${escapeHtml(trackerLink(token))}</code></div>
            <button class="mz-btn mz-btn-block" data-action="copy-link" data-token="${escapeHtml(token)}">Copy Private Link</button>
          </div>
          <div class="mz-field">
            <label>Your new recovery code</label>
            <div class="mz-link-box"><code>${escapeHtml(recoveryCode)}</code></div>
            <div class="mz-actions-row" style="margin:0">
              <button class="mz-btn" data-action="copy-recovery" data-code="${escapeHtml(recoveryCode)}">Copy Code</button>
              <button class="mz-btn" data-action="download-recovery" data-token="${escapeHtml(token)}" data-code="${escapeHtml(recoveryCode)}">Download</button>
            </div>
          </div>
          <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" data-action="continue-to-tracker" data-token="${escapeHtml(token)}">
            Continue to My Tracker
          </button>
        </div>
      </div>`;
  }

  // ---- dashboard --------------------------------------------------------------------------

  function renderDashboard() {
    const range = periodRange(period, customFrom, customTo);
    const totals = overallTotals(data, range);
    const allTime = overallTotals(data, null);
    const active = data.sources.filter((s) => !s.archived);
    const archived = data.sources.filter((s) => s.archived);

    root.innerHTML = `
      <header class="mz-topbar">
        <h1>My Maaser Tracker</h1>
        <button class="mz-icon-btn" data-action="open-settings" aria-label="Settings">⚙️</button>
      </header>
      <div class="mz-page">

        <div class="mz-filter-row" role="tablist" aria-label="Time period">
          ${['month', 'year', 'all', 'custom'].map((p) => `
            <button class="mz-pill ${period === p ? 'is-active' : ''}" data-action="set-period" data-period="${p}">
              ${{ month: 'This Month', year: 'This Year', all: 'All Time', custom: 'Custom' }[p]}
            </button>`).join('')}
        </div>
        <div class="mz-custom-range ${period === 'custom' ? 'is-open' : ''}">
          <input type="date" class="mz-input" id="custom-from" value="${customFrom}">
          <input type="date" class="mz-input" id="custom-to" value="${customTo}">
        </div>

        <div class="mz-summary-grid">
          <div class="mz-summary-card">
            <div class="mz-summary-label">Total Income</div>
            <div class="mz-summary-amount">${money(totals.incomeCents)}</div>
          </div>
          <div class="mz-summary-card">
            <div class="mz-summary-label">Maaser Goal</div>
            <div class="mz-summary-amount">${money(totals.goalCents)}</div>
          </div>
          <div class="mz-summary-card">
            <div class="mz-summary-label">Total Given</div>
            <div class="mz-summary-amount">${money(totals.givenTotalCents)}</div>
          </div>
          <div class="mz-summary-card">
            <div class="mz-summary-label">${totals.netCents >= 0 ? 'Remaining to Give' : 'Ahead'}</div>
            <div class="mz-summary-amount ${totals.netCents >= 0 ? 'is-remaining' : 'is-ahead'}">${money(Math.abs(totals.netCents))}</div>
          </div>
        </div>

        <div class="mz-balance-banner ${allTime.netCents > 0 ? 'is-remaining' : allTime.netCents < 0 ? 'is-ahead' : 'is-even'}">
          <div>
            <div class="mz-balance-label">All Time Balance</div>
            <div style="font-size:0.85rem;color:var(--ink-soft)">Every entry ever recorded, regardless of the filter above.</div>
          </div>
          <div class="mz-balance-amount ${allTime.netCents > 0 ? 'is-remaining' : allTime.netCents < 0 ? 'is-ahead' : ''}">
            ${allTime.netCents === 0 ? 'Even' : allTime.netCents > 0 ? `${money(allTime.netCents)} remaining` : `${money(-allTime.netCents)} ahead`}
          </div>
        </div>

        <div class="mz-actions-row">
          <button class="mz-btn mz-btn-primary" data-action="add-income">+ Add Income</button>
          <button class="mz-btn mz-btn-primary" style="background:var(--ahead);border-color:var(--ahead)" data-action="add-giving">+ Add Giving</button>
        </div>

        <div class="mz-section-title">Income Sources</div>
        ${active.map((s) => sourceCardHtml(s, range)).join('') || `
          <div class="mz-empty"><div class="mz-coin">🪙</div>No income sources yet.</div>`}
        <button class="mz-btn mz-btn-block" data-action="new-source" style="margin-bottom:1.2rem">+ Add Income Source</button>

        ${archived.length ? `
          <div class="mz-section-title">Archived Sources</div>
          ${archived.map((s) => sourceCardHtml(s, range, true)).join('')}
        ` : ''}

        <div class="mz-section-title">History</div>
        ${historyHtml(range)}

        <div class="mz-actions-row" style="grid-template-columns:1fr">
          <button class="mz-btn mz-btn-block" data-action="export-csv">Export CSV</button>
        </div>
      </div>`;

    document.getElementById('custom-from')?.addEventListener('change', (e) => { customFrom = e.target.value; render(); });
    document.getElementById('custom-to')?.addEventListener('change', (e) => { customTo = e.target.value; render(); });
  }

  function sourceCardHtml(source, range, archived) {
    const t = sourceTotals(data, source.id, range);
    const statusLabel = t.netCents >= 0 ? 'Remaining to give' : 'Ahead';
    const statusClass = t.netCents >= 0 ? 'is-remaining' : 'is-ahead';
    return `
      <div class="mz-card mz-source-card">
        <div class="mz-source-head">
          <div class="mz-source-name">${escapeHtml(source.name)}</div>
          <div class="mz-source-pct">${formatPercent(source.default_percent)}%</div>
        </div>
        <div class="mz-source-stats">
          <div><div class="mz-stat-label">Total Income</div><div class="mz-stat-value">${money(t.incomeCents)}</div></div>
          <div><div class="mz-stat-label">Maaser Goal</div><div class="mz-stat-value">${money(t.goalCents)}</div></div>
          <div><div class="mz-stat-label">Total Given</div><div class="mz-stat-value">${money(t.givenTotalCents)}</div></div>
          <div><div class="mz-stat-label">${statusLabel}</div><div class="mz-stat-value ${statusClass}">${money(Math.abs(t.netCents))}</div></div>
        </div>
        ${archived ? `<p class="mz-archived-note">Archived. Its records and balances are kept.</p>
          <button class="mz-btn mz-btn-block" data-action="unarchive-source" data-id="${source.id}">Unarchive</button>` : `
        <div class="mz-source-actions">
          <button class="mz-btn" data-action="add-income" data-source="${source.id}">+ Income</button>
          <button class="mz-btn" data-action="add-giving" data-source="${source.id}">+ Giving</button>
        </div>
        <div class="mz-source-edit"><button data-action="edit-source" data-id="${source.id}">Edit source</button></div>`}
      </div>`;
  }

  function formatPercent(p) {
    return Number.isInteger(p) ? String(p) : p.toFixed(1).replace(/\.0$/, '');
  }

  function historyHtml(range) {
    const incomeRows = data.income.filter((e) => inRange(e.entry_date, range)).map((e) => ({ kind: 'income', e }));
    const givingRows = data.giving.filter((g) => inRange(g.entry_date, range)).map((g) => ({ kind: 'giving', g }));
    let rows = [...incomeRows, ...givingRows];
    if (historyTab !== 'all') rows = rows.filter((r) => r.kind === historyTab);
    rows.sort((a, b) => {
      const da = a.kind === 'income' ? a.e.entry_date : a.g.entry_date;
      const db = b.kind === 'income' ? b.e.entry_date : b.g.entry_date;
      return db.localeCompare(da);
    });
    const sourceName = (id) => data.sources.find((s) => s.id === id)?.name || 'Unknown source';

    const tabs = `<div class="mz-history-tabs">
      ${['all', 'income', 'giving'].map((t) => `<button class="mz-pill ${historyTab === t ? 'is-active' : ''}" data-action="set-history-tab" data-tab="${t}">${t === 'all' ? 'All' : t === 'income' ? 'Income' : 'Giving'}</button>`).join('')}
    </div>`;

    if (!rows.length) return tabs + `<div class="mz-empty">No entries in this range yet.</div>`;

    const list = rows.slice(0, 60).map((r) => {
      if (r.kind === 'income') {
        const e = r.e;
        return `<div class="mz-history-row">
          <div class="mz-history-main">
            <div class="mz-history-title">${escapeHtml(sourceName(e.source_id))}</div>
            <div class="mz-history-sub">${formatDateLabel(e.entry_date)} &middot; income &middot; ${formatPercent(e.percent)}% = ${money(e.maaser_cents)} maaser${e.note ? ' &middot; ' + escapeHtml(e.note) : ''}</div>
            <div class="mz-history-controls">
              <button data-action="edit-income" data-id="${e.id}">Edit</button>
              <button data-action="delete-income" data-id="${e.id}">Delete</button>
            </div>
          </div>
          <div class="mz-history-amount is-income">+${money(e.amount_cents)}</div>
        </div>`;
      }
      const g = r.g;
      const allocs = data.allocations.filter((a) => a.giving_id === g.id);
      const splitLabel = allocs.length > 1 ? `split across ${allocs.length} sources` : sourceName(allocs[0]?.source_id);
      return `<div class="mz-history-row">
        <div class="mz-history-main">
          <div class="mz-history-title">${escapeHtml(splitLabel)}</div>
          <div class="mz-history-sub">${formatDateLabel(g.entry_date)} &middot; giving${g.recipient ? ' to ' + escapeHtml(g.recipient) : ''}${g.note ? ' &middot; ' + escapeHtml(g.note) : ''}</div>
          <div class="mz-history-controls">
            <button data-action="delete-giving" data-id="${g.id}">Delete</button>
          </div>
        </div>
        <div class="mz-history-amount is-giving">${money(g.amount_cents)}</div>
      </div>`;
    }).join('');
    return tabs + `<div class="mz-card" style="padding:0.2rem 1.1rem">${list}</div>`;
  }

  // ---------------------------------------------------------------------------------------
  // Sheets (modals): add income, add giving, source editor, settings
  // ---------------------------------------------------------------------------------------

  function openSheet(html, onMount) {
    const backdrop = document.createElement('div');
    backdrop.className = 'mz-sheet-backdrop';
    backdrop.innerHTML = `<div class="mz-sheet">${html}</div>`;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSheet(); });
    // Appended inside #root, not document.body: the root's click listener below is delegated
    // (root.addEventListener, not document's), so a data-action button that lives only in a
    // sheet - the (x) close button, Export CSV inside Settings - would otherwise sit outside
    // that listener's subtree and never fire. position: fixed still renders it full-viewport
    // regardless of this nesting.
    root.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(backdrop);
    return backdrop;
  }
  function closeSheet() {
    document.querySelectorAll('.mz-sheet-backdrop').forEach((n) => n.remove());
    document.body.style.overflow = '';
  }

  function saveStateRow(container) {
    return `<div class="mz-save-row" data-save-row></div>`;
  }
  function setSaveState(container, state, message) {
    const row = container.querySelector('[data-save-row]');
    if (!row) return;
    row.className = 'mz-save-row' + (state === 'error' ? ' is-error' : state === 'ok' ? ' is-ok' : '');
    if (state === 'saving') row.innerHTML = `<span class="mz-spinner"></span> Saving…`;
    else if (state === 'ok') row.innerHTML = `Saved.`;
    else if (state === 'error') row.innerHTML = `${escapeHtml(message || 'Failed to save.')} <button class="mz-btn" data-retry style="min-height:auto;padding:0.3rem 0.7rem;margin-left:0.4rem">Retry</button>`;
    else row.innerHTML = '';
  }

  function openAddIncomeSheet(preselectSourceId) {
    const sources = data.sources.filter((s) => !s.archived);
    if (!sources.length) { showToast('Add an income source first.'); return; }
    const defaultSource = sources.find((s) => s.id === preselectSourceId) || sources[0];
    const idemKey = uid();
    const sheet = openSheet(`
      <div class="mz-sheet-head"><h2>Add Income</h2><button class="mz-icon-btn" data-action="close-sheet">&times;</button></div>
      <form data-form="add-income">
        <div class="mz-field">
          <label for="inc-source">Income source</label>
          <select id="inc-source" class="mz-select">
            ${sources.map((s) => `<option value="${s.id}" data-pct="${s.default_percent}" ${s.id === defaultSource.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="mz-field">
          <label for="inc-amount">Amount earned</label>
          <div class="mz-amount-field"><span class="mz-dollar">$</span>
            <input id="inc-amount" class="mz-input" type="text" inputmode="decimal" placeholder="0.00" autofocus required>
          </div>
        </div>
        <div class="mz-field">
          <label>Maaser percent</label>
          <div class="mz-pct-row" id="inc-pct-row">
            ${[10, 20].map((p) => `<button type="button" class="mz-pct-choice" data-pct="${p}">${p}%</button>`).join('')}
            <button type="button" class="mz-pct-choice" data-pct="custom">Custom</button>
          </div>
          <input id="inc-pct-custom" class="mz-input" style="margin-top:0.5rem;display:none" type="text" inputmode="decimal" placeholder="Percent">
        </div>
        <div class="mz-calc-preview"><span>Maaser on this income</span><span id="inc-preview">$0.00</span></div>
        <div class="mz-field">
          <label for="inc-date">Date</label>
          <input id="inc-date" class="mz-input" type="date" value="${todayIso()}">
        </div>
        <div class="mz-field">
          <label for="inc-note">Note (optional)</label>
          <input id="inc-note" class="mz-input" type="text" maxlength="500">
        </div>
        ${saveStateRow()}
        <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit">Save Income</button>
      </form>`, (el) => {
      const sourceSel = el.querySelector('#inc-source');
      const amountInput = el.querySelector('#inc-amount');
      const pctRow = el.querySelector('#inc-pct-row');
      const pctCustom = el.querySelector('#inc-pct-custom');
      const preview = el.querySelector('#inc-preview');
      let selectedPct = defaultSource.default_percent;

      function markPct() {
        pctRow.querySelectorAll('.mz-pct-choice').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.pct == selectedPct || (b.dataset.pct === 'custom' && ![10, 20].includes(selectedPct)));
        });
      }
      function updatePreview() {
        const cents = parseDollarsToCents(amountInput.value) || 0;
        preview.textContent = money(Math.round(cents * selectedPct / 100));
      }
      pctRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.mz-pct-choice');
        if (!btn) return;
        if (btn.dataset.pct === 'custom') {
          pctCustom.style.display = 'block';
          pctCustom.focus();
          selectedPct = parseFloat(pctCustom.value) || 0;
        } else {
          pctCustom.style.display = 'none';
          selectedPct = Number(btn.dataset.pct);
        }
        markPct();
        updatePreview();
      });
      pctCustom.addEventListener('input', () => { selectedPct = parseFloat(pctCustom.value) || 0; updatePreview(); });
      sourceSel.addEventListener('change', () => {
        const opt = sourceSel.selectedOptions[0];
        selectedPct = Number(opt.dataset.pct);
        pctCustom.style.display = 'none';
        markPct(); updatePreview();
      });
      amountInput.addEventListener('input', updatePreview);
      markPct(); updatePreview();

      async function submit() {
        const amountCents = parseDollarsToCents(amountInput.value);
        if (amountCents == null || amountCents <= 0) { setSaveState(el, 'error', 'Enter a valid amount.'); return; }
        if (!selectedPct || selectedPct <= 0) { setSaveState(el, 'error', 'Enter a valid percent.'); return; }
        setSaveState(el, 'saving');
        try {
          await api('/api/income', {
            method: 'POST',
            headers: { 'idempotency-key': idemKey },
            body: JSON.stringify({
              sourceId: sourceSel.value,
              amount: amountCents / 100,
              date: el.querySelector('#inc-date').value || todayIso(),
              percent: selectedPct,
              note: el.querySelector('#inc-note').value,
            }),
          });
          await refreshState();
          setSaveState(el, 'ok');
          showToast('Income saved.');
          closeSheet();
          render();
        } catch (err) {
          setSaveState(el, 'error', err.message);
        }
      }
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      el.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) submit(); });
    });
  }

  function openAddGivingSheet(preselectSourceId) {
    const sources = data.sources.filter((s) => !s.archived);
    if (!sources.length) { showToast('Add an income source first.'); return; }
    const idemKey = uid();
    let rows = [{ sourceId: preselectSourceId || sources[0].id, amount: '' }];
    let splitMode = false;

    const sheet = openSheet(`
      <div class="mz-sheet-head"><h2>Add Giving</h2><button class="mz-icon-btn" data-action="close-sheet">&times;</button></div>
      <form data-form="add-giving">
        <div class="mz-field">
          <label for="give-amount">Amount given</label>
          <div class="mz-amount-field"><span class="mz-dollar">$</span>
            <input id="give-amount" class="mz-input" type="text" inputmode="decimal" placeholder="0.00" autofocus required>
          </div>
        </div>
        <div id="split-toggle-wrap" class="mz-field">
          <button type="button" class="mz-btn" id="split-toggle">Split across sources (advanced)</button>
        </div>
        <div id="split-area"></div>
        <div class="mz-field" id="single-source-field">
          <label for="give-source">Income source</label>
          <select id="give-source" class="mz-select">
            ${sources.map((s) => `<option value="${s.id}" ${s.id === rows[0].sourceId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="mz-field">
          <label for="give-date">Date</label>
          <input id="give-date" class="mz-input" type="date" value="${todayIso()}">
        </div>
        <div class="mz-field">
          <label for="give-recipient">Recipient (optional)</label>
          <input id="give-recipient" class="mz-input" type="text" maxlength="120">
        </div>
        <div class="mz-field">
          <label for="give-note">Note (optional)</label>
          <input id="give-note" class="mz-input" type="text" maxlength="500">
        </div>
        ${saveStateRow()}
        <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit" style="background:var(--ahead);border-color:var(--ahead)">Save Giving</button>
      </form>`, (el) => {
      const amountInput = el.querySelector('#give-amount');
      const splitToggle = el.querySelector('#split-toggle');
      const splitArea = el.querySelector('#split-area');
      const singleField = el.querySelector('#single-source-field');

      function renderSplit() {
        if (!splitMode) { splitArea.innerHTML = ''; singleField.style.display = ''; return; }
        singleField.style.display = 'none';
        const total = parseDollarsToCents(amountInput.value) || 0;
        const sum = rows.reduce((s, r) => s + (parseDollarsToCents(r.amount) || 0), 0);
        splitArea.innerHTML = `
          ${rows.map((r, i) => `
            <div class="mz-split-row">
              <select class="mz-select" data-split-source="${i}">
                ${sources.map((s) => `<option value="${s.id}" ${s.id === r.sourceId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
              </select>
              <div class="mz-amount-field"><span class="mz-dollar">$</span>
                <input class="mz-input" type="text" inputmode="decimal" placeholder="0.00" data-split-amount="${i}" value="${escapeHtml(r.amount)}">
              </div>
              <button type="button" class="mz-split-remove" data-split-remove="${i}" aria-label="Remove">&times;</button>
            </div>`).join('')}
          <button type="button" class="mz-btn" id="split-add-row">+ Add another source</button>
          <div class="mz-split-total ${sum === total && total > 0 ? 'is-good' : 'is-bad'}">
            Split total: ${money(sum)} of ${money(total)} ${sum === total && total > 0 ? '(matches)' : '(must match the amount above)'}
          </div>`;
      }
      splitToggle.addEventListener('click', () => {
        splitMode = !splitMode;
        splitToggle.textContent = splitMode ? 'Use a single source instead' : 'Split across sources (advanced)';
        if (splitMode && rows.length < 2) rows.push({ sourceId: sources[Math.min(1, sources.length - 1)].id, amount: '' });
        renderSplit();
      });
      splitArea.addEventListener('input', (e) => {
        const si = e.target.dataset.splitAmount;
        if (si != null) { rows[si].amount = e.target.value; renderSplit(); preserveFocus(splitArea, `[data-split-amount="${si}"]`); }
      });
      splitArea.addEventListener('change', (e) => {
        const si = e.target.dataset.splitSource;
        if (si != null) rows[si].sourceId = e.target.value;
      });
      splitArea.addEventListener('click', (e) => {
        if (e.target.id === 'split-add-row') { rows.push({ sourceId: sources[0].id, amount: '' }); renderSplit(); }
        const ri = e.target.dataset.splitRemove;
        if (ri != null && rows.length > 1) { rows.splice(ri, 1); renderSplit(); }
      });
      amountInput.addEventListener('input', () => { if (splitMode) renderSplit(); });

      function preserveFocus(container, selector) {
        const el2 = container.querySelector(selector);
        if (el2 && document.activeElement !== el2) {
          const pos = el2.selectionStart;
          el2.focus();
          try { el2.setSelectionRange(pos, pos); } catch {}
        }
      }

      async function submit() {
        const totalCents = parseDollarsToCents(amountInput.value);
        if (totalCents == null || totalCents <= 0) { setSaveState(el, 'error', 'Enter a valid amount.'); return; }
        let allocations;
        if (splitMode) {
          allocations = rows.map((r) => ({ sourceId: r.sourceId, amount: (parseDollarsToCents(r.amount) || 0) / 100 }));
          const sum = allocations.reduce((s, a) => s + Math.round(a.amount * 100), 0);
          if (sum !== totalCents) { setSaveState(el, 'error', 'The split amounts must add up to the total.'); return; }
        }
        setSaveState(el, 'saving');
        try {
          await api('/api/giving', {
            method: 'POST',
            headers: { 'idempotency-key': idemKey },
            body: JSON.stringify({
              amount: totalCents / 100,
              date: el.querySelector('#give-date').value || todayIso(),
              recipient: el.querySelector('#give-recipient').value,
              note: el.querySelector('#give-note').value,
              ...(splitMode ? { allocations } : { sourceId: el.querySelector('#give-source').value }),
            }),
          });
          await refreshState();
          setSaveState(el, 'ok');
          showToast('Giving saved.');
          closeSheet();
          render();
        } catch (err) {
          setSaveState(el, 'error', err.message);
        }
      }
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      el.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) submit(); });
    });
  }

  function openNewSourceSheet() {
    openSheet(`
      <div class="mz-sheet-head"><h2>Add Income Source</h2><button class="mz-icon-btn" data-action="close-sheet">&times;</button></div>
      <form data-form="new-source">
        <div class="mz-field"><label for="src-name">Name</label><input id="src-name" class="mz-input" type="text" maxlength="80" placeholder="e.g. Business" autofocus required></div>
        <div class="mz-field">
          <label>Default maaser percent</label>
          <div class="mz-pct-row" id="src-pct-row">
            ${[10, 20].map((p) => `<button type="button" class="mz-pct-choice ${p === 10 ? 'is-active' : ''}" data-pct="${p}">${p}%</button>`).join('')}
            <button type="button" class="mz-pct-choice" data-pct="custom">Custom</button>
          </div>
          <input id="src-pct-custom" class="mz-input" style="margin-top:0.5rem;display:none" type="text" inputmode="decimal" placeholder="Percent">
        </div>
        ${saveStateRow()}
        <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit">Add Source</button>
      </form>`, (el) => {
      let pct = 10;
      const pctRow = el.querySelector('#src-pct-row');
      const pctCustom = el.querySelector('#src-pct-custom');
      pctRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.mz-pct-choice'); if (!btn) return;
        pctRow.querySelectorAll('.mz-pct-choice').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        if (btn.dataset.pct === 'custom') { pctCustom.style.display = 'block'; pctCustom.focus(); pct = parseFloat(pctCustom.value) || 0; }
        else { pctCustom.style.display = 'none'; pct = Number(btn.dataset.pct); }
      });
      pctCustom.addEventListener('input', () => { pct = parseFloat(pctCustom.value) || 0; });

      async function submit() {
        const name = el.querySelector('#src-name').value.trim();
        if (!name) { setSaveState(el, 'error', 'Give the source a name.'); return; }
        setSaveState(el, 'saving');
        try {
          await api('/api/sources', { method: 'POST', headers: { 'idempotency-key': uid() }, body: JSON.stringify({ name, defaultPercent: pct }) });
          await refreshState();
          setSaveState(el, 'ok');
          closeSheet();
          render();
        } catch (err) { setSaveState(el, 'error', err.message); }
      }
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      el.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) submit(); });
    });
  }

  function openEditSourceSheet(sourceId) {
    const source = data.sources.find((s) => s.id === sourceId);
    if (!source) return;
    openSheet(`
      <div class="mz-sheet-head"><h2>Edit ${escapeHtml(source.name)}</h2><button class="mz-icon-btn" data-action="close-sheet">&times;</button></div>
      <form data-form="edit-source">
        <div class="mz-field"><label for="es-name">Name</label><input id="es-name" class="mz-input" type="text" maxlength="80" value="${escapeHtml(source.name)}"></div>
        <div class="mz-field"><label for="es-pct">Default maaser percent</label><input id="es-pct" class="mz-input" type="text" inputmode="decimal" value="${formatPercent(source.default_percent)}">
          <div class="mz-hint">Changes apply to future income only. Past entries keep the percent they were saved with.</div>
        </div>
        ${saveStateRow()}
        <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit">Save Changes</button>
      </form>
      <div class="mz-section-title">Opening Balance</div>
      <p style="margin-top:-0.4rem">A one-time starting point for this source, from before this tracker existed. Not income and not a donation.</p>
      <button class="mz-btn mz-btn-block" id="open-opening-btn" type="button">Set Opening Balance</button>
      <div class="mz-section-title">Archive</div>
      <p style="margin-top:-0.4rem">Archiving hides this source from the main list. Its records and balances are kept and it can be unarchived any time.</p>
      <button class="mz-btn mz-btn-block mz-btn-danger" id="archive-btn" type="button">Archive This Source</button>`, (el) => {
      async function submit() {
        const name = el.querySelector('#es-name').value.trim();
        const pct = parseFloat(el.querySelector('#es-pct').value);
        if (!name) { setSaveState(el, 'error', 'Give the source a name.'); return; }
        if (!Number.isFinite(pct) || pct < 0) { setSaveState(el, 'error', 'Enter a valid percent.'); return; }
        setSaveState(el, 'saving');
        try {
          await api(`/api/sources/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ name, defaultPercent: pct }) });
          await refreshState();
          setSaveState(el, 'ok');
          closeSheet();
          render();
        } catch (err) { setSaveState(el, 'error', err.message); }
      }
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      el.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) submit(); });
      el.querySelector('#open-opening-btn').addEventListener('click', () => { closeSheet(); openOpeningBalanceSheet(sourceId); });
      el.querySelector('#archive-btn').addEventListener('click', async () => {
        if (!confirm(`Archive ${source.name}? Its records and balances will be kept.`)) return;
        await api(`/api/sources/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) });
        await refreshState();
        closeSheet();
        render();
      });
    });
  }

  function openOpeningBalanceSheet(sourceId) {
    const source = data.sources.find((s) => s.id === sourceId);
    openSheet(`
      <div class="mz-sheet-head"><h2>Opening Balance</h2><button class="mz-icon-btn" data-action="close-sheet">&times;</button></div>
      <form data-form="opening">
        <p>What ${escapeHtml(source.name)}'s balance was before this tracker started, as of a date you choose.</p>
        <div class="mz-field">
          <label>This amount was</label>
          <div class="mz-pct-row">
            <button type="button" class="mz-pct-choice is-active" data-type="remaining">Remaining to give</button>
            <button type="button" class="mz-pct-choice" data-type="ahead">Already given ahead</button>
          </div>
        </div>
        <div class="mz-field">
          <label for="ob-amount">Amount</label>
          <div class="mz-amount-field"><span class="mz-dollar">$</span><input id="ob-amount" class="mz-input" type="text" inputmode="decimal" placeholder="0.00" autofocus></div>
        </div>
        <div class="mz-field"><label for="ob-date">As of date</label><input id="ob-date" class="mz-input" type="date" value="${todayIso()}"></div>
        <div class="mz-field"><label for="ob-note">Note (optional)</label><input id="ob-note" class="mz-input" type="text" maxlength="500"></div>
        ${saveStateRow()}
        <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit">Save Opening Balance</button>
      </form>`, (el) => {
      let type = 'remaining';
      el.querySelectorAll('.mz-pct-choice').forEach((b) => b.addEventListener('click', () => {
        el.querySelectorAll('.mz-pct-choice').forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active'); type = b.dataset.type;
      }));
      async function submit() {
        const cents = parseDollarsToCents(el.querySelector('#ob-amount').value);
        if (cents == null || cents <= 0) { setSaveState(el, 'error', 'Enter a valid amount.'); return; }
        setSaveState(el, 'saving');
        try {
          await api('/api/opening', {
            method: 'POST', headers: { 'idempotency-key': uid() },
            body: JSON.stringify({ sourceId, type, amount: cents / 100, date: el.querySelector('#ob-date').value, note: el.querySelector('#ob-note').value }),
          });
          await refreshState();
          setSaveState(el, 'ok');
          closeSheet();
          render();
        } catch (err) { setSaveState(el, 'error', err.message); }
      }
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      el.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) submit(); });
    });
  }

  function openSettingsSheet() {
    const pinEnabled = !!data.pinEnabled;
    openSheet(`
      <div class="mz-sheet-head"><h2>Settings</h2><button class="mz-icon-btn" data-action="close-sheet">&times;</button></div>

      <div class="mz-section-title" style="margin-top:0">PIN Protection</div>
      <p>${pinEnabled ? 'A PIN is currently required, in addition to the private link.' : 'No PIN is set. Anyone with your private link can open and change this tracker.'}</p>
      <form data-form="pin-settings">
        ${!pinEnabled ? `
          <div class="mz-field"><label for="new-pin">Set a PIN (4-10 digits)</label><input id="new-pin" class="mz-input" type="password" inputmode="numeric" pattern="[0-9]*"></div>
          <button class="mz-btn mz-btn-primary mz-btn-block" type="submit">Turn On PIN</button>
        ` : `
          <button class="mz-btn mz-btn-danger mz-btn-block" type="submit" data-remove-pin>Turn Off PIN</button>
        `}
        ${saveStateRow()}
      </form>

      <div class="mz-section-title">Private Link</div>
      <p>If you think your link may have been seen by someone else, replace it. The old link
         stops working immediately.</p>
      <button class="mz-btn mz-btn-danger mz-btn-block" id="rotate-link-btn">Replace Private Link</button>

      <div class="mz-section-title">Export</div>
      <button class="mz-btn mz-btn-block" data-action="export-csv">Export CSV</button>`, (el) => {
      el.querySelector('[data-form="pin-settings"]').addEventListener('submit', async (e) => {
        e.preventDefault();
        setSaveState(el, 'saving');
        try {
          if (pinEnabled) {
            if (!confirm('Turn off the PIN? Anyone with the private link will then be able to open this tracker.')) { setSaveState(el, ''); return; }
            await api('/api/settings/pin', { method: 'POST', body: JSON.stringify({ pin: null }) });
            session.pin = null;
          } else {
            const pin = el.querySelector('#new-pin').value;
            if (!/^\d{4,10}$/.test(pin)) { setSaveState(el, 'error', 'PIN must be 4 to 10 digits.'); return; }
            await api('/api/settings/pin', { method: 'POST', body: JSON.stringify({ pin }) });
            session.pin = pin;
          }
          await refreshState();
          setSaveState(el, 'ok');
          closeSheet();
          render();
        } catch (err) { setSaveState(el, 'error', err.message); }
      });
      el.querySelector('#rotate-link-btn').addEventListener('click', async () => {
        if (!confirm('Replace your private link? Your current link will stop working immediately, so copy the new one before leaving this screen.')) return;
        try {
          const res = await api('/api/settings/rotate-link', { method: 'POST' });
          session.token = res.token;
          rememberTracker(res.token);
          closeSheet();
          openSheet(`
            <div class="mz-sheet-head"><h2>New Private Link</h2></div>
            <div class="mz-notice mz-notice-warn">Your old link no longer works. Save this new one before continuing.</div>
            <div class="mz-link-box"><code>${escapeHtml(trackerLink(res.token))}</code></div>
            <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" data-action="copy-link" data-token="${escapeHtml(res.token)}">Copy Private Link</button>
            <button class="mz-btn mz-btn-block" data-action="close-sheet" style="margin-top:0.6rem">Done</button>`);
          history.replaceState(null, '', `#t=${res.token}`);
        } catch (err) { showToast(err.message); }
      });
    });
  }

  // ---------------------------------------------------------------------------------------
  // CSV export
  // ---------------------------------------------------------------------------------------

  const CSV_NEEDS_QUOTING = /[",\n]/;
  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return CSV_NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    const sourceName = (id) => data.sources.find((s) => s.id === id)?.name || '';
    const lines = [['type', 'date', 'source', 'amount', 'percent', 'maaser_amount', 'recipient', 'balance_type', 'note']];
    for (const e of data.income) lines.push(['income', e.entry_date, sourceName(e.source_id), (e.amount_cents / 100).toFixed(2), e.percent, (e.maaser_cents / 100).toFixed(2), '', '', e.note || '']);
    for (const g of data.giving) {
      const allocs = data.allocations.filter((a) => a.giving_id === g.id);
      for (const a of allocs) {
        lines.push(['giving', g.entry_date, sourceName(a.source_id), (a.amount_cents / 100).toFixed(2), '', '', g.recipient || '', '', g.note || '']);
      }
    }
    for (const o of data.opening) lines.push(['opening_balance', o.entry_date, sourceName(o.source_id), (o.amount_cents / 100).toFixed(2), '', '', '', o.balance_type, o.note || '']);
    const csv = lines.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `maaser-tracker-${todayIso()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------------------
  // Global event delegation
  // ---------------------------------------------------------------------------------------

  let creatingTracker = false;

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'create-tracker') {
      if (creatingTracker) return; // guards a double tap; the server also idempotency-keys this
      creatingTracker = true;
      btn.disabled = true;
      btn.textContent = 'Creating…';
      const idemKey = uid();
      try {
        const res = await api('/api/trackers', { method: 'POST', headers: { 'idempotency-key': idemKey } });
        setView({ screen: 'created', token: res.token, recoveryCode: res.recoveryCode });
      } catch (err) {
        if (err.code === 'not_configured') {
          setView({ screen: 'not-configured' });
        } else {
          showToast(err.message);
          btn.disabled = false;
          btn.textContent = 'Create My Tracker';
        }
      } finally {
        creatingTracker = false;
      }
      return;
    }
    if (action === 'show-open-form') { setView({ screen: 'open-form' }); return; }
    if (action === 'back-to-landing') { e.preventDefault(); location.hash = ''; setView({ screen: 'landing' }); return; }
    if (action === 'open-remembered') { openTracker(btn.dataset.token); return; }
    if (action === 'continue-to-tracker') { openTracker(btn.dataset.token); return; }
    if (action === 'copy-link') { const ok = await copyText(trackerLink(btn.dataset.token)); showToast(ok ? 'Link copied.' : 'Could not copy automatically; select and copy the text shown.'); return; }
    if (action === 'copy-recovery') { const ok = await copyText(btn.dataset.code); showToast(ok ? 'Recovery code copied.' : 'Could not copy automatically; select and copy the text shown.'); return; }
    if (action === 'download-recovery') {
      const text = `Maaser Tracker recovery information\n\nPrivate link:\n${trackerLink(btn.dataset.token)}\n\nRecovery code:\n${btn.dataset.code}\n\nKeep this somewhere safe. Anyone with the private link can open and change this tracker. The recovery code is the only other way back in if the link is lost.\n`;
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'maaser-tracker-recovery.txt';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return;
    }
    if (action === 'open-settings') { openSettingsSheet(); return; }
    if (action === 'close-sheet') { closeSheet(); return; }
    if (action === 'add-income') { openAddIncomeSheet(btn.dataset.source); return; }
    if (action === 'add-giving') { openAddGivingSheet(btn.dataset.source); return; }
    if (action === 'new-source') { openNewSourceSheet(); return; }
    if (action === 'edit-source') { openEditSourceSheet(btn.dataset.id); return; }
    if (action === 'unarchive-source') {
      await api(`/api/sources/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) });
      await refreshState(); render(); return;
    }
    if (action === 'set-period') { period = btn.dataset.period; render(); return; }
    if (action === 'set-history-tab') { historyTab = btn.dataset.tab; render(); return; }
    if (action === 'export-csv') { exportCsv(); return; }
    if (action === 'edit-income') { openEditIncomeSheet(btn.dataset.id); return; }
    if (action === 'delete-income') {
      if (!confirm('Delete this income entry? This cannot be undone.')) return;
      await api(`/api/income/${btn.dataset.id}`, { method: 'DELETE' });
      await refreshState(); render(); showToast('Deleted.'); return;
    }
    if (action === 'delete-giving') {
      if (!confirm('Delete this giving entry? This cannot be undone.')) return;
      await api(`/api/giving/${btn.dataset.id}`, { method: 'DELETE' });
      await refreshState(); render(); showToast('Deleted.'); return;
    }
  });

  function openEditIncomeSheet(entryId) {
    const entry = data.income.find((e) => e.id === entryId);
    if (!entry) return;
    const sources = data.sources.filter((s) => !s.archived || s.id === entry.source_id);
    openSheet(`
      <div class="mz-sheet-head"><h2>Edit Income</h2><button class="mz-icon-btn" data-action="close-sheet">&times;</button></div>
      <form data-form="edit-income">
        <div class="mz-field"><label for="ei-source">Income source</label>
          <select id="ei-source" class="mz-select">${sources.map((s) => `<option value="${s.id}" ${s.id === entry.source_id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
        </div>
        <div class="mz-field"><label for="ei-amount">Amount earned</label>
          <div class="mz-amount-field"><span class="mz-dollar">$</span><input id="ei-amount" class="mz-input" type="text" inputmode="decimal" value="${(entry.amount_cents / 100).toFixed(2)}"></div>
        </div>
        <div class="mz-field"><label for="ei-pct">Applied percent</label><input id="ei-pct" class="mz-input" type="text" inputmode="decimal" value="${formatPercent(entry.percent)}"></div>
        <div class="mz-calc-preview"><span>Maaser on this income</span><span id="ei-preview">${money(entry.maaser_cents)}</span></div>
        <div class="mz-field"><label for="ei-date">Date</label><input id="ei-date" class="mz-input" type="date" value="${entry.entry_date}"></div>
        <div class="mz-field"><label for="ei-note">Note (optional)</label><input id="ei-note" class="mz-input" type="text" maxlength="500" value="${escapeHtml(entry.note || '')}"></div>
        ${saveStateRow()}
        <button class="mz-btn mz-btn-primary mz-btn-block mz-btn-lg" type="submit">Save Changes</button>
      </form>`, (el) => {
      const amountInput = el.querySelector('#ei-amount');
      const pctInput = el.querySelector('#ei-pct');
      const preview = el.querySelector('#ei-preview');
      function updatePreview() {
        const cents = parseDollarsToCents(amountInput.value) || 0;
        const pct = parseFloat(pctInput.value) || 0;
        preview.textContent = money(Math.round(cents * pct / 100));
      }
      amountInput.addEventListener('input', updatePreview);
      pctInput.addEventListener('input', updatePreview);
      async function submit() {
        const amountCents = parseDollarsToCents(amountInput.value);
        const pct = parseFloat(pctInput.value);
        if (amountCents == null || amountCents <= 0) { setSaveState(el, 'error', 'Enter a valid amount.'); return; }
        if (!Number.isFinite(pct) || pct < 0) { setSaveState(el, 'error', 'Enter a valid percent.'); return; }
        setSaveState(el, 'saving');
        try {
          await api(`/api/income/${entryId}`, {
            method: 'PATCH',
            body: JSON.stringify({ sourceId: el.querySelector('#ei-source').value, amount: amountCents / 100, percent: pct, date: el.querySelector('#ei-date').value, note: el.querySelector('#ei-note').value }),
          });
          await refreshState();
          setSaveState(el, 'ok');
          closeSheet();
          render();
        } catch (err) { setSaveState(el, 'error', err.message); }
      }
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      el.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) submit(); });
    });
  }

  // Forms rendered outside sheets (open, pin, recover)
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;

    if (kind === 'open') {
      const raw = document.getElementById('open-link').value;
      const token = extractToken(raw);
      const hint = document.getElementById('open-hint');
      if (!token) { hint.textContent = "That doesn't look like a valid tracker link for this site. Paste the full link you were given, or just the code after #t=."; hint.style.color = 'var(--danger)'; return; }
      hint.textContent = '';
      openTracker(token);
      return;
    }
    if (kind === 'pin') {
      const pin = document.getElementById('pin-input').value;
      openTracker(view.token, { pin });
      return;
    }
    if (kind === 'recover') {
      const code = document.getElementById('recovery-input').value.trim();
      const resetPin = document.getElementById('reset-pin-check').checked;
      try {
        const res = await api('/api/recovery', { method: 'POST', body: JSON.stringify({ recoveryCode: code, resetPin }) });
        setView({ screen: 'recovered', token: res.token, recoveryCode: res.recoveryCode, pinCleared: res.pinCleared });
      } catch (err) {
        showToast(err.message);
      }
      return;
    }
  });

  function extractToken(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    let candidate = s;
    const hashIdx = s.indexOf('#t=');
    if (hashIdx !== -1) {
      // If it's a full URL, only accept it when it points at this site.
      const beforeHash = s.slice(0, hashIdx);
      if (beforeHash && /^https?:\/\//i.test(beforeHash) && !beforeHash.startsWith(location.origin)) return null;
      candidate = s.slice(hashIdx + 3);
    }
    const normalized = candidate.trim().toUpperCase().replace(/[^0-9A-Z-]/g, '');
    const stripped = normalized.replace(/-/g, '');
    if (stripped.length < 45 || !/^[0-9A-Z]+$/.test(stripped)) return null;
    return normalized;
  }

  // ---------------------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------------------

  function boot() {
    const m = /#t=([^&]+)/.exec(location.hash);
    if (m) { openTracker(decodeURIComponent(m[1])); return; }
    if (location.hash === '#recover') { setView({ screen: 'recover' }); return; }
    setView({ screen: 'landing' });
  }

  window.addEventListener('hashchange', () => {
    if (view.screen === 'dashboard' || view.screen === 'created' || view.screen === 'recovered') return;
    boot();
  });

  boot();
})();
