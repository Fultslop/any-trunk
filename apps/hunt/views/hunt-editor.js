// apps/hunt/views/hunt-editor.js
import { renderForm } from '../lib/forms.js'
import { createPoller } from '../lib/poller.js'
import { uniqueSlug } from '../lib/slug.js'

export async function renderHuntEditor(container, state, navigate) {
  const { store, schema, registrySpaceId, huntSpaceId, huntName } = state
  await store.setSpace(huntSpaceId)

  let huntData         = {}
  let locationSlugs    = []
  let locationDataMap  = {}
  let detailsExpanded  = false
  let detailsFormData  = {}
  let poller

  async function loadData() {
    huntData      = await store.read('_hunt.json') ?? {}
    locationSlugs = await store.read('_locations.json') ?? []
    const entries = await Promise.all(
      locationSlugs.map(async slug => [slug, await store.read(`locations/${slug}.json`) ?? {}])
    )
    locationDataMap = Object.fromEntries(entries)
  }

  async function refresh() {
    await store.setSpace(huntSpaceId)
    await loadData()
    renderLocations()
  }

  function renderLocations() {
    const list = container.querySelector('#locations-list')
    if (!list) return
    if (locationSlugs.length === 0) {
      list.innerHTML = `<p class="text-gray-400 text-sm text-center py-3">No locations yet.</p>`
    } else {
      list.innerHTML = locationSlugs.map((slug, i) => {
        const loc = locationDataMap[slug] ?? {}
        return `
          <div class="border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between bg-white">
            <div>
              <div class="font-medium text-sm">${i + 1} · ${loc.name ?? slug}</div>
              <div class="text-xs text-gray-400">${loc.points ?? 0} pts${loc.badge ? ' · ' + loc.badge : ''}</div>
            </div>
            <div class="flex gap-3 ml-4">
              <button data-slug="${slug}"
                class="edit-loc text-xs text-violet-600 hover:text-violet-800">edit</button>
              <button data-slug="${slug}"
                class="delete-loc text-xs text-red-500 hover:text-red-700">delete</button>
            </div>
          </div>`
      }).join('')
    }
    bindLocationButtons()
  }

  function bindLocationButtons() {
    container.querySelectorAll('.edit-loc').forEach(btn =>
      btn.addEventListener('click', () => {
        poller?.stop()
        navigate('location-form', {
          locationSlug: btn.dataset.slug,
          locationData: locationDataMap[btn.dataset.slug] ?? {},
          locationSlugs,
          huntSpaceId,
          huntName,
        })
      })
    )
    container.querySelectorAll('.delete-loc').forEach(btn =>
      btn.addEventListener('click', () => handleDeleteLocation(btn.dataset.slug))
    )
  }

  async function handleDeleteLocation(slug) {
    if (!confirm(`Delete this location?`)) return
    await store.setSpace(huntSpaceId)
    await store.delete(`locations/${slug}.json`)
    const updated = (await store.read('_locations.json') ?? []).filter(s => s !== slug)
    await store.write('_locations.json', updated)
    locationSlugs   = updated
    delete locationDataMap[slug]
    renderLocations()
  }

  async function handleSaveDetails() {
    await store.setSpace(huntSpaceId)
    await store.write('_hunt.json', detailsFormData)
    huntData = { ...detailsFormData }
    detailsExpanded = false
    renderDetails()
  }

  function renderDetails() {
    const section = container.querySelector('#hunt-details-section')
    if (!section) return
    const summary = [huntData.name, huntData.country, huntData.flag].filter(Boolean).join(' · ')
    section.innerHTML = `
      <div class="border border-gray-200 rounded-lg overflow-hidden mb-6">
        <button id="toggle-details"
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm hover:bg-gray-100">
          <div>
            <span class="font-semibold">Hunt details</span>
            <span class="text-gray-500 ml-2">${summary || huntName}</span>
          </div>
          <span class="text-violet-600 text-xs">${detailsExpanded ? 'Close ▲' : 'Edit ▾'}</span>
        </button>
        ${detailsExpanded ? `
          <div class="border-t border-gray-200 p-4">
            <div id="details-form"></div>
            <div class="flex gap-2 mt-3">
              <button id="save-details"
                class="px-4 py-2 bg-violet-600 text-white text-sm rounded hover:bg-violet-700">Save details</button>
              <button id="cancel-details"
                class="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          </div>` : ''}
      </div>`

    section.querySelector('#toggle-details').addEventListener('click', () => {
      detailsExpanded = !detailsExpanded
      if (detailsExpanded) detailsFormData = { ...huntData }
      renderDetails()
      if (detailsExpanded) {
        renderForm(
          section.querySelector('#details-form'),
          schema.hunt,
          detailsFormData,
          data => { detailsFormData = data }
        )
      }
    })

    if (detailsExpanded) {
      section.querySelector('#save-details').addEventListener('click', handleSaveDetails)
      section.querySelector('#cancel-details').addEventListener('click', () => {
        detailsExpanded = false
        renderDetails()
      })
    }
  }

  await loadData()
  detailsFormData = { ...huntData }

  container.innerHTML = `
    <div class="mb-6">
      <button id="back-btn" class="text-sm text-gray-500 hover:text-gray-700">← Your hunts</button>
      <span class="text-sm text-gray-400 mx-1">·</span>
      <span class="text-sm font-semibold text-gray-700">${huntName}</span>
    </div>
    <div id="hunt-details-section"></div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-bold text-gray-900">Locations</h2>
      <button id="refresh-btn" class="text-xs text-gray-400 hover:text-gray-600">Refresh</button>
    </div>
    <div id="locations-list"></div>
    <button id="add-location"
      class="mt-3 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400">
      + Add location
    </button>
    <div id="error-msg" class="mt-3 text-red-600 text-sm hidden"></div>`

  renderDetails()
  renderLocations()

  container.querySelector('#back-btn').addEventListener('click', () => {
    poller?.stop()
    navigate('space-list', { huntSpaceId: undefined, huntName: undefined })
  })

  container.querySelector('#refresh-btn').addEventListener('click', refresh)

  container.querySelector('#add-location').addEventListener('click', () => {
    poller?.stop()
    navigate('location-form', {
      locationSlug: undefined,
      locationData: {},
      locationSlugs,
      huntSpaceId,
      huntName,
    })
  })

  poller = createPoller(refresh, 20_000)
  poller.start()
}
