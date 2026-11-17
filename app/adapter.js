/*
 * Sparks app adapter.
 * The Sparks page (sparks.html) was written against a tiny `claude.use("db")` / `claude.use("room")` API.
 * This file provides that same API on top of Supabase, adds email-code sign-in, and push notifications.
 */
(() => {
  const cfg = window.SPARKS_CONFIG || {};
  const configured = cfg.supabaseUrl && !/YOUR-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey);
  const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  }) : null;

  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  let me = null; // { side, user }
  let dbApi = null, roomApi = null;

  window.claude = {
    use: async (name) => {
      const ok = await ready;
      if (!ok) return null;
      if (name === "db") return dbApi;
      if (name === "room") return roomApi;
      return null;
    }
  };

  const onDom = (fn) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn());

  // ---------------- sign-in ----------------
  const LOGIN_CSS = `
    #sp-login{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:16px;
      background:radial-gradient(110% 55% at 50% -5%,#fff2f7 0%,#ffe4ee 55%,#ffd0e1 100%);font-family:"Nunito",ui-rounded,system-ui,sans-serif;color:#5b2343}
    #sp-login form{width:100%;max-width:380px;background:#fff7fa;border:2px solid #fff;border-radius:26px;padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:0 6px 20px rgba(224,68,126,.15)}
    #sp-login h1{margin:0;font-family:"Fredoka",ui-rounded,system-ui,sans-serif;color:#e0447e;font-size:2rem}
    #sp-login p{margin:0;color:#a3698a}
    #sp-login input{font:inherit;font-size:16px;background:#ffeef4;border:2px solid #f5bfd3;border-radius:16px;padding:12px;color:#5b2343}
    #sp-login button{font:inherit;font-weight:800;border:none;border-radius:16px;padding:12px;background:#ff6f9e;color:#fff;box-shadow:0 4px 0 #e0447e;cursor:pointer}
    #sp-login .err{color:#c2185b;font-weight:700;min-height:1.2em}
    #sp-notify{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:45;
      border:none;border-radius:999px;padding:12px 20px;font:800 15px "Nunito",ui-rounded,system-ui,sans-serif;background:#e0447e;color:#fff;
      box-shadow:0 8px 20px rgba(224,68,126,.35);max-width:calc(100% - 32px);cursor:pointer}`;

  function showLogin(message) {
    onDom(() => {
      if (!document.getElementById("sp-style")) {
        const st = document.createElement("style"); st.id = "sp-style"; st.textContent = LOGIN_CSS; document.head.appendChild(st);
      }
      let box = document.getElementById("sp-login");
      if (box) box.remove();
      box = document.createElement("div"); box.id = "sp-login";
      box.innerHTML = `
        <form id="sp-email">
          <h1>Sparks</h1>
          <p id="sp-intro">Sign in with your email and password.</p>
          <input type="email" id="sp-e" placeholder="you@example.com" autocomplete="email" required>
          <input type="password" id="sp-p" placeholder="Password (at least 6 characters)" autocomplete="current-password" minlength="6" required>
          <button type="submit" id="sp-go">Sign in</button>
          <a href="#" id="sp-toggle" style="color:#e0447e;font-weight:800;text-align:center">First time here? Create your password</a>
          <span class="err" id="sp-err"></span>
        </form>`;
      document.body.appendChild(box);
      const err = box.querySelector("#sp-err");
      if (message) err.textContent = message;
      let creating = false;
      box.querySelector("#sp-toggle").addEventListener("click", (e) => {
        e.preventDefault();
        creating = !creating;
        box.querySelector("#sp-intro").textContent = creating ? "Pick a password for Sparks. You'll only do this once." : "Sign in with your email and password.";
        box.querySelector("#sp-go").textContent = creating ? "Create my account" : "Sign in";
        box.querySelector("#sp-toggle").textContent = creating ? "Already have a password? Sign in" : "First time here? Create your password";
        box.querySelector("#sp-p").autocomplete = creating ? "new-password" : "current-password";
        err.textContent = "";
      });
      box.querySelector("#sp-email").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!sb) { err.textContent = "The app isn't set up yet: fill in config.js first."; return; }
        const email = box.querySelector("#sp-e").value.trim().toLowerCase();
        const password = box.querySelector("#sp-p").value;
        err.textContent = creating ? "Creating your account…" : "Signing in…";
        if (creating) {
          const { data, error } = await sb.auth.signUp({ email, password });
          if (error) { err.textContent = /registered|exists/i.test(error.message) ? "This email already has a password. Tap \"Sign in\" instead." : "Couldn't create the account: " + error.message; return; }
          if (!data.session) { err.textContent = "Account made, but Supabase wants email confirmation. Turn off \"Confirm email\" in Supabase, then sign in."; return; }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) { err.textContent = "Wrong email or password. First time? Tap \"Create your password\"."; return; }
        }
        start();
      });
    });
  }

  async function lookupSide(email) {
    const { data, error } = await sb.from("members").select("side").eq("email", (email || "").toLowerCase()).maybeSingle();
    if (error) return { error: error.message };
    return { side: data ? data.side : null };
  }

  async function start() {
    if (!sb) { showLogin("The app isn't set up yet: fill in config.js first."); resolveReady(false); return; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showLogin(); return; }
    const found = await lookupSide(session.user.email);
    const side = found.side;
    if (!side) {
      const email = session.user.email;
      await sb.auth.signOut();
      showLogin(found.error
        ? `Signed in as ${email}, but couldn't read the members list (${found.error}). Has the setup SQL been run in Supabase?`
        : `Signed in as ${email}, but that email isn't in the members table. Add it in Supabase (Table Editor → members), then sign in again.`);
      return;
    }
    let stored = null;
    try { stored = localStorage.getItem("sparks.side"); } catch {}
    if (stored !== side) {
      try { localStorage.setItem("sparks.side", side); } catch {}
      location.reload();
      return;
    }
    const lg = document.getElementById("sp-login"); if (lg) lg.remove();
    me = { side, user: session.user };
    dbApi = makeDb();
    roomApi = makeRoom();
    resolveReady(true);
    setupPush();
  }

  // ---------------- db: document store on the `kv` table ----------------
  function makeDb() {
    const cache = new Map();      // path -> data | null
    const listeners = new Map();  // path -> Set<{next, error}>
    const snap = (path, d) => ({
      id: path.split("/").pop(), exists: d != null,
      data: () => (d == null ? undefined : d),
      metadata: { fromCache: false, hasPendingWrites: false }
    });
    const emit = (path) => {
      const set = listeners.get(path); if (!set) return;
      const s = snap(path, cache.get(path));
      for (const l of set) { try { l.next(s); } catch (e) { console.error(e); } }
    };
    const fail = (error) => ({ code: error && error.code === "42501" ? "invalid_argument" : "unavailable", message: (error && error.message) || "error" });

    async function fetchPaths(paths) {
      if (!paths.length) return;
      const { data, error } = await sb.from("kv").select("path,data").in("path", paths);
      if (error) return;
      const found = new Set();
      for (const row of data) { found.add(row.path); cache.set(row.path, row.data); emit(row.path); }
      for (const p of paths) if (!found.has(p)) { cache.set(p, null); emit(p); }
    }

    sb.channel("kv-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "kv" }, (payload) => {
        if (payload.eventType === "DELETE") { const p = payload.old && payload.old.path; if (p) { cache.set(p, null); emit(p); } }
        else if (payload.new && payload.new.path) { cache.set(payload.new.path, payload.new.data); emit(payload.new.path); }
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") fetchPaths([...listeners.keys()]); });

    // Catch up whenever the app comes back to the foreground.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fetchPaths([...listeners.keys()]); });

    function doc(path) {
      const ref = {
        id: path.split("/").pop(), path,
        async get() {
          const { data, error } = await sb.from("kv").select("data").eq("path", path).maybeSingle();
          if (error) throw fail(error);
          return snap(path, data ? data.data : null);
        },
        async set(d) {
          const { error } = await sb.from("kv").upsert({ path, data: d, updated_at: new Date().toISOString() });
          if (error) throw fail(error);
          cache.set(path, d); emit(path);
        },
        async update(d) {
          const cur = (await ref.get()).data();
          if (!cur) throw { code: "invalid_argument", message: "Document does not exist" };
          const merge = (a, b) => { const o = { ...a }; for (const k in b) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" ? merge(a[k], b[k]) : b[k]; return o; };
          await ref.set(merge(cur, d));
        },
        async delete() {
          const { error } = await sb.from("kv").delete().eq("path", path);
          if (error) throw fail(error);
          cache.set(path, null); emit(path);
        },
        onSnapshot(next, error) {
          const l = { next, error };
          if (!listeners.has(path)) listeners.set(path, new Set());
          listeners.get(path).add(l);
          if (cache.has(path)) queueMicrotask(() => { try { next(snap(path, cache.get(path))); } catch (e) { console.error(e); } });
          else fetchPaths([path]);
          return () => { const s = listeners.get(path); if (s) s.delete(l); };
        }
      };
      return ref;
    }
    return Object.freeze({ doc, collection() { throw new Error("collections are not used by Sparks"); }, _cache: cache });
  }

  // ---------------- room: presence + broadcast on a realtime channel ----------------
  function makeRoom() {
    const peer = Math.random().toString(36).slice(2, 12);
    const ch = sb.channel("sparks-room", { config: { presence: { key: peer }, broadcast: { self: true } } });
    let mine = {}, subscribed = false, lastPeers = [];
    const peerHandlers = new Set(), topicHandlers = new Map();
    const sender = (p) => ({ peer: p, by: null, isMe: p === peer, sameTab: p === peer, kind: "viewer", guest: false });

    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      lastPeers = Object.entries(st).map(([k, arr]) => ({ ...sender(k), presence: (arr[arr.length - 1] || {}).p || {}, updatedAt: Date.now() }));
      for (const h of peerHandlers) { try { h({ peers: lastPeers, joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } }
    });
    for (const topic of ["spark", "note", "answer"]) {
      ch.on("broadcast", { event: topic }, ({ payload }) => {
        const hs = topicHandlers.get(topic); if (!hs) return;
        const msg = { ...sender(payload && payload.peer), topic, data: payload && payload.data };
        for (const h of hs) { try { h(msg); } catch (e) { console.error(e); } }
      });
    }
    ch.subscribe(async (status) => {
      subscribed = status === "SUBSCRIBED";
      if (subscribed) await ch.track({ p: mine });
    });

    return Object.freeze({
      async presence(patch) {
        for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
        if (subscribed) await ch.track({ p: mine });
      },
      peers: () => lastPeers,
      onPeers(fn) { peerHandlers.add(fn); if (lastPeers.length) queueMicrotask(() => fn({ peers: lastPeers, joined: [], left: [], updated: [] })); return () => peerHandlers.delete(fn); },
      async emit(topic, data) { if (subscribed) await ch.send({ type: "broadcast", event: topic, payload: { peer, data } }); },
      on(topic, fn) { if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set()); topicHandlers.get(topic).add(fn); return () => topicHandlers.get(topic).delete(fn); },
      connected: () => subscribed
    });
  }

  // ---------------- push notifications ----------------
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function b64ToBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function saveSubscription(sub) {
    const j = sub.toJSON();
    const { error } = await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, user_id: me.user.id, side: me.side, subscription: j });
    if (error) { notice("Couldn't save this phone for notifications: " + error.message); throw error; }
  }

  // A small message at the top of the screen, for things that go wrong behind the scenes.
  let noticeTimer;
  function notice(text) {
    onDom(() => {
      let n = document.getElementById("sp-msg");
      if (!n) {
        n = document.createElement("div"); n.id = "sp-msg";
        n.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(12px + env(safe-area-inset-top,0px));z-index:70;" +
          "max-width:calc(100% - 32px);background:#fff7fa;color:#5b2343;border:2px solid #ff6f9e;border-radius:16px;padding:10px 14px;" +
          "font:700 14px Nunito,ui-rounded,system-ui,sans-serif;box-shadow:0 8px 20px rgba(224,68,126,.25);text-align:center";
        n.addEventListener("click", () => n.remove());
        document.body.appendChild(n);
      }
      n.textContent = text;
      clearTimeout(noticeTimer); noticeTimer = setTimeout(() => n.remove(), 9000);
    });
  }

  function pushButton(text, onClick) {
    onDom(() => {
      if (!document.getElementById("sp-style")) {
        const st = document.createElement("style"); st.id = "sp-style"; st.textContent = LOGIN_CSS; document.head.appendChild(st);
      }
      let b = document.getElementById("sp-notify");
      if (!b) { b = document.createElement("button"); b.id = "sp-notify"; b.type = "button"; document.body.appendChild(b); }
      b.textContent = text;
      b.onclick = onClick;
    });
  }
  const hidePushButton = () => { const b = document.getElementById("sp-notify"); if (b) b.remove(); };

  async function setupPush() {
    if (!("serviceWorker" in navigator)) return;
    let reg;
    try { reg = await navigator.serviceWorker.register("sw.js"); } catch { return; }
    if (!("PushManager" in window) || !("Notification" in window)) {
      if (isIOS && !standalone) pushButton("Add Sparks to your Home Screen for notifications", () => {
        alert("In Safari: tap the Share button, then \"Add to Home Screen\". Open Sparks from the new icon, then turn on notifications.");
      });
      return;
    }
    if (!cfg.vapidPublicKey || /YOUR-/.test(cfg.vapidPublicKey)) return;
    const existing = await reg.pushManager.getSubscription();
    if (Notification.permission === "granted") {
      try {
        const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) });
        await saveSubscription(sub);
      } catch (e) { if (!e || !e.message || !/save this phone/.test(String(e.message))) notice("Notifications are allowed, but this phone couldn't sign up for them: " + ((e && e.message) || e)); }
      return;
    }
    if (Notification.permission === "denied") return;
    pushButton("Turn on notifications", async () => {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { hidePushButton(); return; }
      try {
        const r = await navigator.serviceWorker.ready;
        const sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) });
        await saveSubscription(sub);
        hidePushButton();
      } catch (e) {
        notice("Couldn't turn on notifications: " + ((e && e.message) || e));
        pushButton("Couldn't turn on notifications. Tap to try again", () => setupPush());
      }
    });
  }

  // Called by the Sparks page whenever you do something sweet. Sends a push to the other phone.
  const lastSent = {};
  window.sparksNotify = (entry) => {
    if (!me || !entry || entry.k === "hold") return;
    const gap = entry.k === "spark" ? 60e3 : 8e3;
    const now = Date.now();
    if (now - (lastSent[entry.k] || 0) < gap) return;
    lastSent[entry.k] = now;
    const names = (dbApi && dbApi._cache.get("shared/config")) || {};
    const from = names[me.side] || (me.side === "sj" ? "Baby" : "Sayang");
    const body =
      entry.k === "spark" ? "sent you a spark ✨" :
      entry.k === "note" ? `“${String(entry.text || "").slice(0, 140)}”` :
      entry.k === "fish" ? "fed your penguin a fish 🐟" :
      entry.k === "pat" ? "patted your penguin 🐧" :
      entry.k === "dress" ? "dressed up their penguin 🎀" :
      entry.k === "answer" ? "answered today's question. Your turn!" :
      entry.k === "quiz" ? "finished today's quiz. Your turn!" :
      entry.k === "meet" ? "set the date for your next meet-up 💗" :
      "is thinking of you";
    const other = names[me.side === "sj" ? "pg" : "sj"] || (me.side === "sj" ? "Sayang" : "Baby");
    sb.functions.invoke("notify", { body: { title: from, body } }).then(async ({ data, error }) => {
      if (error) {
        let detail = error.message || "unknown error";
        try { if (error.context && error.context.status) detail = `${error.context.status} ${(await error.context.text()).slice(0, 120)}`; } catch {}
        notice("Notification didn't send (" + detail + ")");
      } else if (data && data.sent === 0) {
        notice(`Notification not delivered: ${other}'s phone hasn't turned on notifications yet.`);
      }
    }).catch((e) => notice("Notification didn't send (" + ((e && e.message) || e) + ")"));
  };

  start();
})();
