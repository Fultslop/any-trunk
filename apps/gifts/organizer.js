import { WorkerGitHubStore } from '../../lib/github-store-worker.js';

function esc(string_) {
  return String(string_)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

export async function renderOrganizer(store, repoParameter) {
  const app = document.querySelector('#app');

  // Resume from URL param or localStorage
  const recentRepos = store.getRecentSpaces();
  let activeRepo = repoParameter ?? null;

  if (!activeRepo && recentRepos.length > 0) {
    [activeRepo] = recentRepos;
    store.setSpace(activeRepo);
  }

  async function renderDashboard(wishlistOverride = null) {
    const wishlist = wishlistOverride ?? (activeRepo ? await store.read('_wishlist.json') : null);
    const participants = activeRepo ? await store.readAll() : [];

    // Build claims map: item → [usernames]
    const claims = {};
    for (const { username, latest } of participants) {
      if (latest?.item) {
        if (!claims[latest.item]) claims[latest.item] = [];
        claims[latest.item].push(username);
      }
    }

    const items = wishlist?.items ?? [];
    const inviteCode = activeRepo ? WorkerGitHubStore.getInviteCode(activeRepo) : null;
    const joinUrl = inviteCode
      ? `${location.origin}${location.pathname}?mode=participant&repo=${activeRepo}&invite=${inviteCode}`
      : null;

    app.innerHTML = `
      <h1>Gift Registry — Organizer</h1>
      <p>Signed in as: <strong>${esc(store.userId)}</strong></p>

      ${activeRepo ? '' : `
        <section>
          <h2>Create new registry</h2>
          <input id="eventName" placeholder="birthday-2026-04-01" />
          <button id="createBtn">Create</button>
        </section>
      `}

      ${recentRepos.length > 0 && !activeRepo ? `
        <section>
          <h2>Resume</h2>
          ${recentRepos.map((r) => `<button class="resume-btn" data-repo="${esc(r)}">${esc(r)}</button>`).join('')}
        </section>
      ` : ''}

      ${activeRepo ? `
        <section>
          <h2>Active registry</h2>
          <p>Repo: <strong>${esc(activeRepo)}</strong></p>
          ${joinUrl
    ? '<button id="copyJoinLink">Copy join link</button>'
    : '<button id="registerBtn">Generate join link</button>'}
        </section>

        <section>
          <h2>Wishlist</h2>
          <div>
            <input id="newItem" placeholder="Add item..." />
            <button id="addItemBtn">Add</button>
          </div>
          <ul id="wishlistItems">
            ${items.map((item) => {
    const claimants = claims[item] ?? [];
    const display = claimants.length === 0
      ? '<span class="unclaimed">unclaimed</span>'
      : (claimants.length > 1
        ? `<span class="conflict">⚠ claimed by ${esc(claimants.join(', '))}</span>`
        : `<span class="claimed">→ claimed by ${esc(claimants[0])}</span>`);
    return `<li>${esc(item)} ${display}</li>`;
  }).join('')}
          </ul>
        </section>
      ` : ''}
    `;

    // Wire up buttons
    document.querySelector('#createBtn')?.addEventListener('click', async () => {
      const name = document.querySelector('#eventName').value.trim();
      if (!name) return;
      try {
        const repo = await store.createSpace(name);
        activeRepo = repo;
        store.setSpace(repo);
        await store.write('_wishlist.json', { items: [] });
        await store.register();
        await renderDashboard();
      } catch (error) {
        app.querySelector('.err')?.remove();
        app.insertAdjacentHTML('beforeend', `<p class="err">${esc(error.message)}</p>`);
      }
    });

    document.querySelector('#registerBtn')?.addEventListener('click', async () => {
      await store.register();
      await renderDashboard();
    });

    document.querySelector('#copyJoinLink')?.addEventListener('click', () => {
      navigator.clipboard.writeText(joinUrl)
        .then(() => alert('Join link copied!'))
        .catch(() => prompt('Copy this link:', joinUrl));
    });

    document.querySelector('#addItemBtn')?.addEventListener('click', async () => {
      const item = document.querySelector('#newItem').value.trim();
      if (!item) return;
      const current = await store.read('_wishlist.json');
      const updated = { items: [...(current?.items ?? []), item] };
      await store.write('_wishlist.json', updated);
      await renderDashboard(updated);
    });

    async function handleResumeClick(button) {
      activeRepo = button.dataset.repo;
      store.setSpace(activeRepo);
      await renderDashboard();
    }
    for (const button of document.querySelectorAll('.resume-btn')) {
      button.addEventListener('click', () => handleResumeClick(button));
    }

    // Poll for claim updates every 30s
    if (activeRepo) {
      clearTimeout(renderDashboard.pollTimer);
      renderDashboard.pollTimer = setTimeout(renderDashboard, 30_000);
    }
  }

  await renderDashboard();
}
