import { readonly, shallowRef } from 'vue'

export interface ArticleDraft {
  title: string
  tags: readonly string[]
  keywords: readonly string[]
}

const freeze = (draft: ArticleDraft): ArticleDraft =>
  Object.freeze({ ...draft, tags: Object.freeze([...draft.tags]), keywords: Object.freeze([...draft.keywords]) })

/** Immutable draft state: every update replaces the snapshot. */
export function createDraftStore(initial: ArticleDraft) {
  const draft = shallowRef(freeze(initial))
  return {
    draft: readonly(draft),
    update(patch: Partial<ArticleDraft>) {
      draft.value = freeze({ ...draft.value, ...patch })
    },
  }
}
