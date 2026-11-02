import { createSSRApp } from 'vue'
import AccountSettings from './AccountSettings.vue'
import SearchBar from './SearchBar.vue'

// useId() is unique per app, so two apps on one page need different prefixes. The prefix is set in
// the factories so the server render and the browser hydration always agree.

/** The account settings form. One instance per request on the server, one in the browser. */
export function createAccountApp() {
  const app = createSSRApp(AccountSettings)
  app.config.idPrefix = 'account'
  return app
}

/** The header search bar, a separate app mounted next to the account app. */
export function createSearchApp() {
  const app = createSSRApp(SearchBar)
  app.config.idPrefix = 'search'
  return app
}
