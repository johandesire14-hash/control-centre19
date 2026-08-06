import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  garagesTable,
  kpayPaymentsTable,
  maintenanceRecordsTable,
} from "@workspace/db";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verifies the KPay webhook signature.
 *
 * KPay signs the raw request body with HMAC-SHA256 using your KPAY_SECRET_KEY
 * and sends the hex digest in the `X-KPay-Signature` header.
 *
 * Returns true when the signature is valid or when signature verification is
 * intentionally disabled (no KPAY_SECRET_KEY set — development only).
 */
function isValidKpaySignature(rawBody: string, header: string | undefined): boolean {
  const secret = process.env["KPAY_SECRET_KEY"];
  if (!secret) return true; // dev fallback — no secret configured

  if (!header) return false;

  // Accept both bare hex and "sha256=<hex>" format
  const received = header.startsWith("sha256=") ? header.slice(7) : header;

  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ─── Payout helper ───────────────────────────────────────────────────────────

/**
 * Triggers a KPay payout (reversement) to the garage's MoMo/Airtel account.
 *
 * Returns the KPay payout transaction ID on success, or throws on failure.
 */
async function triggerPayout(opts: {
  paymentId: number;
  amount: number;
  phoneNumber: string;
  provider: string;
  description: string;
}): Promise<string> {
  const baseUrl = process.env["KPAY_BASE_URL"] ?? "https://admin.kpay.site";
  const apiKey = process.env["KPAY_API_KEY"];
  const secretKey = process.env["KPAY_SECRET_KEY"];

  if (!apiKey || !secretKey) {
    throw new Error("KPay credentials are not configured.");
  }

  const externalId = `payout-${opts.paymentId}-${randomUUID()}`;

  // Mark payout as PROCESSING before the network call
  await db
    .update(kpayPaymentsTable)
    .set({ payoutStatus: "PROCESSING", updatedAt: new Date() })
    .where(eq(kpayPaymentsTable.id, opts.paymentId));

  const res = await fetch(`${baseUrl}/api/v1/payouts/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Secret-Key": secretKey,
    },
    body: JSON.stringify({
      amount: opts.amount,
      phoneNumber: opts.phoneNumber,
      provider: opts.provider,
      externalId,
      description: opts.description,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KPay payout failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const payoutTransactionId =
    typeof data["transactionId"] === "string"
      ? data["transactionId"]
      : externalId;

  // Mark payout as PAID and store the payout transaction ID
  await db
    .update(kpayPaymentsTable)
    .set({
      payoutStatus: "PAID",
      payoutTransactionId,
      updatedAt: new Date(),
    })
    .where(eq(kpayPaymentsTable.id, opts.paymentId));

  return payoutTransactionId;
}

// ─── POST /api/kpay/pay ──────────────────────────────────────────────────────

router.post("/kpay/pay", async (req: Request, res: Response) => {
  const baseUrl = process.env["KPAY_BASE_URL"] ?? "https://admin.kpay.site";
  const apiKey = process.env["KPAY_API_KEY"];
  const secretKey = process.env["KPAY_SECRET_KEY"];

  if (!apiKey || !secretKey) {
    res.status(500).json({ error: "KPay credentials are not configured." });
    return;
  }

  const {
    amount,
    phoneNumber,
    provider,
    externalId,
    description,
    clientId,
    garageId,
  } = req.body as Record<string, unknown>;

  if (typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number." });
    return;
  }
  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    res.status(400).json({ error: "phoneNumber is required." });
    return;
  }
  if (typeof provider !== "string" || !provider.trim()) {
    res.status(400).json({ error: "provider is required." });
    return;
  }
  if (typeof externalId !== "string" || !externalId.trim()) {
    res.status(400).json({ error: "externalId is required." });
    return;
  }
  if (typeof description !== "string" || !description.trim()) {
    res.status(400).json({ error: "description is required." });
    return;
  }

  // Persist a PENDING payment record before calling KPay
  await db.insert(kpayPaymentsTable).values({
    externalId,
    status: "PENDING",
    amount: String(amount),
    provider,
    phoneNumber,
    description,
    clientId: typeof clientId === "string" ? clientId : null,
    garageId: typeof garageId === "number" ? garageId : null,
  }).onConflictDoNothing(); // idempotent — don't fail on duplicate externalId

  let kpayRes: globalThis.Response;
  try {
    kpayRes = await fetch(`${baseUrl}/api/v1/payments/init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-Secret-Key": secretKey,
      },
      body: JSON.stringify({ amount, phoneNumber, provider, externalId, description }),
    });
  } catch (err) {
    res.status(502).json({ error: "Could not reach KPay.", details: String(err) });
    return;
  }

  const contentType = kpayRes.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await kpayRes.json()
    : await kpayRes.text();

  res.status(kpayRes.status).json(data);
});

// ─── POST /api/kpay/webhook ──────────────────────────────────────────────────

