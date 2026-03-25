import { GitHubStore } from '../../lib/github-store.js';
import { renderOrganizer } from './organizer.js';
import { renderParticipant, renderOnboardingGate } from './participant.js';
import { renderObserver } from './observer.js';

// ── CONFIG ────────────────────────────────────────────────────────────────
// Register a GitHub OAuth App at github.com/settings/developers
// Callback URL must match the URL where this file is served.
// Note these are just placeholders, this client does not exist
const CLIENT_ID = '<CLIENT_ID>';
// ⚠ exposed in client — see D1 in design spec
const CLIENT_SECRET = '<CLIENT_SECRET>';
// Local dev: run `npm run proxy` then set to 'http://localhost:8080'
// Production: deploy a Cloudflare Worker (see D2 in design spec)
const CORS_PROXY = 'http://localhost:8080';
// ─────────────────────────────────────────────────────────────────────────

const parameters = new URLSearchParams(location.search);
const mode = parameters.get('mode'); // 'organizer' | 'participant' | 'observer'
const repoParameter = parameters.get('repo');
const inviteParameter = parameters.get('invite');

async function main() {
  if (mode === 'observer') {
    await renderObserver(repoParameter);
    return;
  }

  const result = await GitHubStore.init({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    corsProxy: CORS_PROXY,
    repoFullName: repoParameter,
    mode,
  });
  if (!result) return;
  if (result.status === 'onboarding') {
    renderOnboardingGate(repoParameter, result);
    return;
  }
  const store = result;

  await (mode === 'participant' ? renderParticipant(store, repoParameter, inviteParameter) : renderOrganizer(store, repoParameter));
}

try {
  await main();
} catch (error) {
  document.querySelector('#app').innerHTML = `<p class="err">Startup error: ${error.message}</p>`;
  // eslint-disable-next-line no-console
  console.error(error);
}
