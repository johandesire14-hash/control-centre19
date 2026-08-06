# WapiGarage

A mobile-first platform for connecting users with certified garages. Features service requests, reviews, messaging, and garage profiles.

## Architecture

This is a pnpm monorepo with two main services:

- **`artifacts/api-server`** — Express v5 + TypeScript REST API (port 8080)
- **`artifacts/mobile`** — Expo (React Native) mobile app (port 18115)

### Shared libraries

- **`lib/db`** — Drizzle ORM schema + PostgreSQL client (`@workspace/db`)
- **`lib/api-zod`** — Shared Zod schemas for API request/response validation (`@workspace/api-zod`)
- **`lib/api-client-react`** — Generated React Query hooks for the mobile app (`@workspace/api-client-react`)
- **`lib/replit-auth-web`** — Web-based auth utilities

## First-time setup (nouveau compte Replit)

Avant de lancer le projet, configurez tous les secrets dans l'onglet **Secrets** (🔒) :

| Variable | Type | Description |
|---|---|---|
| `SUPABASE_DATABASE_URL` | Secret | Connection string PostgreSQL — Supabase → Settings → Database → Transaction pooler (port 6543) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Clé service_role — Supabase → Settings → API → service_role |
| `GOOGLE_CLIENT_SECRET` | Secret | Secret OAuth Google — Google Cloud Console → Credentials |
| `SESSION_SECRET` | Secret | Chaîne aléatoire (`openssl rand -hex 32`) |
| `EXPO_PUBLIC_SUPABASE_URL` | Env var | URL du projet Supabase (ex: `https://xxxx.supabase.co`) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Env var | Clé anon/public Supabase |
| `GOOGLE_CLIENT_ID` | Env var | Client ID OAuth Google |

Après avoir tout configuré, lancez **🔧 Setup Check** pour valider, puis **Run** pour démarrer.

## Running the project

Both services start automatically via the configured workflows:

```
PORT=8080 pnpm --filter @workspace/api-server run dev
PORT=18115 pnpm --filter @workspace/mobile run dev
```

Or use the **Run** button which starts both in parallel.

Health check: `GET /api/healthz` → `{"status":"ok"}`

## Database

Uses **Supabase PostgreSQL** (not Replit's built-in database).

Connection string is read from `SUPABASE_DATABASE_URL` env var (see `lib/db/src/index.ts`).  
Schema is defined in `lib/db/src/schema/` and managed with Drizzle ORM.

To push schema changes:
```
cd lib/db && pnpm run push
```

## Image storage

Images are stored in **Supabase Storage** in the `wapi-bucket` bucket (public).

The mobile app uploads directly to Supabase via `artifacts/mobile/lib/uploadImage.ts`.  
Images are served through the API proxy at `/api/images/*` (see `artifacts/api-server/src/routes/images.ts`), which forwards to `https://<supabase-url>/storage/v1/object/public/wapi-bucket/*`.

**Important — Express 5 wildcard fix**: `req.params.path` returns an array in Express 5. The route joins with `"/"` to reconstruct the path. This fix is in `images.ts` and `storage.ts`.

The mobile `imageUrl.ts` converts any raw Supabase Storage URL to a proxy URL using `EXPO_PUBLIC_DOMAIN`.

## Environment variables

| Variable | Where set | Status | Notes |
|---|---|---|---|
| `SESSION_SECRET` | Replit secret | ✅ Set | Signs session cookies |
| `SUPABASE_DATABASE_URL` | Replit secret | ✅ Set | PostgreSQL connection string (transaction pooler, port 6543) |
| `EXPO_PUBLIC_SUPABASE_URL` | Replit env | ✅ Set | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Replit env | ✅ Set | Supabase anon key (mobile uploads) |
| `GOOGLE_CLIENT_ID` | Replit env | ✅ Set | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Replit secret | ✅ Set | Google OAuth client secret |
| `EXPO_PUBLIC_DOMAIN` | Replit env | Auto-set by workflow | Dev domain — used to build proxy image URLs |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Replit secret | ✅ Set | Firebase Web API key (SMS OTP) |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Replit secret | ✅ Set | Firebase project ID (SMS OTP) |

## SMS OTP authentication (Firebase Phone Auth)

The mobile app supports login by phone number (Congo 🇨🇬 +242) via Firebase Auth.

### How the flow works

1. User enters their Congo number (MTN 06… or Airtel 05…)
2. Firebase sends a 6-digit SMS code via reCAPTCHA verification
3. After code confirmation, the Firebase user is upserted into the `profiles` Supabase table (`id = uid, phone = phoneNumber`)
4. The session is persisted locally in Expo SecureStore (`firebase_auth_user`)

### Firebase console setup (required)

1. Go to [Firebase Console](https://console.firebase.google.com/) → your project
2. **Authentication → Sign-in method** → Enable **Phone**
3. **Authentication → Settings → Authorized domains** → add your Replit dev domain:
   ```
   <your-replit-dev-domain>.replit.dev
   ```
   Find it with: `echo $REPLIT_DEV_DOMAIN`
4. For web: the reCAPTCHA verifier runs automatically via `expo-firebase-recaptcha`
5. For native (Expo Go): phone auth requires a **development build** (Expo Go does not include react-native-webview needed for reCAPTCHA)

### Supabase RLS note

`lib/supabase.ts` exports `createSupabaseWithToken(firebaseIdToken)` which injects the Firebase JWT as the `Authorization` header. Configure your Supabase RLS policies to validate this token if needed.

## Setting up Google OAuth (required for login)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Open the OAuth 2.0 Client ID used for this project
3. Under **Authorized redirect URIs**, add:
   ```
   https://<your-replit-dev-domain>/api/auth/google/callback
   ```
   Find your dev domain by running `echo $REPLIT_DEV_DOMAIN` in the shell.
4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Replit secrets.

## User preferences
