import { Router, type IRouter, type Request, type Response } from "express";
import { db, supportReportsTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * POST /api/support/reports
 * Soumet un rapport de bug ou de problème. Requiert une authentification.
 */
router.post("/support/reports", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { type, subject, description, screenshotUrl } = req.body ?? {};

  if (
    typeof type !== "string" || type.trim().length === 0 ||
    typeof subject !== "string" || subject.trim().length === 0 ||
    typeof description !== "string" || description.trim().length === 0
  ) {
    res.status(400).json({ error: "Champs requis manquants : type, subject, description" });
    return;
  }

  const [report] = await db
    .insert(supportReportsTable)
    .values({
      userId: req.user.id,
      type: type.trim().slice(0, 80),
      subject: subject.trim().slice(0, 200),
      description: description.trim(),
      screenshotUrl: typeof screenshotUrl === "string" && screenshotUrl.length > 0
        ? screenshotUrl
        : null,
    })
    .returning();

  res.status(201).json({ id: report.id });
});

export default router;
