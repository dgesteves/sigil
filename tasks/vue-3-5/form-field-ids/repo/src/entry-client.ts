import type { App } from 'vue'
import { createAccountApp, createSearchApp } from './apps.ts'

/** Hydrates the server-rendered page. Returns the apps so callers can unmount them. */
export function hydratePage(root: ParentNode = document): App[] {
  const search = createSearchApp()
  search.mount(root.querySelector('#search')!)
  const account = createAccountApp()
  account.mount(root.querySelector('#account')!)
  return [search, account]
}
