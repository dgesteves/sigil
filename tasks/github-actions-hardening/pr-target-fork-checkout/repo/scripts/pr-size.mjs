const SIZES = [
  [10, 'size/XS'],
  [100, 'size/S'],
  [500, 'size/M'],
  [1000, 'size/L'],
]

export const SIZE_LABELS = [...SIZES.map(([, label]) => label), 'size/XL']

/** Size label for a pull request that changes `lines` lines (additions + deletions). */
export function sizeLabel(lines) {
  for (const [limit, label] of SIZES) if (lines < limit) return label
  return 'size/XL'
}
