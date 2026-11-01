<script lang="ts">
  import TagInput from '../../src/lib/TagInput.svelte'

  let { onchange }: { onchange?: (tags: string[]) => void } = $props()
</script>

<TagInput tags={['alpha', 'beta']} {onchange}>
  {#snippet chip(label, remove)}
    <em class="custom">{label}</em>
    <button type="button" class="drop" onclick={remove}>drop {label}</button>
  {/snippet}
</TagInput>
