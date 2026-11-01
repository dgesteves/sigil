<script lang="ts">
  import TagInput from './TagInput.svelte'

  type Issue = { title: string; labels: string[] }
  let { initial, onsave }: { initial?: Partial<Issue>; onsave: (issue: Issue) => void } = $props()

  let title = $state(initial?.title ?? '')
  let labels = $state<string[]>(initial?.labels ?? ['triage'])
  let rejected = $state('')

  const colours: Record<string, string> = { bug: 'crimson', feature: 'seagreen', triage: 'goldenrod' }

  function save(event: SubmitEvent) {
    event.preventDefault()
    onsave({ title: title.trim(), labels: [...labels] })
  }
</script>

<form onsubmit={save}>
  <label>Title <input bind:value={title} /></label>

  <TagInput
    bind:tags={labels}
    max={4}
    aria-label="Labels"
    on:change={() => (rejected = '')}
    on:reject={(event) => (rejected = event.detail.value)}
  >
    <span slot="chip" let:tag let:remove class="chip" style:background={colours[tag] ?? 'slategray'}>
      {tag}
      <button type="button" aria-label="Remove {tag}" on:click={remove}>×</button>
    </span>
  </TagInput>

  {#if rejected}
    <p role="alert">“{rejected}” was not added</p>
  {/if}
  <p class="summary">{labels.length} {labels.length === 1 ? 'label' : 'labels'}</p>
  <button type="submit">Save issue</button>
</form>
