---
type: regex
target:
  source: file
  path: .teachme/metrics.jsonl
pattern: '"kind":"(prepare-failed|project-failed)"'
match: not_contains
---
