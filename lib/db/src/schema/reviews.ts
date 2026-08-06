import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { garagesTable } from "./garages";

export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  garageId: integer("garage_id")
    .notNull()
    .references(() => garagesTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id")
    .notNull()
    .references(() => usersTable.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  qualityRating: integer("quality_rating").notNull(),
  honestyRating: integer("honesty_rating").notNull(),
  punctualityRating: integer("punctuality_rating").notNull(),
  valueRating: integer("value_rating").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Review = typeof reviewsTable.$inferSelect;
export type InsertReview = typeof reviewsTable.$inferInsert;
