import { WorkerGitHubStore } from '../../lib/github-store-worker.js';
import { renderOrganizer } from './organizer.js';
import { renderParticipant, renderOnboardingGate } from './participant.js';

function esc(string_) {
  return String(string_)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

// ── CONFIG ────────────────────────────────────────────────────────────────
// Deploy workers/anytrunk-worker/ to Cloudflare and paste the worker URL here.
// Register a GitHub OAuth App — put clientSecret in the Worker, not here.
const CLIENT_ID = '<CLIENT_ID>';
const WORKER_URL = '<WORKER_URL>';
// ─────────────────────────────────────────────────────────────────────────

const parameters = new URLSearchParams(location.search);
const mode = parameters.get('mode'); // 'organizer' | 'participant'
const repoParameter = parameters.get('repo');
const inviteParameter = parameters.get('invite'); // opaque invite code (not a PAT)

async function main() {
  const result = await WorkerGitHubStore.init({
    clientId: CLIENT_ID,
    workerUrl: WORKER_URL,
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
  document.querySelector('#app').innerHTML = `<p class="err">Startup error: ${esc(error.message)}</p>`;
  // eslint-disable-next-line no-console
  console.error(error);
}
