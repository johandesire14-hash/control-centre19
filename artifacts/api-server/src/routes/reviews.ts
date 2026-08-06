import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, reviewsTable, usersTable, garagesTable, notificationsTable } from "@workspace/db";
import { CreateGarageReviewBody, CreateGarageReviewResponse, ListGarageReviewsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/garages/:garageId/reviews", async (req: Request, res: Response) => {
  const garageId = Number(req.params.garageId);

  const rows = await db
    .select({ review: reviewsTable, user: usersTable })
    .from(reviewsTable)
    .innerJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
    .where(eq(reviewsTable.garageId, garageId))
    .orderBy(desc(reviewsTable.createdAt));

  res.json(
    ListGarageReviewsResponse.parse(
      rows.map(({ review, user }) => ({
        id: review.id,
        garageId: review.garageId,
        userId: review.userId,
        userName: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Utilisateur",
        userProfileImageUrl: user.profileImageUrl,
        rating: review.rating,
        comment: review.comment,
        qualityRating: review.qualityRating,
        honestyRating: review.honestyRating,
        punctualityRating: review.punctualityRating,
        valueRating: review.valueRating,
        createdAt: review.createdAt.toISOString(),
      })),
    ),
  );
});

router.post("/garages/:garageId/reviews", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const garageId = Number(req.params.garageId);
  const parsed = CreateGarageReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid fields" });
    return;
  }

  const [garage] = await db.select().from(garagesTable).where(eq(garagesTable.id, garageId));
  if (!garage) {
    res.status(404).json({ error: "Garage not found" });
    return;
  }

  // Anti-self-interaction: garage owner cannot review their own garage
  if (garage.ownerId === req.user.id) {
    res.status(403).json({ error: "Vous ne pouvez pas interagir avec votre propre garage." });
    return;
  }

  const [review] = await db
    .insert(reviewsTable)
    .values({
      garageId,
      userId: req.user.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
      qualityRating: parsed.data.qualityRating,
      honestyRating: parsed.data.honestyRating,
      punctualityRating: parsed.data.punctualityRating,
      valueRating: parsed.data.valueRating,
    })
    .returning();

  await db.insert(notificationsTable).values({
    userId: garage.ownerId,
    type: "review",
    target: "pro",
    content: "Votre garage a reçu un nouvel avis.",
    relatedId: garageId,
  });

  const user = req.user;
  res.status(201).json(
    CreateGarageReviewResponse.parse({
      id: review.id,
      garageId: review.garageId,
      userId: review.userId,
      userName: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Utilisateur",
      userProfileImageUrl: user.profileImageUrl,
      rating: review.rating,
      comment: review.comment,
      qualityRating: review.qualityRating,
      honestyRating: review.honestyRating,
      punctualityRating: review.punctualityRating,
      valueRating: review.valueRating,
      createdAt: review.createdAt.toISOString(),
    }),
  );
});

export default router;
