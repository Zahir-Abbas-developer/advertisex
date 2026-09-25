# Legacy migrations (BWM era)

Authored during the BWM phases (Aug 2026) but **never deployed through
`prisma migrate`** — production was synced by `prisma db push` on every
deploy, so no `_prisma_migrations` table ever existed there, and the local
SQLite database was pushed the same way.

When the migration history was baselined for Advertise X (Phase 1, ADR-003/
ADR-007), these files were retired in favour of `00000000000000_baseline`,
which captures the same end state as a single migration. They are kept for
history, not for running: applying them on top of the baseline would fail.
