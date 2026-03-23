import { WorkerGitHubStore } from '../../lib/github-store-worker.js'

export function renderOnboardingGate(repoParam, { clientId, workerUrl }) {
  const app = document.getElementById('app')
  app.innerHTML = `
    <h1>Gift Registry</h1>
    <p>You've been invited to a gift registry. Do you have a GitHub account?</p>
    <button id="hasAccount">Yes, sign in with GitHub</button>
    <button id="noAccount">No, create a free account</button>
    <p id="hint" style="display:none">${WorkerGitHubStore.onboardingHint()}
      <a href="${WorkerGitHubStore.onboardingUrl()}" target="_blank">Create account →</a>
    </p>
  `
  document.getElementById('hasAccount').addEventListener('click', () => {
    WorkerGitHubStore.beginAuth(clientId, workerUrl)
  })
  document.getElementById('noAccount').addEventListener('click', () => {
    document.getElementById('hint').style.display = ''
  })
}

export async function renderParticipant(store, repoParam, inviteCode) {
  const app = document.getElementById('app')
  app.innerHTML = `<p>Joining registry...</p>`

  try {
    await store.join(repoParam, inviteCode)
  } catch (e) {
    app.innerHTML = `<p class="err">Failed to join: ${e.message}</p>`
    return
  }

  async function renderWishlist() {
    const wishlist = await store.read('_wishlist.json')
    const participants = await store.readAll()

    // Build claims map: item → first claimant (lexicographically earliest timestamp)
    // readAll returns entries sorted by path, so entries[0] is earliest
    const firstClaims = {}
    const allClaims = {}
    for (const { username, entries } of participants) {
      for (const { data } of entries) {
        if (data?.item) {
          if (!allClaims[data.item]) allClaims[data.item] = []
          allClaims[data.item].push(username)
          // Track first claim by insertion order (entries already sorted by timestamp)
          if (!firstClaims[data.item]) firstClaims[data.item] = username
        }
      }
    }

    const items = wishlist?.items ?? []

    app.innerHTML = `
      <h1>Gift Registry</h1>
      <p>Signed in as: <strong>${store.username}</strong></p>
      <p>Status: <strong class="badge">joined ✓</strong></p>

      <section>
        <h2>Wishlist</h2>
        <ul id="wishlistItems">
          ${items.map(item => {
            const claimants = allClaims[item] ?? []
            const myClaim = claimants.includes(store.username)

            let display
            if (claimants.length === 0) {
              display = `<button class="claim-btn" data-item="${item}">Claim</button>`
            } else if (claimants.length > 1) {
              display = `<span class="conflict">⚠ claimed by ${claimants.join(', ')}</span>`
            } else if (myClaim) {
              display = `<span class="yours">You ✓</span>`
            } else {
              display = `<span class="claimed">claimed by ${claimants[0]}</span>`
            }

            return `<li>${item} ${display}</li>`
          }).join('')}
        </ul>
      </section>
    `

    document.querySelectorAll('.claim-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true
        try {
          await store.append({ item: btn.dataset.item }, { prefix: store.username })
          await renderWishlist()
        } catch (e) {
          app.insertAdjacentHTML('beforeend', `<p class="err">${e.message}</p>`)
          btn.disabled = false
        }
      })
    })

    // Poll every 30s
    clearTimeout(renderWishlist._pollTimer)
    renderWishlist._pollTimer = setTimeout(renderWishlist, 30_000)
  }

  await renderWishlist()
}
