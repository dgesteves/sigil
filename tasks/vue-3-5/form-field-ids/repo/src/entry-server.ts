import { renderToString } from 'vue/server-renderer'
import { createAccountApp, createSearchApp } from './apps.ts'

/** Renders the page body for one request. */
export async function renderPage(): Promise<string> {
  const search = await renderToString(createSearchApp())
  const account = await renderToString(createAccountApp())
  return `<header id="search">${search}</header><main id="account">${account}</main>`
}
