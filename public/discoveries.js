(() => {
  const root = document.getElementById('discoveries-root');
  if (!root) return;

  const PERIODS = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time']];
  const STATUS = {
    solution: ['Solution available', 'ok', 'Oracle matched these requests to a solution in the catalogue.'],
    person: ['Colleagues can help', 'gold', 'No catalogue solution, but colleagues have the expertise and Oracle pointed to them.'],
    gap: ['No solution yet', 'terra', 'Oracle found neither a solution nor a colleague and suggested building something new.']
  };
  const STAGE = {
    opportunity: ['Opportunity', 'Asked 3 or more times: a pattern, not a one-off.'],
    emerging: ['Emerging', 'Asked fewer than 3 times so far.']
  };
  const GAP_STAGE = {
    opportunity: ['Worth building', 'An unsolved problem asked 3 or more times, so a new solution would be reused.'],
    emerging: ['Watch', 'An unsolved problem asked fewer than 3 times. It may be a one-off, so we only keep an eye on it.']
  };
  const PAGE = 12;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const kindLabel = kind => (String(kind || '').toLowerCase() === 'skill' ? 'playbook / agent skill' : String(kind || 'solution'));

  let period = '30d';
  let latest = 0;
  let data = null;
  let explorer = { tab: 'problems', query: '', filter: 'all', limit: PAGE };

  const tile = (label, value, note, tone = '') => `<div class="disc-tile ${tone}"><span class="disc-label">${esc(label)}</span><strong>${esc(value)}</strong><span class="disc-note">${esc(note)}</span></div>`;
  const chip = (label, tone, hint) => `<span class="disc-chip ${tone}" title="${esc(hint)}">${esc(label)}</span>`;

  function periodBar() {
    return `<div class="disc-periods" role="group" aria-label="Period">${PERIODS.map(([id, label]) => `<button type="button" class="fchip${id === period ? ' on' : ''}" data-disc-period="${id}" aria-pressed="${id === period}">${esc(label)}</button>`).join('')}</div>`;
  }

  function tiles({ totals, catalogue }) {
    const confirmed = totals.confirmed ? ` · ${totals.confirmed} confirmed helpful` : '';
    return `<div class="disc-tiles">
      ${tile('Requests', totals.requests, `from ${plural(totals.askers, 'colleague')}`)}
      ${tile('Solved', totals.solved, `${totals.solvedShare}% of requests${confirmed}`, 'ok')}
      ${tile('Unsolved', totals.open, 'no catalogue match yet', 'terra')}
      ${tile('Skills', catalogue.skills, `${plural(catalogue.expertiseAreas, 'area')} of expertise across ${plural(catalogue.people, 'colleague')}`)}
      ${tile('Apps', catalogue.apps, `${catalogue.runnable} runnable · agents, tools, automations`)}
    </div>${totals.requests ? `<div class="disc-split" role="img" aria-label="${totals.solved} solved, ${totals.open} unsolved"><span class="ok" style="width:${totals.solvedShare}%"></span><span class="terra" style="width:${100 - totals.solvedShare}%"></span></div>` : ''}`;
  }

  function legend() {
    const entry = (label, tone, text) => `<div><dt>${chip(label, tone, text)}</dt><dd>${esc(text)}</dd></div>`;
    return `<details class="disc-legend"><summary>What do these labels mean?</summary><dl>
      ${Object.values(STATUS).map(([label, tone, text]) => entry(label, tone, text)).join('')}
      ${entry(STAGE.opportunity[0], '', STAGE.opportunity[1])}
      ${entry(STAGE.emerging[0], '', STAGE.emerging[1])}
      ${entry(GAP_STAGE.opportunity[0], 'terra', GAP_STAGE.opportunity[1])}
      ${entry(GAP_STAGE.emerging[0], 'terra', GAP_STAGE.emerging[1])}
    </dl><p>Requests are grouped by meaning. Wording from a group is only shown once at least three other colleagues asked the same thing; smaller groups show counts only.</p></details>`;
  }

  function actions(cluster) {
    const solution = cluster.solutionId ? (data.solutions || []).find(item => item.id === cluster.solutionId) : null;
    const topic = esc(cluster.topic || '');
    const buttons = [];
    if (solution?.runnable) buttons.push(`<button type="button" class="btn primary" data-run="${solution.id}">Try it →</button>`);
    if (cluster.solutionId) buttons.push(`<button type="button" class="btn" data-disc-action="solution" data-id="${cluster.solutionId}">Open in catalogue</button>`);
    if (cluster.status === 'gap') buttons.push(`<button type="button" class="btn primary" data-disc-action="share" data-topic="${topic}">Share a solution for this</button>`);
    if (!cluster.solutionId) buttons.push(`<button type="button" class="btn" data-disc-action="ask" data-topic="${topic}">Ask the Oracle</button>`);
    return `<div class="disc-actions">${buttons.join('')}</div>`;
  }

  function problem(cluster, { rank = null, max = 0, compact = false } = {}) {
    const [statusLabel, tone, statusHint] = STATUS[cluster.status] || STATUS.gap;
    const [stageLabel, stageHint] = cluster.status === 'gap' ? GAP_STAGE[cluster.stage] : STAGE[cluster.stage];
    const facts = [
      `${plural(cluster.count, 'request')} from ${plural(cluster.askers, 'colleague')}`,
      cluster.solutions ? `${cluster.solutions} answered by a catalogue solution` : '',
      cluster.colleagues ? `${cluster.colleagues} answered by colleagues` : '',
      cluster.open ? `${cluster.open} still unsolved` : '',
      cluster.confirmed ? `${cluster.confirmed} confirmed helpful` : ''
    ].filter(Boolean).join(' · ');
    const examples = cluster.examples.length ? `<p class="disc-examples">${cluster.examples.map(text => `<q>${esc(text)}</q>`).join(' ')}</p>` : '';
    const bar = max ? `<div class="disc-bar" aria-hidden="true"><span class="${tone}" style="width:${Math.max(4, Math.round((cluster.count / max) * 100))}%"></span></div>` : '';
    return `<details class="disc-item${compact ? ' compact' : ''}">
      <summary>
        ${rank ? `<span class="disc-rank">${rank}</span>` : ''}
        <div class="disc-body">
          <h3>${esc(cluster.title)}</h3>
          <div class="disc-meta">${compact ? '' : chip(statusLabel, tone, statusHint)}${chip(stageLabel, cluster.status === 'gap' ? 'terra' : '', stageHint)}<span class="disc-count">${plural(cluster.count, 'request')} · ${plural(cluster.askers, 'colleague')}${cluster.share != null ? ` · ${cluster.share}%` : ''}</span></div>
          ${bar}
        </div>
        <span class="disc-caret" aria-hidden="true">▾</span>
      </summary>
      <div class="disc-detail"><p class="disc-facts">${esc(facts)}</p>${examples}${actions(cluster)}</div>
    </details>`;
  }

  function solutionItem(solution, max) {
    const demand = solution.requests
      ? `${plural(solution.requests, 'request')} · ${plural(solution.askers, 'colleague')}${solution.confirmed ? ` · ${solution.confirmed} confirmed helpful` : ''}`
      : 'No requests in this period';
    const bar = max && solution.requests ? `<div class="disc-bar" aria-hidden="true"><span class="ok" style="width:${Math.max(4, Math.round((solution.requests / max) * 100))}%"></span></div>` : '';
    const buttons = [
      solution.runnable ? `<button type="button" class="btn primary" data-run="${solution.id}">Try it →</button>` : '',
      `<button type="button" class="btn" data-disc-action="solution" data-id="${solution.id}">Open in catalogue</button>`
    ].join('');
    return `<details class="disc-item">
      <summary>
        <div class="disc-body">
          <h3>${esc(solution.title)}</h3>
          <div class="disc-meta">${chip(kindLabel(solution.kind), '', 'Type of catalogue entry.')}${solution.runnable ? chip('Runnable', 'ok', 'Can be run from PYTHIA.') : ''}<span class="disc-count">${esc(demand)}</span></div>
          ${bar}
        </div>
        <span class="disc-caret" aria-hidden="true">▾</span>
      </summary>
      <div class="disc-detail">${solution.summary ? `<p class="disc-facts">${esc(solution.summary)}</p>` : ''}<div class="disc-actions">${buttons}</div></div>
    </details>`;
  }

  const gaps = list => (list.length
    ? list.map(gap => problem(gap, { compact: true })).join('')
    : '<p class="disc-empty">Every request in this period found an answer. Nothing to build right now.</p>');

  const PROBLEM_FILTERS = [['all', 'All'], ['solution', 'Solution available'], ['person', 'Colleagues can help'], ['gap', 'No solution yet']];
  const SOLUTION_FILTERS = [['all', 'All'], ['requested', 'Requested'], ['idle', 'Not requested yet'], ['runnable', 'Runnable']];

  function explorerShell() {
    const problems = data.problems.length;
    return `<div class="disc-tabs" role="group" aria-label="Browse">
        <button type="button" class="fchip" data-disc-tab="problems">Problems · ${problems}</button>
        <button type="button" class="fchip" data-disc-tab="solutions">Solutions · ${data.solutions.length}</button>
      </div>
      <div class="disc-tools"><input type="search" id="disc-search" placeholder="Search…" aria-label="Search" autocomplete="off" maxlength="80"><div id="disc-filters" class="disc-filters" role="group" aria-label="Filter"></div></div>
      <div id="disc-list" class="disc-list"></div>`;
  }

  function renderExplorer() {
    const problems = explorer.tab === 'problems';
    root.querySelectorAll('[data-disc-tab]').forEach(button => {
      const on = button.dataset.discTab === explorer.tab;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    const search = root.querySelector('#disc-search');
    search.placeholder = problems ? 'Search problems…' : 'Search solutions…';
    if (search.value !== explorer.query) search.value = explorer.query;
    root.querySelector('#disc-filters').innerHTML = (problems ? PROBLEM_FILTERS : SOLUTION_FILTERS)
      .map(([id, label]) => `<button type="button" class="fchip${id === explorer.filter ? ' on' : ''}" data-disc-filter="${id}" aria-pressed="${id === explorer.filter}">${esc(label)}</button>`).join('');

    const query = explorer.query.trim().toLowerCase();
    const matches = (...texts) => !query || texts.some(text => String(text || '').toLowerCase().includes(query));
    const list = root.querySelector('#disc-list');
    if (problems) {
      const inFilter = data.problems.filter(item => explorer.filter === 'all' || item.status === explorer.filter);
      const shown = inFilter.filter(item => !item.withheld && matches(item.title, item.topic, ...item.examples));
      const hidden = inFilter.filter(item => item.withheld);
      const max = Math.max(1, ...data.problems.map(item => item.count));
      const page = shown.slice(0, explorer.limit);
      const note = !query && hidden.length
        ? `<p class="disc-note-row">${plural(hidden.length, 'small topic')} (${plural(hidden.reduce((sum, item) => sum + item.count, 0), 'request')}) asked by fewer than three colleagues ${hidden.length === 1 ? 'is' : 'are'} not listed, to protect privacy. They are counted in the totals above.</p>` : '';
      list.innerHTML = `${page.map(item => problem(item, { max })).join('')}${more(shown.length, page.length)}${note}`
        || '<p class="disc-empty">Nothing matches. Try another word or filter.</p>';
    } else {
      const shown = data.solutions.filter(item => matches(item.title, item.summary, item.kind)
        && (explorer.filter === 'all' || (explorer.filter === 'requested' && item.requests) || (explorer.filter === 'idle' && !item.requests) || (explorer.filter === 'runnable' && item.runnable)));
      const max = Math.max(1, ...data.solutions.map(item => item.requests));
      const page = shown.slice(0, explorer.limit);
      list.innerHTML = `${page.map(item => solutionItem(item, max)).join('')}${more(shown.length, page.length)}`
        || '<p class="disc-empty">Nothing matches. Try another word or filter.</p>';
    }
  }

  const more = (total, shown) => (total > shown ? `<button type="button" class="btn disc-more" data-disc-more>Show more · ${total - shown} left</button>` : '');

  function render() {
    const max = Math.max(1, ...data.topRequests.map(cluster => cluster.count));
    root.innerHTML = `${periodBar()}${tiles(data)}${legend()}
      <h2 class="disc-heading"><span class="eyebrow">Most common requests</span></h2>
      ${data.topRequests.length ? `<div class="disc-list">${data.topRequests.map((cluster, index) => problem(cluster, { rank: index + 1, max })).join('')}</div>` : '<p class="disc-empty">No requests in this period yet. Ask the Oracle something and it will show up here.</p>'}
      <h2 class="disc-heading"><span class="eyebrow">Gaps · asked for, not yet solved</span></h2>
      <p class="disc-hint"><b>Worth building</b>: still unsolved and asked 3 or more times. <b>Watch</b>: fewer than 3 requests so far.</p>
      <div class="disc-list">${gaps(data.gaps)}</div>
      <h2 class="disc-heading"><span class="eyebrow">Browse every problem and solution</span></h2>
      <div class="disc-explorer">${explorerShell()}</div>`;
    renderExplorer();
  }

  async function load() {
    const mine = ++latest;
    root.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/api/discoveries?period=${encodeURIComponent(period)}`);
      if (!response.ok) throw new Error('Could not load Discoveries.');
      const payload = await response.json();
      if (mine === latest) {
        data = payload;
        explorer.limit = PAGE;
        render();
      }
    } catch (error) {
      if (mine === latest) root.innerHTML = `${periodBar()}<p class="disc-empty">${esc(error.message)}</p>`;
    } finally {
      if (mine === latest) root.removeAttribute('aria-busy');
    }
  }

  root.addEventListener('click', event => {
    const target = event.target.closest('[data-disc-period], [data-disc-tab], [data-disc-filter], [data-disc-more], [data-disc-action]');
    if (!target) return;
    if (target.dataset.discPeriod) {
      if (target.dataset.discPeriod === period) return;
      period = target.dataset.discPeriod;
      load();
    } else if (target.dataset.discTab) {
      if (target.dataset.discTab !== explorer.tab) explorer = { tab: target.dataset.discTab, query: explorer.query, filter: 'all', limit: PAGE };
      renderExplorer();
    } else if (target.dataset.discFilter) {
      explorer = { ...explorer, filter: target.dataset.discFilter, limit: PAGE };
      renderExplorer();
    } else if (target.hasAttribute('data-disc-more')) {
      explorer.limit += PAGE;
      renderExplorer();
    } else if (target.dataset.discAction) {
      const actions = window.pythiaActions;
      if (!actions) return;
      if (target.dataset.discAction === 'solution') actions.showSolution(Number(target.dataset.id));
      else if (target.dataset.discAction === 'share') actions.share(target.dataset.topic || '');
      else actions.ask(target.dataset.topic || '');
    }
  });
  root.addEventListener('input', event => {
    if (event.target.id !== 'disc-search') return;
    explorer = { ...explorer, query: event.target.value, limit: PAGE };
    renderExplorer();
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-view="discoveries"]')) load();
  });
})();
