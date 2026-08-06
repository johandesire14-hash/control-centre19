import { index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { garagesTable } from "./garages";

export const profileViewsTable = pgTable(
  "profile_views",
  {
    id: serial("id").primaryKey(),
    garageId: integer("garage_id")
      .notNull()
      .references(() => garagesTable.id, { onDelete: "cascade" }),
    viewerKey: varchar("viewer_key", { length: 128 }).notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("profile_views_garage_viewer_idx").on(table.garageId, table.viewerKey),
    index("profile_views_garage_date_idx").on(table.garageId, table.viewedAt),
  ],
);

export type ProfileView = typeof profileViewsTable.$inferSelect;
export type InsertProfileView = typeof profileViewsTable.$inferInsert;
