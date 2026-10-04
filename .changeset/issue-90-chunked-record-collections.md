---
'vietnam-accomodation-search': patch
---

Store every non-offer record collection that outgrows one chunk as bounded, content-defined, indexed LiNo chunks (`KIND.index.json` plus `KIND.chunks/SHA/KIND.lino`), stream an oversized single file into chunks one record at a time, and refuse any single file or chunk that would approach the parse bound; add `LinksStore#appendRecords` with record-count and byte eviction that rewrites only the chunks it changes, and use it for Telegram domain records, events and traces and for the live audit (#90, #92).
