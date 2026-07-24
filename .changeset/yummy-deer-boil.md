---
"@mi8y/cds-langgraph-persistence": minor
---

Add support for purging completed and expired threads. This can be either used as a utility for managed sweeping or as a plugin-managed job for single/multitenant expired checkpoint cleanup. The purge job will skip threads that are in interrupted or in-progress state (i.e. have pending writes) and will only delete threads that are completed and expired.
