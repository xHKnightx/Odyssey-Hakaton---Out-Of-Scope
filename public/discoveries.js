(() => {
  const root = document.getElementById('discoveries-root');
  if (!root) return;

  const PERIODS = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time']];
  const STATUS = {
    solution: ['Solution available', 'ok'],
    person: ['Colleagues can help', 'gold'],
    gap: ['No solution yet', 'terra']
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

  let period = '30d';
  let latest = 0;

  const tile = (label, value, note, tone = '') => `<div class="disc-tile ${tone}"><span class="disc-label">${esc(label)}</span><strong>${esc(value)}</strong><span class="disc-note">${esc(note)}</span></div>`;

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

  function row(cluster, index, max) {
    const [statusLabel, tone] = STATUS[cluster.status] || STATUS.gap;
    const stage = cluster.stage === 'opportunity' ? 'Opportunity' : 'Emerging';
    const examples = cluster.examples.length ? `<p class="disc-examples">${cluster.examples.map(text => `<q>${esc(text)}</q>`).join(' ')}</p>` : '';
    return `<article class="disc-row">
      <span class="disc-rank">${index + 1}</span>
      <div class="disc-body">
        <h3>${esc(cluster.title)}</h3>
        <div class="disc-meta"><span class="disc-chip ${tone}">${esc(statusLabel)}</span><span class="disc-chip">${stage}</span><span class="disc-count">${plural(cluster.count, 'request')} · ${plural(cluster.askers, 'colleague')} · ${cluster.share}%</span></div>
        <div class="disc-bar" aria-hidden="true"><span class="${tone}" style="width:${Math.max(4, Math.round((cluster.count / max) * 100))}%"></span></div>
        ${examples}
      </div>
    </article>`;
  }

  function gaps(list) {
    if (!list.length) return '<p class="disc-empty">Every request in this period found an answer. Nothing to build right now.</p>';
    return list.map(gap => `<article class="disc-gap"><div><h3>${esc(gap.title)}</h3><span class="disc-count">${plural(gap.count, 'request')} · ${plural(gap.askers, 'colleague')}</span></div><span class="disc-chip terra">${gap.stage === 'opportunity' ? 'Worth building' : 'Watch'}</span></article>`).join('');
  }

  function render(data) {
    const max = Math.max(1, ...data.topRequests.map(cluster => cluster.count));
    root.innerHTML = `${periodBar()}${tiles(data)}
      <h2 class="disc-heading"><span class="eyebrow">Most common requests</span></h2>
      ${data.topRequests.length ? `<div class="disc-list">${data.topRequests.map((cluster, index) => row(cluster, index, max)).join('')}</div>` : '<p class="disc-empty">No requests in this period yet. Ask the Oracle something and it will show up here.</p>'}
      <h2 class="disc-heading"><span class="eyebrow">Gaps · asked for, not yet solved</span></h2>
      <div class="disc-list">${gaps(data.gaps)}</div>`;
  }

  async function load() {
    const mine = ++latest;
    root.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/api/discoveries?period=${encodeURIComponent(period)}`);
      if (!response.ok) throw new Error('Could not load Discoveries.');
      const data = await response.json();
      if (mine === latest) render(data);
    } catch (error) {
      if (mine === latest) root.innerHTML = `${periodBar()}<p class="disc-empty">${esc(error.message)}</p>`;
    } finally {
      if (mine === latest) root.removeAttribute('aria-busy');
    }
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-disc-period]');
    if (!button || button.dataset.discPeriod === period) return;
    period = button.dataset.discPeriod;
    load();
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-view="discoveries"]')) load();
  });
})();
