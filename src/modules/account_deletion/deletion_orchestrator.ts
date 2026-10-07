import { purgeUserR2Media, R2PurgeResult } from './r2_storage_purger';
import { executeDbCascadePurge, DbCascadePurgeResult } from './db_cascade_purger';
import { verifyUserDeletion, DeletionAuditReport } from './verify_deletion';

export interface ComprehensiveDeletionResult {
  success: boolean;
  message: string;
  verifiedZeroRecords: boolean;
  purgedTables: string[];
  deletedR2MediaCount: number;
  auditReport?: DeletionAuditReport;
  warnings?: string[];
  error?: string;
}

export async function orchestrateAccountDeletion(
  db: any,
  rawHandle: string,
  installationId?: string,
  knownPhone?: string
): Promise<ComprehensiveDeletionResult> {
  const cleanHandle = (rawHandle || '').replace(/^@+/, '').trim().toLowerCase();
  if (!cleanHandle) {
    return {
      success: false,
      message: 'Invalid or missing user handle for deletion',
      verifiedZeroRecords: false,
      purgedTables: [],
      deletedR2MediaCount: 0,
    };
  }

  try {
    // 1. Identity Resolution from D1
    let userRow: { id?: string; phone?: string; handle?: string } | null = null;
    try {
      userRow = (await db
        .prepare('SELECT id, phone, handle FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1')
        .bind(cleanHandle, `@${cleanHandle}`)
        .first()) as any;
    } catch (_) {}

    const userId = userRow?.id || '';
    const phone = userRow?.phone || knownPhone || '';

    // 2. Cloudflare R2 Media Purge (Avatars, Banners, Audio, Post & Chat Attachments)
    const r2Result: R2PurgeResult = await purgeUserR2Media(cleanHandle);

    // 3. Topological D1 Cascade Deletion across all 28 tables
    const dbResult: DbCascadePurgeResult = await executeDbCascadePurge(
      db,
      cleanHandle,
      userId,
      phone,
      installationId
    );

    // 4. Verification Audit Query
    const auditReport: DeletionAuditReport = await verifyUserDeletion(
      db,
      cleanHandle,
      userId,
      phone
    );

    const isFullyDeleted = dbResult.success && auditReport.verifiedZeroRecords;

    if (!isFullyDeleted) {
      console.warn('[orchestrateAccountDeletion] Audit flagged remaining records:', auditReport.auditCounts);
    }

    return {
      success: isFullyDeleted,
      message: isFullyDeleted
        ? 'Account, databases, and media storage completely and permanently wiped'
        : 'Partial deletion detected; some records or foreign keys could not be wiped',
      verifiedZeroRecords: auditReport.verifiedZeroRecords,
      purgedTables: dbResult.purgedTables,
      deletedR2MediaCount: r2Result.deletedCount,
      auditReport,
      warnings: dbResult.warnings,
      error: dbResult.error,
    };
  } catch (err: any) {
    console.error('[orchestrateAccountDeletion] Critical failure during orchestration:', err);
    return {
      success: false,
      message: 'Fatal exception while orchestrating account deletion',
      verifiedZeroRecords: false,
      purgedTables: [],
      deletedR2MediaCount: 0,
      error: err?.message || String(err),
    };
  }
}
