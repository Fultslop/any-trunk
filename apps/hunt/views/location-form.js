// apps/hunt/views/location-form.js
import { renderForm } from '../lib/forms.js';
import { uniqueSlug } from '../lib/slug.js';

export async function renderLocationForm(container, state, navigate) {
  const {
    store, schema, huntSpaceId, huntName, locationSlugs = [], locationSlug, locationData = {},
  } = state;
  const isNew = !locationSlug;
  let formData = { ...locationData };

  await store.setSpace(huntSpaceId);

  // eslint-disable-next-line no-param-reassign
  container.innerHTML = `
    <div class="mb-6">
      <button id="back-btn" class="text-sm text-gray-500 hover:text-gray-700">← ${huntName}</button>
      <span class="text-sm text-gray-400 mx-1">·</span>
      <span class="text-sm font-semibold text-gray-700">
        ${isNew ? 'New location' : `Edit: ${locationData.name ?? locationSlug}`}
      </span>
    </div>
    <div id="form-root"></div>
    <div class="flex gap-2 mt-4">
      <button id="save-btn"
        class="px-4 py-2 bg-violet-600 text-white text-sm rounded hover:bg-violet-700">
        ${isNew ? 'Create location' : 'Save location'}
      </button>
      <button id="cancel-btn"
        class="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
    </div>
    <div id="error-msg" class="mt-3 text-red-600 text-sm hidden"></div>`;

  renderForm(
    container.querySelector('#form-root'),
    schema.location,
    formData,
    (data) => { formData = data; },
  );

  container.querySelector('#back-btn').addEventListener('click', () => navigate('hunt-editor', { huntSpaceId, huntName }));

  container.querySelector('#cancel-btn').addEventListener('click', () => navigate('hunt-editor', { huntSpaceId, huntName }));

  container.querySelector('#save-btn').addEventListener('click', async () => {
    const button = container.querySelector('#save-btn');
    const errorElement = container.querySelector('#error-msg');
    button.disabled = true;
    errorElement.classList.add('hidden');

    try {
      await store.setSpace(huntSpaceId);

      if (isNew) {
        // Derive unique slug from name
        const slug = uniqueSlug(formData.name ?? 'location', locationSlugs);
        await store.write(`locations/${slug}.json`, formData);
        // Append slug to index (fresh read to minimise concurrent-write conflicts)
        const current = await store.read('_locations.json') ?? [];
        current.push(slug);
        await store.write('_locations.json', current);
      } else {
        // Use original slug — renaming does not rename the file
        await store.write(`locations/${locationSlug}.json`, formData);
        // _locations.json index is unchanged
      }

      navigate('hunt-editor', { huntSpaceId, huntName });
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.classList.remove('hidden');
      button.disabled = false;
    }
  });
}
