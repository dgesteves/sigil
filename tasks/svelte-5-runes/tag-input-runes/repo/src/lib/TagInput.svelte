<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  /** Current labels. Parents usually bind to it: <TagInput bind:tags={labels} />. */
  export let tags: string[] = []
  /** Maximum number of labels. */
  export let max = 10
  export let placeholder = 'Add a label'

  type Reason = 'empty' | 'duplicate' | 'full'
  const dispatch = createEventDispatcher<{
    change: string[]
    reject: { value: string; reason: Reason }
  }>()

  let draft = ''

  $: remaining = Math.max(0, max - tags.length)
  $: full = remaining === 0

  function normalise(value: string) {
    return value.trim().replace(/\s+/g, '-').toLowerCase()
  }

  function add() {
    const value = normalise(draft)
    if (!value) {
      dispatch('reject', { value, reason: 'empty' })
      return
    }
    if (tags.includes(value)) {
      dispatch('reject', { value, reason: 'duplicate' })
      return
    }
    if (full) {
      dispatch('reject', { value, reason: 'full' })
      return
    }
    tags = [...tags, value]
    draft = ''
    dispatch('change', tags)
  }

  function remove(tag: string) {
    tags = tags.filter((t) => t !== tag)
    dispatch('change', tags)
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add()
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      remove(tags[tags.length - 1])
    }
  }
</script>

<div class="tag-input" class:full>
  <ul class="chips">
    {#each tags as tag (tag)}
      <li>
        <slot name="chip" {tag} remove={() => remove(tag)}>
          <span class="chip">{tag}</span>
          <button type="button" aria-label="Remove {tag}" on:click={() => remove(tag)}>×</button>
        </slot>
      </li>
    {/each}
  </ul>
  <input bind:value={draft} {placeholder} on:keydown={onKeydown} {...$$restProps} />
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
