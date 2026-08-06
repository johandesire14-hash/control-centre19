import crypto from "crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import {
  getSessionId,
  createSession,
  deleteSession,
  type SessionData,
} from "../lib/auth";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

async function upsertUser(
  claims: Record<string, unknown>,
): Promise<{ user: typeof usersTable.$inferSelect; isNewUser: boolean }> {
  const userData = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as
      | string
      | null,
  };

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userData.id));

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        ...userData,
        updatedAt: new Date(),
      },
    })
    .returning();
  return { user, isNewUser: !existing };
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

function getGoogleCallbackUrl(req: Request): string {
  return `${getOrigin(req)}/api/auth/google/callback`;
}

function getSafeMobileRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:" && !value.includes("://")) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

router.get("/auth/google", (req: Request, res: Response) => {
  const mobileRedirect = getSafeMobileRedirect(req.query.mobile_redirect);
  if (!mobileRedirect) {
    res.status(400).json({ error: "Missing or invalid mobile_redirect parameter" });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: "Google Sign-In is not configured" });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  setOidcCookie(res, "google_state", state);
  setOidcCookie(res, "google_mobile_redirect", mobileRedirect);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", getGoogleCallbackUrl(req));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  res.redirect(authUrl.href);
});

router.get("/auth/google/callback", async (req: Request, res: Response) => {
  const mobileRedirect = req.cookies?.google_mobile_redirect;
  const expectedState = req.cookies?.google_state;

  res.clearCookie("google_state", { path: "/" });
  res.clearCookie("google_mobile_redirect", { path: "/" });

  if (!mobileRedirect) {
    res.status(400).json({ error: "Missing session, please try signing in again" });
    return;
  }

  const failRedirect = (message: string) => {
    const url = new URL(mobileRedirect);
    url.searchParams.set("error", message);
    res.redirect(url.href);
  };

  const { code, state, error: googleError } = req.query;

  if (googleError) {
    failRedirect(String(googleError));
    return;
  }

  if (!code || typeof code !== "string" || !state || state !== expectedState) {
    failRedirect("invalid_state");
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    failRedirect("not_configured");
    return;
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getGoogleCallbackUrl(req),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      req.log.error({ status: tokenRes.status, body: await tokenRes.text() }, "Google token exchange failed");
      failRedirect("token_exchange_failed");
      return;
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
    };

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoRes.ok) {
      failRedirect("userinfo_failed");
      return;
    }

    const googleUser = (await userInfoRes.json()) as GoogleUserInfo;

    const { user: dbUser, isNewUser } = await upsertUser({
      sub: googleUser.sub,
      email: googleUser.email ?? null,
      first_name: googleUser.given_name ?? null,
      last_name: googleUser.family_name ?? null,
      picture: googleUser.picture ?? null,
    });

    const sessionData: SessionData = {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        profileImageUrl: dbUser.profileImageUrl,
      },
      access_token: tokenData.access_token,
      provider: "google" as const,
    };

    const sid = await createSession(sessionData);

    const successUrl = new URL(mobileRedirect);
    successUrl.searchParams.set("token", sid);
    successUrl.searchParams.set("isNewUser", String(isNewUser));
    res.redirect(successUrl.href);
  } catch (err) {
    req.log.error({ err }, "Google sign-in error");
    failRedirect("unexpected_error");
  }
});

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

export default router;
