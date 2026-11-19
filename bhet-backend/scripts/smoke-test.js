// End-to-end check of the API. Requires the server to be running and the DB seeded:
//   npm run db:reset && npm start      (in one terminal)
//   npm run test:smoke                 (in another)
const BASE = process.env.API_URL || "http://localhost:3000";
let passed = 0,
  failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* no body */
  }
  return { status: res.status, data };
}
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`, extra ? JSON.stringify(extra) : "");
  }
}
const login = async (email) =>
  (
    await call("POST", "/api/auth/login", {
      body: { email, password: "Demo12345" },
    })
  ).data.token;

(async () => {
  const stamp = Date.now();
  console.log("Health & auth");
  check("health ok", (await call("GET", "/health")).status === 200);
  check("no token -> 401", (await call("GET", "/api/profile")).status === 401);
  check(
    "under-18 rejected",
    (
      await call("POST", "/api/auth/register", {
        body: {
          email: `kid${stamp}@x.test`,
          password: "Passw0rdX",
          dateOfBirth: "2015-01-01",
          confirmAdult: true,
        },
      })
    ).status === 403,
  );
  check(
    "weak password rejected",
    (
      await call("POST", "/api/auth/register", {
        body: {
          email: `w${stamp}@x.test`,
          password: "short",
          dateOfBirth: "2000-01-01",
          confirmAdult: true,
        },
      })
    ).status === 400,
  );
  check(
    "adult confirmation required",
    (
      await call("POST", "/api/auth/register", {
        body: {
          email: `n${stamp}@x.test`,
          password: "Passw0rd1",
          dateOfBirth: "2000-01-01",
          confirmAdult: false,
        },
      })
    ).status === 400,
  );
  check(
    "wrong password -> 401",
    (
      await call("POST", "/api/auth/login", {
        body: { email: "mina@bhet.test", password: "nope" },
      })
    ).status === 401,
  );

  const reg = await call("POST", "/api/auth/register", {
    body: {
      email: `new${stamp}@x.test`,
      password: "Passw0rd1",
      dateOfBirth: "2001-04-04",
      confirmAdult: true,
    },
  });
  check("register works", reg.status === 201 && !!reg.data.token, reg.data);
  check(
    "duplicate email -> 409",
    (
      await call("POST", "/api/auth/register", {
        body: {
          email: `new${stamp}@x.test`,
          password: "Passw0rd1",
          dateOfBirth: "2001-04-04",
          confirmAdult: true,
        },
      })
    ).status === 409,
  );
  const newTok = reg.data.token;

  console.log("Onboarding (profile, interests, preferences)");
  check(
    "discover blocked before profile",
    (await call("GET", "/api/discover", { token: newTok })).status === 400,
  );
  const ints = (await call("GET", "/api/interests", { token: newTok })).data
    .interests;
  check("interests list", ints.length >= 10);
  const put = await call("PUT", "/api/profile", {
    token: newTok,
    body: {
      displayName: "Tester",
      intention: "friendship",
      broadArea: "Kathmandu Valley",
      shortBio: "hello",
    },
  });
  check(
    "profile saved",
    put.status === 200 && put.data.profile.intention === "friendship",
    put.data,
  );
  const hiking = ints.find((i) => i.name === "Hiking").id,
    music = ints.find((i) => i.name === "Music").id;
  const pi = await call("PUT", "/api/profile/interests", {
    token: newTok,
    body: { interestIds: [hiking, music] },
  });
  check(
    "interests saved",
    pi.status === 200 && pi.data.profile.interests.length === 2,
    pi.data,
  );
  check(
    "bad interest id rejected",
    (
      await call("PUT", "/api/profile/interests", {
        token: newTok,
        body: { interestIds: [99999] },
      })
    ).status === 400,
  );
  check(
    "prefs: min>max rejected",
    (
      await call("PUT", "/api/preferences", {
        token: newTok,
        body: { minAge: 40, maxAge: 20 },
      })
    ).status === 400,
  );
  check(
    "prefs saved",
    (
      await call("PUT", "/api/preferences", {
        token: newTok,
        body: { minAge: 18, maxAge: 40 },
      })
    ).data.preferences.maxAge === 40,
  );

  console.log("Discovery & mutual connection (Mina <-> Sita, friendship)");
  const mina = await login("mina@bhet.test"),
    sita = await login("sita@bhet.test");
  const d = await call("GET", "/api/discover", { token: mina });
  check(
    "discover returns friendship profiles only",
    d.status === 200 &&
      d.data.profiles.length > 0 &&
      d.data.profiles.every((p) => p.intention === "friendship"),
    d.data,
  );
  const sitaCard = d.data.profiles.find((p) => p.displayName === "Sita");
  check(
    "card explains why shown",
    sitaCard && /Hiking/.test(sitaCard.whyShown),
    sitaCard,
  );
  check(
    "card has no exact location fields",
    sitaCard &&
      !("latitude" in sitaCard) &&
      sitaCard.broadArea === "Kathmandu Valley",
  );
  check(
    "dating profile not shown to friendship user",
    !d.data.profiles.some((p) => p.displayName === "Aarav"),
  );
  const like1 = await call("POST", `/api/discover/${sitaCard.id}/like`, {
    token: mina,
  });
  check(
    "first like not mutual",
    like1.status === 200 && like1.data.mutual === false,
    like1.data,
  );
  const minaId = (await call("GET", "/api/auth/me", { token: mina })).data.user
    .id;
  const like2 = await call("POST", `/api/discover/${minaId}/like`, {
    token: sita,
  });
  check(
    "second like -> mutual connection",
    like2.data.mutual === true && !!like2.data.connectionId,
    like2.data,
  );
  const cid = like2.data.connectionId;
  check(
    "liked profile no longer in discover",
    !(await call("GET", "/api/discover", { token: mina })).data.profiles.some(
      (p) => p.id === sitaCard.id,
    ),
  );
  check(
    "cannot act on other-intention profile",
    (
      await call("POST", `/api/discover/${minaId}/like`, {
        token: await login("aarav@bhet.test"),
      })
    ).status === 403,
  );

  console.log("Chat");
  const sent = await call("POST", `/api/connections/${cid}/messages`, {
    token: mina,
    body: { body: "Which trail do you like?" },
  });
  check("send message", sent.status === 201, sent.data);
  check(
    "empty message rejected",
    (
      await call("POST", `/api/connections/${cid}/messages`, {
        token: mina,
        body: { body: "   " },
      })
    ).status === 400,
  );
  const list = await call("GET", "/api/connections", { token: sita });
  check(
    "connection list shows unread + last message",
    list.data.connections[0].unread_count === 1 &&
      /trail/.test(list.data.connections[0].last_message),
    list.data,
  );
  const msgs = await call("GET", `/api/connections/${cid}/messages`, {
    token: sita,
  });
  check(
    "read messages",
    msgs.data.messages.length === 1 && msgs.data.messages[0].mine === false,
    msgs.data,
  );
  check(
    "stranger cannot read chat",
    (await call("GET", `/api/connections/${cid}/messages`, { token: newTok }))
      .status === 404,
  );

  console.log("Meetup planner & trusted contact");
  const venues = (await call("GET", "/api/venues", { token: mina })).data
    .venues;
  check("public venues listed", venues.length >= 3);
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  check(
    "past time rejected",
    (
      await call("POST", `/api/connections/${cid}/meetups`, {
        token: mina,
        body: {
          venueId: venues[0].id,
          scheduledAt: new Date(Date.now() - 1000).toISOString(),
        },
      })
    ).status === 400,
  );
  check(
    "share without trusted contact rejected",
    (
      await call("POST", `/api/connections/${cid}/meetups`, {
        token: mina,
        body: {
          venueId: venues[0].id,
          scheduledAt: future,
          shareWithTrustedContact: true,
        },
      })
    ).status === 400,
  );
  const tc = await call("POST", "/api/safety/trusted-contacts", {
    token: mina,
    body: { name: "Aama", phone: "9800000000" },
  });
  check("add trusted contact", tc.status === 201, tc.data);
  check(
    "trusted contact needs phone or email",
    (
      await call("POST", "/api/safety/trusted-contacts", {
        token: mina,
        body: { name: "X" },
      })
    ).status === 400,
  );
  const plan = await call("POST", `/api/connections/${cid}/meetups`, {
    token: mina,
    body: {
      venueId: venues[0].id,
      scheduledAt: future,
      shareWithTrustedContact: true,
    },
  });
  check(
    "meetup proposed at public venue",
    plan.status === 201 &&
      plan.data.meetup.venue_name === venues[0].name &&
      plan.data.meetup.shared_with_trusted_contact === 1,
    plan.data,
  );
  check(
    "proposer cannot accept own plan",
    (
      await call("PATCH", `/api/meetups/${plan.data.meetup.id}`, {
        token: mina,
        body: { status: "accepted" },
      })
    ).status === 403,
  );
  const acc = await call("PATCH", `/api/meetups/${plan.data.meetup.id}`, {
    token: sita,
    body: { status: "accepted" },
  });
  check(
    "other person accepts",
    acc.data.meetup.status === "accepted",
    acc.data,
  );

  console.log("Unmatch, block, report (Aarav & Priya, dating)");
  const aarav = await login("aarav@bhet.test"),
    priya = await login("priya@bhet.test");
  const aaravId = (await call("GET", "/api/auth/me", { token: aarav })).data
    .user.id;
  const priyaId = (await call("GET", "/api/auth/me", { token: priya })).data
    .user.id;
  await call("POST", `/api/discover/${priyaId}/like`, { token: aarav });
  const m2 = await call("POST", `/api/discover/${aaravId}/like`, {
    token: priya,
  });
  check("dating mutual connection", m2.data.mutual === true, m2.data);
  const rep = await call("POST", "/api/safety/reports", {
    token: aarav,
    body: {
      reportedUserId: priyaId,
      connectionId: m2.data.connectionId,
      reason: "harassment",
      details: "Asked for exact location",
      alsoBlock: true,
    },
  });
  check(
    "report + block in one step",
    rep.status === 201 && rep.data.blocked === true,
    rep.data,
  );
  check(
    "chat closed after block",
    (
      await call("POST", `/api/connections/${m2.data.connectionId}/messages`, {
        token: aarav,
        body: { body: "hi" },
      })
    ).status === 403,
  );
  check(
    "blocked user cannot message either",
    (
      await call("POST", `/api/connections/${m2.data.connectionId}/messages`, {
        token: priya,
        body: { body: "hi" },
      })
    ).status === 403,
  );
  check(
    "blocked list",
    (await call("GET", "/api/safety/blocks", { token: aarav })).data.blocked
      .length === 1,
  );
  check(
    "blocked user hidden from discover",
    !(await call("GET", "/api/discover", { token: priya })).data.profiles.some(
      (p) => p.id === aaravId,
    ),
  );
  check(
    "cannot block self",
    (await call("POST", `/api/safety/blocks/${aaravId}`, { token: aarav }))
      .status === 400,
  );

  const um = await call("POST", `/api/connections/${cid}/unmatch`, {
    token: sita,
  });
  check("unmatch closes chat", um.status === 200);
  check(
    "cannot message after unmatch",
    (
      await call("POST", `/api/connections/${cid}/messages`, {
        token: mina,
        body: { body: "hi" },
      })
    ).status === 403,
  );
  check(
    "cannot re-like after unmatch",
    (await call("POST", `/api/discover/${minaId}/like`, { token: sita }))
      .status === 400,
  );

  console.log("Pause discovery, admin, account deletion");
  await call("PUT", "/api/preferences", {
    token: mina,
    body: { isPaused: true },
  });
  check(
    "paused user sees no one",
    (await call("GET", "/api/discover", { token: mina })).data.paused === true,
  );
  const rohan = await login("rohan@bhet.test");
  check(
    "paused user hidden from others",
    !(await call("GET", "/api/discover", { token: rohan })).data.profiles.some(
      (p) => p.id === minaId,
    ),
  );
  check(
    "normal user cannot open admin",
    (await call("GET", "/api/admin/reports", { token: mina })).status === 403,
  );
  const admin = await login("admin@bhet.test");
  const reports = await call("GET", "/api/admin/reports?status=open", {
    token: admin,
  });
  check(
    "admin sees report",
    reports.status === 200 && reports.data.reports.length >= 1,
    reports.data,
  );
  check(
    "admin updates report",
    (
      await call("PATCH", `/api/admin/reports/${reports.data.reports[0].id}`, {
        token: admin,
        body: { status: "reviewing" },
      })
    ).status === 200,
  );
  check(
    "delete account needs correct password",
    (
      await call("DELETE", "/api/auth/account", {
        token: newTok,
        body: { password: "wrong" },
      })
    ).status === 400,
  );
  check(
    "delete account",
    (
      await call("DELETE", "/api/auth/account", {
        token: newTok,
        body: { password: "Passw0rd1" },
      })
    ).status === 204,
  );
  check(
    "deleted account token rejected",
    (await call("GET", "/api/profile", { token: newTok })).status === 401,
  );
  check(
    "unknown route -> 404",
    (await call("GET", "/api/nope", { token: mina })).status === 404,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
