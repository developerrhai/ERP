// Phase 22: place existing bins on a shelf (Warehouse -> Zone -> Rack -> Shelf -> Bin). The database
// trigger wms_bins_sync_location copies the zone and rack onto the bin, so the bin picker of a GRN
// put-away can show where a bin really is.
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';

export interface ShelfBinRow {
  id: string;
  code: string;
  name: string;
  status: string;
}

export const shelfBinBody = z.object({ binId: z.string().uuid('Pick a bin.') }).strict();

export async function binsOnShelf(
  shelfId: string,
): Promise<{ warehouseId: string; bins: ShelfBinRow[] }> {
  // unpaginated: one shelf by id (single row)
  const sh = await prisma.$queryRaw<{ warehouse_id: string }[]>`
    SELECT r.warehouse_id::text AS warehouse_id FROM wms_shelves s JOIN wms_racks r ON r.id = s.rack_id
     WHERE s.id = ${shelfId}::uuid AND s.deleted_at IS NULL`;
  if (!sh[0]) throw Errors.notFound('Shelf not found.');
  const bins = await prisma.$queryRaw<ShelfBinRow[]>`
    SELECT id::text AS id, code, name, status::text AS status FROM wms_bins
     WHERE shelf_id = ${shelfId}::uuid AND deleted_at IS NULL ORDER BY code LIMIT 500`;
  return { warehouseId: sh[0].warehouse_id, bins };
}

export async function placeBin(actorId: string, shelfId: string, binId: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRaw(
        Prisma.sql`UPDATE wms_bins SET shelf_id = ${shelfId}::uuid, updated_at = now(), updated_by_id = ${actorId}::uuid,
                     version = version + 1
                   WHERE id = ${binId}::uuid AND deleted_at IS NULL`,
      );
      if (n !== 1) throw Errors.notFound('Bin not found.');
      await recordAudit(
        { action: 'screen.updated', actorId, targetType: 'wms-shelves', targetId: shelfId, detail: { placedBin: binId } },
        tx,
      );
    });
  } catch (e) {
    if (e instanceof Error && /same warehouse as its shelf/.test(e.message)) {
      throw Errors.validation({ binId: 'This bin is in another warehouse than the shelf.' });
    }
    throw e;
  }
}

export async function removeBin(actorId: string, shelfId: string, binId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const n = await tx.$executeRaw`
      UPDATE wms_bins SET shelf_id = NULL, updated_at = now(), updated_by_id = ${actorId}::uuid, version = version + 1
       WHERE id = ${binId}::uuid AND shelf_id = ${shelfId}::uuid AND deleted_at IS NULL`;
    if (n !== 1) throw Errors.notFound('This bin is not on this shelf.');
    await recordAudit(
      { action: 'screen.updated', actorId, targetType: 'wms-shelves', targetId: shelfId, detail: { removedBin: binId } },
      tx,
    );
  });
}
