<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'

  type Reason = 'empty' | 'duplicate' | 'full'

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'onchange'> {
    /** Current labels. Parents usually bind to it: <TagInput bind:tags={labels} />. */
    tags?: string[]
    /** Maximum number of labels. */
    max?: number
    placeholder?: string
    onchange?: (tags: string[]) => void
    onreject?: (detail: { value: string; reason: Reason }) => void
    /** Custom chip markup; receives the label and a function that removes it. */
    chip?: Snippet<[string, () => void]>
  }

  let {
    tags = $bindable([]),
    max = 10,
    placeholder = 'Add a label',
    onchange,
    onreject,
    chip,
    ...rest
  }: Props = $props()

  let draft = $state('')

  const remaining = $derived(Math.max(0, max - tags.length))
  const full = $derived(remaining === 0)

  function normalise(value: string) {
    return value.trim().replace(/\s+/g, '-').toLowerCase()
  }

  function add() {
    const value = normalise(draft)
    if (!value) return onreject?.({ value, reason: 'empty' })
    if (tags.includes(value)) return onreject?.({ value, reason: 'duplicate' })
    if (full) return onreject?.({ value, reason: 'full' })
    tags = [...tags, value]
    draft = ''
    onchange?.(tags)
  }

  function remove(tag: string) {
    tags = tags.filter((t) => t !== tag)
    onchange?.(tags)
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add()
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      remove(tags[tags.length - 1]!)
    }
  }
</script>

<div class={['tag-input', { full }]}>
  <ul class="chips">
    {#each tags as label (label)}
      <li>
        {#if chip}
          {@render chip(label, () => remove(label))}
        {:else}
          <span class="chip">{label}</span>
          <button type="button" aria-label="Remove {label}" onclick={() => remove(label)}>×</button>
        {/if}
      </li>
    {/each}
  </ul>
  <input bind:value={draft} {placeholder} {onkeydown} {...rest} />
  <p class="hint" aria-live="polite">
    {full ? 'Label limit reached' : `${remaining} more allowed`}
  </p>
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .full input {
    border-color: var(--warning, orange);
  }
</style>
