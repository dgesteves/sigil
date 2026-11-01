<script lang="ts">
  import TagInput from '../../src/lib/TagInput.svelte'

  let { max = 10 }: { max?: number } = $props()
  let tags = $state(['bug'])
</script>

<TagInput bind:tags {max} aria-label="Labels" />
<output>{tags.join(',')}</output>
<button type="button" class="parent-reset" onclick={() => (tags = [])}>reset</button>
