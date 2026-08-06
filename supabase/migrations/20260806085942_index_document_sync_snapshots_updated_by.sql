-- Cover the profile foreign key used when maintaining canonical Yjs snapshots.
create index document_sync_snapshots_updated_by_idx
  on private.document_sync_snapshots (updated_by);
