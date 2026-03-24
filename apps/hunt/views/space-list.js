// apps/hunt/views/space-list.js

export async function renderSpaceList(container, state, navigate) {
  const { store, service, registrySpaceId } = state

  container.innerHTML = `<div class="text-center py-8 text-gray-400">Loading…</div>`

  await store.setSpace(registrySpaceId)
  const registry = await store.read('_registry.json') ?? []

  function render(reg) {
    const listHtml = reg.length === 0
      ? `<p class="text-gray-400 text-sm text-center py-4">No hunts yet. Create your first one below.</p>`
      : reg.map(entry => `
          <div class="border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between bg-white">
            <button data-space-id="${entry.spaceId}" data-hunt-name="${entry.name}"
              class="open-hunt font-semibold text-sm text-violet-600 hover:text-violet-800 text-left">
              ${entry.name}
            </button>
            <button data-space-id="${entry.spaceId}" data-hunt-name="${entry.name}"
              class="delete-hunt text-xs text-red-500 hover:text-red-700 ml-4">delete</button>
          </div>`).join('')

    container.innerHTML = `
      <div class="flex items-center justify-between mb-6">
        <div class="text-sm text-gray-500">
          ${service.icon} Connected as <strong>${store.userId}</strong>
        </div>
        <button id="switch-service" class="text-sm text-violet-600 hover:underline">Switch service</button>
      </div>
      <h2 class="text-xl font-bold text-gray-900 mb-4">Your hunts</h2>
      <div class="flex flex-col gap-2 mb-4">${listHtml}</div>
      <div id="new-hunt-area">
        <button id="show-new-hunt"
          class="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400">
          + New hunt
        </button>
      </div>
      <div id="error-msg" class="mt-3 text-red-600 text-sm hidden"></div>`

    container.querySelector('#switch-service').addEventListener('click', () => {
      localStorage.removeItem('hunt:serviceId')
      navigate('service-select', { services: state.services ?? [] })
    })

    container.querySelectorAll('.open-hunt').forEach(btn => {
      btn.addEventListener('click', () => {
        store.setSpace(btn.dataset.spaceId)
        navigate('hunt-editor', { huntSpaceId: btn.dataset.spaceId, huntName: btn.dataset.huntName })
      })
    })

    container.querySelectorAll('.delete-hunt').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.spaceId, btn.dataset.huntName, reg))
    })

    container.querySelector('#show-new-hunt').addEventListener('click', showNewHuntInput)
  }

  function showNewHuntInput() {
    const area = container.querySelector('#new-hunt-area')
    area.innerHTML = `
      <div class="flex gap-2">
        <input id="new-hunt-name" type="text" placeholder="Hunt name"
          class="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-violet-500">
        <button id="create-hunt"
          class="px-4 py-2 bg-violet-600 text-white text-sm rounded hover:bg-violet-700">Create</button>
        <button id="cancel-new"
          class="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
      </div>`
    container.querySelector('#new-hunt-name').focus()
    container.querySelector('#create-hunt').addEventListener('click', () =>
      handleCreate(container.querySelector('#new-hunt-name').value.trim(), registry))
    container.querySelector('#cancel-new').addEventListener('click', () => render(registry))
  }

  async function handleCreate(displayName, reg) {
    if (!displayName) return
    const errEl = container.querySelector('#error-msg')
    errEl.classList.add('hidden')
    try {
      const inputName   = 'hunt-' + Date.now().toString(36)
      const huntSpaceId = await store.createSpace(inputName)
      await store.write('_hunt.json', { name: displayName })
      await store.setSpace(registrySpaceId)
      const updated = await store.read('_registry.json') ?? []
      updated.push({ spaceId: huntSpaceId, name: displayName, createdAt: new Date().toISOString() })
      await store.write('_registry.json', updated)
      await store.setSpace(huntSpaceId)
      navigate('hunt-editor', { huntSpaceId, huntName: displayName })
    } catch (e) {
      errEl.textContent = e.message
      errEl.classList.remove('hidden')
    }
  }

  async function handleDelete(spaceId, huntName, reg) {
    if (!confirm(`Delete "${huntName}"? This cannot be undone.`)) return
    const errEl = container.querySelector('#error-msg')
    errEl.classList.add('hidden')
    try {
      await store.setSpace(spaceId)
      await store.deleteSpace()
      // findOrCreateSpace calls setSpace internally — no separate setSpace call needed
      await store.findOrCreateSpace('anytrunk-hunt')
      const updated = (await store.read('_registry.json') ?? []).filter(e => e.spaceId !== spaceId)
      await store.write('_registry.json', updated)
      render(updated)
    } catch (e) {
      errEl.textContent = e.message
      errEl.classList.remove('hidden')
    }
  }

  render(registry)
}
