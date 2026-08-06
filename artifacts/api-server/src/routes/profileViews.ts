import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { db, garagesTable, profileViewsTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * POST /api/garages/:garageId/views
 * Enregistre une vue sur le profil d'un garage.
 * - Si l'utilisateur est authentifié, son userId sert de viewerKey.
 * - Sinon, un identifiant anonyme fourni par le client est utilisé.
 * Anti-spam : une seule vue par (garage, viewerKey) toutes les 24 h.
 */
router.post("/garages/:garageId/views", async (req: Request, res: Response) => {
  const garageId = Number(req.params.garageId);
  if (!Number.isFinite(garageId) || garageId <= 0) {
    res.status(400).json({ error: "Invalid garage ID" });
    return;
  }

  // Determine viewer key: authenticated userId takes precedence
  const viewerKey: string | null = req.isAuthenticated()
    ? req.user.id
    : typeof req.body?.viewerKey === "string" && req.body.viewerKey.length > 0
      ? req.body.viewerKey.slice(0, 128)
      : null;

  if (!viewerKey) {
    // Anonymous without a key — silently ignore
    res.status(200).json({ ok: true });
    return;
  }

  // Anti-spam: check if this viewer already registered a view in the last 24 h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [existing] = await db
    .select({ id: profileViewsTable.id })
    .from(profileViewsTable)
    .where(
      and(
        eq(profileViewsTable.garageId, garageId),
        eq(profileViewsTable.viewerKey, viewerKey),
        gte(profileViewsTable.viewedAt, cutoff),
      ),
    )
    .limit(1);

  if (existing) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  await db.insert(profileViewsTable).values({ garageId, viewerKey });
  res.status(201).json({ ok: true });
});

/**
 * GET /api/garages/mine/views/stats
 * Statistiques de vues pour le garage du propriétaire connecté.
 * Retourne :
 *   - thisMonth  : nombre de vues ce mois-ci
 *   - lastMonth  : nombre de vues le mois précédent
 *   - weekly     : tableau des 8 dernières semaines { weekStart, count }
 */
router.get("/garages/mine/views/stats", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [garage] = await db
    .select({ id: garagesTable.id })
    .from(garagesTable)
    .where(eq(garagesTable.ownerId, req.user.id));

  if (!garage) {
    res.status(404).json({ error: "No garage found for this user" });
    return;
  }

  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 24 * 60 * 60 * 1000);

  const [[thisMonthRow], [lastMonthRow], weeklyResult] = await Promise.all([
    // Vues ce mois-ci
    db
      .select({ value: count() })
      .from(profileViewsTable)
      .where(
        and(
          eq(profileViewsTable.garageId, garage.id),
          gte(profileViewsTable.viewedAt, startOfThisMonth),
        ),
      ),

    // Vues le mois précédent
    db
      .select({ value: count() })
      .from(profileViewsTable)
      .where(
        and(
          eq(profileViewsTable.garageId, garage.id),
          gte(profileViewsTable.viewedAt, startOfLastMonth),
          lte(profileViewsTable.viewedAt, endOfLastMonth),
        ),
      ),

    // Vues par semaine (ISO week) sur les 8 dernières semaines
    db.execute(sql`
      SELECT
        date_trunc('week', viewed_at) AS week_start,
        COUNT(*)::int                 AS view_count
      FROM profile_views
      WHERE garage_id = ${garage.id}
        AND viewed_at >= ${eightWeeksAgo}
      GROUP BY week_start
      ORDER BY week_start ASC
    `),
  ]);

  res.json({
    thisMonth: thisMonthRow?.value ?? 0,
    lastMonth: lastMonthRow?.value ?? 0,
    weekly: (weeklyResult.rows as { week_start: string; view_count: number }[]).map((r) => ({
      weekStart: r.week_start,
      count: r.view_count,
    })),
  });
});

export default router;
