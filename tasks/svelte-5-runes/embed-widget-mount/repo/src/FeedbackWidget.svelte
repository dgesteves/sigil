<script lang="ts">
  import { onMount } from 'svelte'
  import type { Feedback } from './types.ts'

  interface Props {
    title?: string
    placeholder?: string
    autofocus?: boolean
    onsubmit?: (feedback: Feedback) => void
    onclose?: () => void
    onready?: () => void
  }

  let {
    title = 'How are we doing?',
    placeholder = 'Tell us more (optional)',
    autofocus = false,
    onsubmit,
    onclose,
    onready,
  }: Props = $props()

  const uid = $props.id()
  let rating = $state(0)
  let comment = $state('')
  let textarea: HTMLTextAreaElement

  export function reset() {
    rating = 0
    comment = ''
  }

  export function focus() {
    textarea.focus()
  }

  onMount(() => {
    if (autofocus) textarea.focus()
    onready?.()
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (rating === 0) return
    onsubmit?.({ rating, comment: comment.trim() })
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') onclose?.()
  }}
/>

<form class="acme-feedback" aria-labelledby="{uid}-title" onsubmit={submit}>
  <h2 id="{uid}-title">{title}</h2>
  <div role="radiogroup" aria-label="Rating">
    {#each [1, 2, 3, 4, 5] as n (n)}
      <button
        type="button"
        role="radio"
        aria-checked={rating === n}
        aria-label="{n} out of 5"
        onclick={() => (rating = n)}>{n}</button
      >
    {/each}
  </div>
  <textarea bind:this={textarea} bind:value={comment} {placeholder} aria-label="Comment"></textarea>
  <button type="submit" disabled={rating === 0}>Send</button>
  <button type="button" class="close" aria-label="Close" onclick={() => onclose?.()}>×</button>
</form>
