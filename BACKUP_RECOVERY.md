# Fellowship Management System - Backup & Recovery

> **SUPERSEDED / NOT AN IMPLEMENTATION GUIDE.** This is the original design. FEMS does not run a cron backup, store uploads on local/cloud storage, create safety backups, or restore databases through `/backups`; those operations now refuse or report an external responsibility. Use [BACKUP_RESTORE_GUIDE.md](BACKUP_RESTORE_GUIDE.md) and [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md).

## 1. Backup Policy

### Schedule
- **Automatic backups**: Every 12 hours (00:00 and 12:00 UTC)
- **Triggers**: Cron-based background job

### Storage
- **Local**: File system (configurable path, e.g., `/backups/local/`)
- **Cloud**: Cloud object storage (S3/GCS compatible, configurable in production)
- Both local and cloud are used; cloud is the primary recovery source

### Retention
- **Indefinite**: All backups retained (no automatic deletion)
- Each backup has a timestamp and can be uniquely identified

### Backup Contents
- Full database dump (PostgreSQL `pg_dump`)
- Application uploads directory (documents, gallery images)
- Configuration snapshot (non-secret settings)

## 2. Backup Table Schema

```sql
backups {
  id              UUID PRIMARY KEY
  created_by      UUID FK → users
  created_at      TIMESTAMP DEFAULT NOW()
  file_path       TEXT
  file_size       INTEGER
  storage_location TEXT CHECK ('cloud', 'local')
  status          TEXT CHECK ('success', 'failed')
  is_incremental  BOOLEAN DEFAULT false
}
```

## 3. Manual Backup

### POST `/backups`
- **Roles**: Admin, Secretary
- Creates a backup on-demand
- Runs `pg_dump` script + uploads to cloud/local
- Returns backup record
- Audit logged

## 4. Restore Workflow

### GET `/backups`
List all backups (Admin, Secretary, Assistant Secretary)

### POST `/backups/:id/restore`
- **Roles**: Admin, Secretary, Assistant Secretary

**Safe Restoration Workflow (MANDATORY steps):**

1. **Safety Backup**: The system first creates a backup of the current database state before any restore. This backup is tagged as a "safety backup" with a reference to the restore operation.
2. **Warning**: Display a clear warning modal listing consequences:
   - Restoring old backup may lose data created after that backup
   - The safety backup allows recovery of the current state
   - Confirm the backup date
3. **Confirmation**: Require explicit confirmation (type backup ID or click "Confirm Restore")
4. **Restore**: Restore selected backup
5. **Record**: Log the restoration in audit history with timestamp, who, which backup, and safety backup reference.

### Request Body
```json
{
  "confirmSafetyBackup": true,  // Required checkbox
  "reason": "string"            // Optional reason
}
```

### Response
```json
{
  "message": "Restore started",
  "safetyBackupId": "uuid",
  "status": "in_progress"
}
```

## 5. Backup Scripts

### backup.sh (or Node.js script run as cron job)
```bash
#!/bin/bash
# 1. Create pg_dump
# 2. Store to local path with timestamp
# 3. Upload to cloud (if configured)
# 4. Record backup in database via API call or direct DB insert
# 5. Log result
```

### restore.sh
```bash
#!/bin/bash
# 1. Verify backup file exists
# 2. Apply safety backup (call backup.sh to snapshot current)
# 3. Drop and restore from selected backup file
# 4. Clear caches
# 5. Record restoration in audit_logs
```

## 6. Automation

- Cron job runs inside the application container or a sidecar
- Backup scheduler service checks the `backups` table for last backup time
- Emits notification to Admin/Secretary on backup completion (success/failure)

## 7. Notifications

- `backup_completed`: Sent to Admin and Secretary after each backup
- `backup_restore`: Sent to Admin and Secretary after each restore
- `backup_failed`: Sent to Admin if backup fails (alert)

## 8. Disaster Recovery

If the application is completely down:

1. Retrieve latest backup from local/cloud storage
2. Restore PostgreSQL database from dump
3. Restore application uploads
4. Deploy application
5. Verify integrity

## 9. Safety Notes

- Restore NEVER attempts to merge or selectively restore; it is a full replacement
- The safety backup is preserved and accessible for recovery if the restore causes issues
- All restore operations are fully audited
- A user cannot restore while another restore is in progress (lock mechanism)
