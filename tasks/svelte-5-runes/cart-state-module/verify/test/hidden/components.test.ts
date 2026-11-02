import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import CartBadge from '../../src/lib/CartBadge.svelte'
import CartDrawer from '../../src/lib/CartDrawer.svelte'
import ProductCard from '../../src/lib/ProductCard.svelte'
import { cart } from '../../src/lib/cart.svelte.ts'

const mug = { sku: 'MUG-01', name: 'Mug', unitPriceCents: 1250 }
const tee = { sku: 'TEE-02', name: 'T-shirt', unitPriceCents: 2000 }

let apps: Record<string, unknown>[] = []
let root: HTMLElement

function render(component: any, props: Record<string, unknown> = {}) {
  const target = root.appendChild(document.createElement('div'))
  apps.push(mount(component, { target, props }))
  flushSync()
  return target
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  cart.clear()
  window.dataLayer = []
  root = document.body.appendChild(document.createElement('main'))
})

afterEach(() => {
  for (const app of apps.splice(0)) unmount(app)
  document.body.innerHTML = ''
})

describe('components follow the shared cart', () => {
  test('adding from a product card updates the badge, the card and the analytics event', () => {
    const card = render(ProductCard, { product: mug })
    const badge = render(CartBadge)
    expect(text(badge.querySelector('.count'))).toBe('0')

    card.querySelector('button')!.click()
    flushSync()
    expect(text(badge.querySelector('.count'))).toBe('1')
    expect(badge.querySelector('button')!.getAttribute('aria-label')).toBe('Cart, 1 items')
    expect(text(card.querySelector('button'))).toBe('Add another (1 in cart)')

    card.querySelector('button')!.click()
    flushSync()
    expect(text(badge.querySelector('.count'))).toBe('2')
    expect(window.dataLayer).toEqual([
      { event: 'add_to_cart', sku: 'MUG-01', cartCount: 1 },
      { event: 'add_to_cart', sku: 'MUG-01', cartCount: 2 },
    ])
  })

  test('changes made from plain code reach mounted components', () => {
    const drawer = render(CartDrawer)
    const badge = render(CartBadge)
    expect(text(drawer.querySelector('.empty'))).toBe('Your cart is empty.')

    cart.add(mug, 2)
    cart.add(tee)
    flushSync()
    expect([...drawer.querySelectorAll('li')].map((li) => li.dataset.sku)).toEqual(['MUG-01', 'TEE-02'])
    expect(text(drawer.querySelector('.subtotal strong'))).toBe('€45.00')
    expect(text(badge.querySelector('.count'))).toBe('3')

    cart.setQty('TEE-02', 3)
    flushSync()
    expect(text(drawer.querySelector('li[data-sku="TEE-02"] .line-total'))).toBe('€60.00')
    expect(text(drawer.querySelector('.subtotal strong'))).toBe('€85.00')
  })

  test('the drawer edits quantities, removes lines and empties the cart', () => {
    cart.add(mug)
    cart.add(tee)
    const drawer = render(CartDrawer)
    const badge = render(CartBadge)

    const qty = drawer.querySelector<HTMLInputElement>('input[aria-label="Quantity of Mug"]')!
    qty.value = '4'
    qty.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(cart.count).toBe(5)
    expect(text(drawer.querySelector('li[data-sku="MUG-01"] .line-total'))).toBe('€50.00')
    expect(text(badge.querySelector('.count'))).toBe('5')

    qty.value = '0'
    qty.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect([...drawer.querySelectorAll('li')].map((li) => li.dataset.sku)).toEqual(['TEE-02'])

    drawer.querySelector<HTMLButtonElement>('button[aria-label="Remove T-shirt"]')!.click()
    flushSync()
    expect(text(drawer.querySelector('.empty'))).toBe('Your cart is empty.')
    expect(text(badge.querySelector('.count'))).toBe('0')

    cart.add(tee, 2)
    flushSync()
    drawer.querySelector<HTMLButtonElement>('button.clear')!.click()
    flushSync()
    expect(cart.count).toBe(0)
    expect(window.dataLayer).toContainEqual({ event: 'clear_cart', lines: 1 })
    expect(text(drawer.querySelector('.empty'))).toBe('Your cart is empty.')
  })

  test('the shared cart persists to localStorage', () => {
    cart.add(tee)
    flushSync()
    expect(JSON.parse(localStorage.getItem('cart:v1')!)).toEqual([{ ...tee, qty: 1 }])
  })
})
