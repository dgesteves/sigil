declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
  }
}

export function track(event: string, data: Record<string, unknown> = {}) {
  window.dataLayer ??= []
  window.dataLayer.push({ event, ...data })
}
