/** Strip stray `#<digits>` suffixes. Mirrors `api/catalog_labels.py`. */

const HASH_SUFFIX = /\s*#\d+\b/g

/** `null`/`undefined` stay null. A null display name is not an empty string. */
export function catalogLabel(value: string | null | undefined): string | null {
  if (value == null) return null
  return value.replace(HASH_SUFFIX, '').replace(/\s+/g, ' ').trim()
}
