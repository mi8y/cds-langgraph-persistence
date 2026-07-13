---
"@mi8y/cds-langgraph-persistence": minor
---

- Add `id` as mandatory config to run multiple agents/graphs within a single CDS app
- Made `list` method of `CdsCheckpointSaver` performant by streaming the results and filtering in the query instead of in memory.
