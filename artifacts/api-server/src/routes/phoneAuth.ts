/**
 * Phone OTP authentication routes — backend-mediated flow.
 *
 * POST /api/auth/phone/send-otp
 *   Generates a 6-digit OTP and sends it via WhatsApp (Infobip).
 *   Falls back to console log if Infobip credentials are not configured.
 *
 * POST /api/auth/phone/verify-otp
 *   Verifies the OTP, upserts the user in the database, creates a session
 *   and returns a Bearer token — same session system as Google OAuth.
 */

import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSession, type SessionData } from "../lib/auth";
import { sendWhatsAppOtp } from "../lib/whatsapp";

const router: IRouter = Router();

// ─── In-memory OTP store ─────────────────────────────────────────────────────
interface OtpEntry {
  code: string;
  expiresAt: Date;
}

const otpStore = new Map<string, OtpEntry>();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function generateOtp(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

// ─── POST /api/auth/phone/send-otp ───────────────────────────────────────────

router.post("/auth/phone/send-otp", async (req: Request, res: Response) => {
  const { phone } = req.body as Record<string, unknown>;

  if (typeof phone !== "string" || !/^\+\d{7,15}$/.test(phone)) {
    res.status(400).json({ error: "Numéro de téléphone invalide." });
    return;
  }

  const code = generateOtp();
  otpStore.set(phone, { code, expiresAt: new Date(Date.now() + OTP_TTL_MS) });

  try {
    await sendWhatsAppOtp(phone, code);
  } catch (err) {
    console.error("[auth/phone/send-otp] WhatsApp send failed:", err);
    res.status(502).json({ error: "Impossible d'envoyer le code. Veuillez réessayer." });
    return;
  }

  res.json({ success: true });
});

// ─── POST /api/auth/phone/verify-otp ─────────────────────────────────────────

router.post("/auth/phone/verify-otp", async (req: Request, res: Response) => {
  const { phone, code } = req.body as Record<string, unknown>;

  if (typeof phone !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "phone et code sont requis." });
    return;
  }

  const entry = otpStore.get(phone);
  if (!entry || entry.expiresAt < new Date()) {
    otpStore.delete(phone);
    res.status(400).json({ error: "Code expiré ou introuvable. Renvoyez le code." });
    return;
  }

  if (entry.code !== code) {
    res.status(400).json({ error: "Code incorrect. Réessayez." });
    return;
  }

  // Consume the OTP immediately after first successful match.
  otpStore.delete(phone);

  // Upsert the user — deterministic ID based on phone number.
  const userId = `phone_${phone.replace(/^\+/, "")}`;

  const [existing] = await db
    .select({ id: usersTable.id, onboardingCompleted: usersTable.onboardingCompleted })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const [user] = await db
    .insert(usersTable)
    .values({ id: userId, phone })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: { phone, updatedAt: new Date() },
    })
    .returning();

  const isNewUser = !existing;

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    },
    access_token: crypto.randomBytes(16).toString("hex"),
    provider: "phone",
  };

  const sid = await createSession(sessionData);
  res.json({ token: sid, isNewUser });
});

export default router;
