# Sparks

A little app for two: Subang Jaya ⇄ Pasir Gudang. Sparks, penguin pets, holding hands, a countdown, a daily question and a "how well do you know me" quiz, with real push notifications on Android and iPhone.

It's a web app you install to the home screen (a PWA). It's hosted free on GitHub Pages, with data and notifications on a free Supabase project.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| `app/sparks.html` | the app itself | Same page as the Claude version of Sparks |
| `app/adapter.js` | in the browser | Sign-in with email + password, syncing through Supabase, push notification setup |
| `app/sw.js` | in the browser | Shows notifications, works offline |
| `supabase/migrations/001_init.sql` | Supabase | Tables, who's allowed in, live updates |
| `supabase/functions/notify` | Supabase | Sends the push to the other phone |
| `.github/workflows/pages.yml` | GitHub | Builds and publishes the site on every push to `main` |

## One-time setup (about 20 minutes)

### 1. Supabase project
1. Create a free project at supabase.com. Pick the Singapore region; it's closest to you both.
2. Go to **SQL Editor** and paste in `supabase/migrations/001_init.sql`. **Change the two emails at the bottom** first: yours goes with `sj`, hers with `pg`. Then click Run.
3. Go to **Authentication → Sign In / Providers → Email**. Keep Email **enabled**, turn **off "Confirm email"**, and save. Sparks signs in with email + password, so Supabase never needs to send an email (no SMTP setup needed).
4. Go to **Authentication → URL Configuration** and set the Site URL to your GitHub Pages address (step 4 below).
5. After you've **both** created your passwords in the app, you can turn off **"Allow new users to sign up"** (Authentication → Sign In / Providers) so nobody else can even make an account. (Even with it on, only the two emails in `members` can see anything.)

### 2. Notification keys (VAPID)
On any computer with Node installed, run:
```bash
npx web-push generate-vapid-keys
```
- In Supabase, under **Edge Functions → Secrets**, add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (set to `mailto:` plus your email).
- Keep the **private key** secret: never put it in this repo.

Then deploy the function. Either:
- go to **Edge Functions → Deploy a new function → Via editor**, name it `notify`, and paste in `supabase/functions/notify/index.ts`; or
- use the CLI: `npx supabase functions deploy notify --project-ref YOUR-PROJECT-REF`.

### 3. Fill in `app/config.js`
Put in your Supabase **Project URL**, the **anon public** key (from Project Settings → API), and the **VAPID public key**. These three are safe to be public.

### 4. GitHub Pages
In this repo, go to **Settings → Pages → Source: GitHub Actions**. Every push to `main` then publishes to `https://<your-username>.github.io/sparksapp/`.

## Installing on your phones
- **Her Android (Chrome):** open the link, tap **Install app** (or ⋮ → Add to Home screen), open Sparks, create your password (first time) or sign in, then tap **Turn on notifications**.
- **Your iPhone (Safari, iOS 16.4 or later):** open the link, tap **Share → Add to Home Screen**, open Sparks **from the home-screen icon**, create your password (first time) or sign in, then tap **Turn on notifications**. iPhones only allow notifications for apps added to the Home Screen.

## Good to know
- Only the two emails in `members` can see or change anything.
- First time on each phone: tap **"First time here? Create your password"**. After that, just sign in. You stay signed in.
- A free Supabase project pauses after a week with no use. Opening the app now and then keeps it awake.
