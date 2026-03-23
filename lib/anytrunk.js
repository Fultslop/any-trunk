// lib/anytrunk.js
import { GitHubStore }      from './github-store.js'
import { GoogleDriveStore } from './google-drive-store.js'
import { assertCapabilities } from './capabilities.js'

export { assertCapabilities }

export const AnyTrunk = {
  async init(config) {
    switch (config.provider) {
      case 'github':       return GitHubStore.init(config)
      case 'google-drive': return GoogleDriveStore.init(config)
      default: throw new Error(`Unknown provider: "${config.provider}"`)
    }
  }
}
