# Video capacity profile (2026-09-11)

The 4-core, 16 GiB ARM64 host uses ten generation worker slots and ten active
video tasks per user. Queued/submitting/running tasks share the transactional
admission limit across Studio, Canvas and Atlas; this is not a Provider quota change.

| Environment variable | Previous | Current |
| --- | ---: | ---: |
| GENERATION_CONCURRENCY | 6 | 10 |
| MAX_ACTIVE_GENERATIONS_PER_USER | 6 | 10 |
| MAX_ACTIVE_UPLOADS_PER_USER | 9 | 15 |
| MEDIA_MAINTENANCE_CONCURRENCY | 3 | 5 |
| UPLOAD_FINALIZATION_CONCURRENCY | 3 | 5 |
| ASSET_INGEST_CONCURRENCY | 3 | 5 |
| TOS_ARCHIVE_CONCURRENCY | 4 | 6 |
| TOS_SOURCE_READ_CONCURRENCY | 10 | 14 |

Keep preview concurrency at 2 (two FFmpeg threads each), browser multipart at 3,
archive multipart at 4 x 5 MiB per file, and per-task reference preparation at 4.
The latter already scales with the ten generation jobs. Preview requests retain
priority in the shared source-read budget. BullMQ buffers excess work durably;
do not introduce an in-memory waiting queue or increase timeout/retry counts.
Image generation, Canvas text/image jobs and Agent concurrency remain unchanged.

This is bounded I/O headroom, not a claim of measured peak throughput. The
pre-deploy snapshot had about 13 GiB available RAM, low CPU load and no queue
backlog. Do not enlarge individual multipart buffers or timeout/retry windows.
At six archive jobs, the nominal part payload capacity is 6 x 4 x 5 MiB = 120 MiB
(not a total process memory bound; SDK buffers, hedging and previews add overhead).
Queued work stays in Redis/BullMQ; source reads remain capped at 14 per media
process, with queued previews admitted first. Blue-green overlap can temporarily
run both process budgets, so retain the existing worker-drain sequence.

Production `/opt/firefly/.env` overrides application defaults. Back it up with
root-only permissions, set the profile explicitly, then use the normal immutable
ARM64 blue-green deployment. Do not clear queues. Verify effective Web and worker
config, `generation_worker_started`, `media_worker_started`, readiness, queue
depth/age, memory, CPU, Provider 429s and TOS failures after cutover.

Rollback: restore the saved environment profile and deploy the previous digest.
If only I/O pressure rises, reduce archive/source reads first, preserving preview
priority. Do not raise CPU-intensive transcodes alongside archive concurrency.
No schema migration is required. Ten local execution slots do not guarantee ten
upstream running jobs if the Provider imposes its own account-level quota.
