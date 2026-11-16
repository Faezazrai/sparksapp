// Sparks: sends a push notification to the other person's phone(s).
// Secrets needed (Supabase → Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:sparks@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user?.email) return json({ error: "Sign in first" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: member } = await admin.from("members").select("side").eq("email", user.email.toLowerCase()).maybeSingle();
  if (!member) return json({ error: "Not a Sparks member" }, 403);
  const otherSide = member.side === "sj" ? "pg" : "sj";

  let payload: { title?: string; body?: string } = {};
  try { payload = await req.json(); } catch { /* empty body is fine */ }
  const message = JSON.stringify({
    title: String(payload.title ?? "Sparks").slice(0, 40),
    body: String(payload.body ?? "is thinking of you").slice(0, 200),
  });

  const { data: subs } = await admin.from("push_subscriptions").select("endpoint, subscription").eq("side", otherSide);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(s.subscription, message, { TTL: 60 * 60 * 12, urgency: "high" });
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }
  return json({ sent });
});
