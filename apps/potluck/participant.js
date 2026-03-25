import { esc, setStatus } from './helpers.js';

export async function renderHistory(store) {
  const element = document.querySelector('#history');
  if (!element) return;
  try {
    const files = await store.list(store.userId);
    if (files.length === 0) {
      element.innerHTML = '<p style="color:#888">No submissions yet.</p>';
      return;
    }
    const entries = await Promise.all(
      files.map(async (f) => ({ path: f.path, data: await store.read(f.path) })),
    );
    const latestPath = entries.at(-1).path;
    element.innerHTML = `<table>
      <thead><tr><th>Time</th><th>Dish</th><th>Note</th><th></th></tr></thead>
      <tbody>
        ${entries.map((entry) => {
    const time = new Date((entry.path.split('/').pop() ?? '').replace('.json', '')
      .replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'))
      .toLocaleTimeString();
    const isCurrent = entry.path === latestPath;
    return `<tr${isCurrent ? ' style="font-weight:bold"' : ''}>
            <td>${time}</td>
            <td>${esc(entry.data?.dish ?? '—')}</td>
            <td>${esc(entry.data?.note ?? '')}</td>
            <td>${isCurrent ? '← current' : ''}</td>
          </tr>`;
  }).join('')}
      </tbody>
    </table>`;
  } catch (error) {
    element.innerHTML = `<p class="err">Could not load history: ${error.message}</p>`;
  }
}

export async function renderParticipant(store, repoParameter, inviteParameter) {
  const app = document.querySelector('#app');

  if (!repoParameter) {
    app.innerHTML = '<p>Invalid join link — missing <code>repo</code> parameter.</p>';
    return;
  }

  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub">
      <strong>${esc(repoParameter)}</strong><br>
      Signed in as <strong>${esc(store.userId)}</strong>
      &nbsp;·&nbsp; <span id="join-status">Joining...</span>
    </p>
    <div id="status"></div>
  `;

  try {
    if (inviteParameter) {
      await store.join(repoParameter, inviteParameter);
    } else {
      store.setSpace(repoParameter);
    }
    document.querySelector('#join-status').innerHTML = '<span class="badge">joined ✓</span>';
  } catch (error) {
    setStatus(`Join failed: ${error.message}`);
    return;
  }

  app.insertAdjacentHTML('beforeend', `
    <hr>
    <div class="section">
      <strong>What are you bringing?</strong>
      <label>Dish
        <input id="dish-input" type="text" placeholder="e.g. tiramisu" />
      </label>
      <label>Note <span style="color:#999;font-size:0.8rem">(optional)</span>
        <input id="note-input" type="text" placeholder="e.g. contains nuts" />
      </label>
      <button id="submit-btn">Submit</button>
    </div>
    <hr>
    <div class="section">
      <strong>Your submissions</strong>
      <div id="history">Loading...</div>
    </div>
  `);

  document.querySelector('#submit-btn').addEventListener('click', async () => {
    const button = document.querySelector('#submit-btn');
    const dish = document.querySelector('#dish-input').value.trim();
    if (!dish) { setStatus('Dish name required'); return; }
    const note = document.querySelector('#note-input').value.trim();
    button.disabled = true;
    setStatus('Submitting...', false);
    try {
      await store.append({ dish, note: note || undefined }, { prefix: store.userId });
      document.querySelector('#dish-input').value = '';
      document.querySelector('#note-input').value = '';
      setStatus('Submitted!', false);
      await renderHistory(store);
    } catch (error) {
      setStatus(error.message);
    } finally {
      button.disabled = false;
    }
  });

  await renderHistory(store);
}

export function renderOnboardingGate(_repoParameter, { url, hint: hintText, signIn }) {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub">You've been invited to a Potluck event.</p>
    <div class="section">
      <strong>Do you have a GitHub account?</strong>
      <p style="font-size:0.9rem;color:#555;margin-top:0.5rem">
        This app uses GitHub to store event data. You'll need an account to participate.
      </p>
      <button id="yes-btn" style="margin-right:0.5rem">Yes, sign in with GitHub</button>
      <button id="no-btn">No, create a free account</button>
    </div>
    <div id="onboarding-hint" style="display:none;margin-top:1rem"></div>
  `;

  document.querySelector('#yes-btn').addEventListener('click', () => signIn());

  document.querySelector('#no-btn').addEventListener('click', () => {
    const hint = document.querySelector('#onboarding-hint');
    hint.style.display = 'block';
    hint.innerHTML = `
      <p>${esc(hintText)}</p>
      <a href="${esc(url)}" target="_blank">
        Create a free GitHub account →
      </a>
      <p style="font-size:0.85rem;color:#555;margin-top:0.75rem">
        Once you have an account, return to this page and click "Yes, sign in with GitHub".
      </p>
    `;
  });
}
