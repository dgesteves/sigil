import { createSSRApp } from 'vue'
import AccountSettings from './AccountSettings.vue'
import SearchBar from './SearchBar.vue'

/** The account settings form. One instance per request on the server, one in the browser. */
export function createAccountApp() {
  return createSSRApp(AccountSettings)
}

/** The header search bar, a separate app mounted next to the account app. */
export function createSearchApp() {
  return createSSRApp(SearchBar)
}