router.post(
  "/kpay/webhook",
  async (req: Request, res: Response) => {
    // Always respond 200 quickly to acknowledge receipt, even on errors.
    // KPay retries if it doesn't get a timely 200.

    const rawBody = JSON.stringify(req.body);
    const signature = req.headers["x-kpay-signature"] as string | undefined;

    if (!isValidKpaySignature(rawBody, signature)) {
      // Log but still return 200 to prevent KPay retry loops on misconfigured
      // signatures. The payment is NOT updated.
      console.warn("[kpay/webhook] Invalid signature — payload rejected.");
      res.status(200).json({ success: false, error: "invalid_signature" });
      return;
    }

    const payload = req.body as Record<string, unknown>;
    const { externalId, status, transactionId, amount } = payload;

    if (typeof externalId !== "string" || !externalId.trim()) {
      res.status(200).json({ success: false, error: "missing_externalId" });
      return;
    }

    // Look up the payment record
    const [payment] = await db
      .select()
      .from(kpayPaymentsTable)
      .where(eq(kpayPaymentsTable.externalId, externalId))
      .limit(1);

    if (!payment) {
      // Unknown externalId — acknowledge so KPay doesn't retry indefinitely
      console.warn(`[kpay/webhook] Unknown externalId: ${externalId}`);
      res.status(200).json({ success: true });
      return;
    }

    // Idempotency: already processed
    if (payment.status !== "PENDING") {
      res.status(200).json({ success: true });
      return;
    }

    const normalizedStatus = String(status ?? "").toUpperCase();

    if (normalizedStatus === "SUCCESS" || normalizedStatus === "PAID") {
      const paidAt = new Date();

      // ── Commission logic ────────────────────────────────────────────────────
      // grossAmount is the integer amount from the webhook (FCFA).
      // Fall back to the stored numeric amount if the webhook doesn't send it.
      const grossAmount =
        typeof amount === "number"
          ? Math.round(amount)
          : Math.round(Number(payment.amount));

      const commissionAmount = 500; // fixed Wapi fee per transaction (FCFA)
      const netAmount = Math.max(0, grossAmount - commissionAmount);

      // Update payment to PAID with commission breakdown
      await db
        .update(kpayPaymentsTable)
        .set({
          status: "PAID",
          transactionId: typeof transactionId === "string" ? transactionId : null,
          paidAt,
          rawWebhookPayload: payload,
          grossAmount,
          commissionAmount,
          netAmount,
          payoutStatus: "PENDING",
          updatedAt: paidAt,
        })
        .where(eq(kpayPaymentsTable.id, payment.id));

      // Insert maintenance record if we have a client
      if (payment.clientId) {
        await db.insert(maintenanceRecordsTable).values({
          clientId: payment.clientId,
          garageId: payment.garageId ?? null,
          paymentId: payment.id,
          description: payment.description,
          amount: String(grossAmount),
          recordedAt: paidAt,
        });
      }

      console.info(
        `[kpay/webhook] Payment ${externalId} marked PAID — gross=${grossAmount} commission=${commissionAmount} net=${netAmount}`,
      );

      // ── Payout (reversement) to garage ─────────────────────────────────────
      // Only send payout if there is a net amount to transfer and a garage.
      if (netAmount > 0 && payment.garageId) {
        // Fetch garage phone number to use as the MoMo/Airtel destination
        const [garage] = await db
          .select({ phone: garagesTable.phone })
          .from(garagesTable)
          .where(eq(garagesTable.id, payment.garageId))
          .limit(1);

        if (garage?.phone) {
          try {
            const payoutTxId = await triggerPayout({
              paymentId: payment.id,
              amount: netAmount,
              phoneNumber: garage.phone,
              provider: payment.provider,
              description: `Reversement WapiGarage — paiement ${externalId}`,
            });
            console.info(
              `[kpay/webhook] Payout ${payoutTxId} initiated for garage ${payment.garageId} — ${netAmount} FCFA`,
            );
          } catch (err) {
            // Mark payout as FAILED but don't prevent the 200 response —
            // the payment itself was recorded successfully.
            await db
              .update(kpayPaymentsTable)
              .set({ payoutStatus: "FAILED", updatedAt: new Date() })
              .where(eq(kpayPaymentsTable.id, payment.id));
            console.error(
              `[kpay/webhook] Payout failed for payment ${externalId}:`,
              err,
            );
          }
        } else {
          console.warn(
            `[kpay/webhook] Garage ${payment.garageId} has no phone — payout skipped.`,
          );
          await db
            .update(kpayPaymentsTable)
            .set({ payoutStatus: "FAILED", updatedAt: new Date() })
            .where(eq(kpayPaymentsTable.id, payment.id));
        }
      } else if (netAmount === 0) {
        // Nothing to pay out — commission covered the full amount
        await db
          .update(kpayPaymentsTable)
          .set({ payoutStatus: "PAID", updatedAt: new Date() })
          .where(eq(kpayPaymentsTable.id, payment.id));
      }
    } else if (normalizedStatus === "FAILED" || normalizedStatus === "FAILURE") {
      await db
        .update(kpayPaymentsTable)
        .set({
          status: "FAILED",
          transactionId: typeof transactionId === "string" ? transactionId : null,
          rawWebhookPayload: payload,
          updatedAt: new Date(),
        })
        .where(eq(kpayPaymentsTable.id, payment.id));

      console.info(`[kpay/webhook] Payment ${externalId} marked FAILED.`);
    } else {
      // Unrecognised status — store the raw payload for manual review
      await db
        .update(kpayPaymentsTable)
        .set({ rawWebhookPayload: payload, updatedAt: new Date() })
        .where(eq(kpayPaymentsTable.id, payment.id));

      console.warn(`[kpay/webhook] Unknown status "${status}" for ${externalId}.`);
    }

    res.status(200).json({ success: true });
  },
);

export default router;
