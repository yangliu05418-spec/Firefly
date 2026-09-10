# Video capacity profile (2026-09-10)

The 4-core, 16 GiB ARM64 host uses six generation worker slots and six active
video tasks per user. Queued/submitting/running tasks share the transactional
admission limit across Studio, Canvas and Atlas; this is not a Provider quota change.

| Environment variable | Previous | Current |
| --- | ---: | ---: |
| GENERATION_CONCURRENCY | 4 | 6 |
| MAX_ACTIVE_GENERATIONS_PER_USER | 4 | 6 |
| MAX_ACTIVE_UPLOADS_PER_USER | 6 | 9 |
| MEDIA_MAINTENANCE_CONCURRENCY | 2 (hardcoded) | 3 |
| UPLOAD_FINALIZATION_CONCURRENCY | 2 (hardcoded) | 3 |
| ASSET_INGEST_CONCURRENCY | 2 (hardcoded) | 3 |
| TOS_ARCHIVE_CONCURRENCY | 3 | 4 |
| TOS_SOURCE_READ_CONCURRENCY | 8 | 10 |

Keep preview concurrency at 2 (two FFmpeg threads each), browser multipart at 3,
archive multipart at 4 x 5 MiB per file, and per-task reference preparation at 4.
The latter already scales with the six generation jobs. Preview requests retain
priority in the shared source-read budget. BullMQ buffers excess work durably;
do not introduce an in-memory waiting queue or increase timeout/retry counts.
Image generation, Canvas text/image jobs and Agent concurrency remain unchanged.

Production `/opt/firefly/.env` overrides application defaults. Back it up with
root-only permissions, set the profile explicitly, then use the normal immutable
ARM64 blue-green deployment. Do not clear queues. Verify effective Web and worker
config, `generation_worker_started`, `media_worker_started`, readiness, queue
depth/age, memory, CPU, Provider 429s and TOS failures after cutover.

Rollback: restore the saved environment profile and deploy the previous digest.
If only I/O pressure rises, reduce archive/source reads first, preserving preview
priority. Do not raise CPU-intensive transcodes alongside archive concurrency.
No schema migration is required. Six local execution slots do not guarantee six
upstream running jobs if the Provider imposes its own account-level quota.
