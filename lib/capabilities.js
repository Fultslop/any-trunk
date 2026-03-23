// lib/capabilities.js

export const CAPS = {
  createSpace:      'Create a new shared space',
  join:             'Participant joins a space',
  append:           'Write a new timestamped entry',
  read:             'Read a single file',
  readAll:          'Read all participant submissions',
  write:            'Overwrite a specific file',
  addCollaborator:  'Add a participant by identity',
  closeSubmissions: 'Mark event as closed',
  archiveSpace:     'Make space read-only',
  deleteSpace:      'Permanently remove the space',
  binaryData:       'Backend can store binary data in entries (method surface defined in Spec 2)',
}

export function assertCapabilities(store, required) {
  const caps = store.capabilities()
  const missing = required.filter(cap => !caps[cap])
  if (missing.length > 0) {
    throw new Error(
      `${store.constructor.name} is missing required capabilities: ${missing.join(', ')}`
    )
  }
}
