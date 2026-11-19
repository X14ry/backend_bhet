const router = require("express").Router();
const { z } = require("zod");
const { query, transaction } = require("../db");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const { badRequest, notFound, forbidden } = require("../utils/httpError");
const { pairOrder, isBlockedEitherWay } = require("../utils/helpers");

const idParam = z.object({ userId: z.coerce.number().int().positive() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

async function requireOwnProfile(userId, conn) {
  const rows = await query(
    "SELECT intention, broad_area, display_name FROM profiles WHERE user_id = ?",
    [userId],
    conn,
  );
  if (!rows.length)
    throw badRequest("Complete your profile before using discovery");
  return rows[0];
}

/**
 * GET /api/discover
 * Returns profile cards. Each card says WHY it is shown (shared interests + area),
 * and only the broad area is ever exposed - never exact location.
 */
router.get(
  "/",
  validate(listQuery, "query"),
  asyncHandler(async (req, res) => {
    const me = req.user.id;
    const mine = await requireOwnProfile(me);
    const prefRows = await query(
      "SELECT * FROM discovery_preferences WHERE user_id = ?",
      [me],
    );
    const pref = prefRows[0];

    if (pref.is_paused) {
      return res.json({
        paused: true,
        profiles: [],
        message: "Discovery is paused. Turn it off to see people.",
      });
    }

    const rows = await query(
      `SELECT u.id, p.display_name, p.short_bio, p.photo_url, p.intention, p.broad_area,
            TIMESTAMPDIFF(YEAR, u.date_of_birth, CURDATE()) AS age,
            (SELECT COUNT(*) FROM user_interests a
               JOIN user_interests b ON b.interest_id = a.interest_id AND b.user_id = ?
              WHERE a.user_id = u.id) AS shared_count,
            (SELECT GROUP_CONCAT(i.name ORDER BY i.name SEPARATOR ',') FROM user_interests a
               JOIN user_interests b ON b.interest_id = a.interest_id AND b.user_id = ?
               JOIN interests i ON i.id = a.interest_id
              WHERE a.user_id = u.id) AS shared_interests
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       JOIN discovery_preferences dp ON dp.user_id = u.id
      WHERE u.id <> ?
        AND u.status = 'active'
        AND dp.is_paused = 0
        AND p.intention = ?
        AND (? IS NULL OR p.broad_area = ?)
        AND TIMESTAMPDIFF(YEAR, u.date_of_birth, CURDATE()) BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM blocks b
                         WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                            OR (b.blocker_id = u.id AND b.blocked_id = ?))
        AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.from_user_id = ? AND l.to_user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM connections c
                         WHERE c.user_one_id = LEAST(u.id, ?) AND c.user_two_id = GREATEST(u.id, ?))
      ORDER BY shared_count DESC, u.id ASC
      LIMIT ?`,
      [
        me,
        me,
        me,
        mine.intention,
        pref.broad_area,
        pref.broad_area,
        pref.min_age,
        pref.max_age,
        me,
        me,
        me,
        me,
        me,
        req.validatedQuery.limit,
      ],
    );

    const profiles = rows.map((r) => {
      const shared = r.shared_interests ? r.shared_interests.split(",") : [];
      return {
        id: r.id,
        displayName: r.display_name,
        age: r.age,
        shortBio: r.short_bio,
        photoUrl: r.photo_url,
        intention: r.intention,
        broadArea: r.broad_area,
        sharedInterests: shared,
        whyShown: shared.length
          ? `Shared interests (${shared.join(", ")}) in your area`
          : `Looking for ${r.intention} in ${r.broad_area}`,
      };
    });
    res.json({ paused: false, profiles });
  }),
);

/** Shared logic for like / pass */
async function decide(req, res, action) {
  const me = req.user.id;
  const target = req.params.userId;
  if (Number(target) === me)
    throw badRequest("You cannot act on your own profile");

  const result = await transaction(async (conn) => {
    const mine = await requireOwnProfile(me, conn);
    const t = await query(
      `SELECT u.id, u.status, p.intention, p.display_name FROM users u
         JOIN profiles p ON p.user_id = u.id WHERE u.id = ? FOR UPDATE`,
      [target],
      conn,
    );
    if (!t.length || t[0].status !== "active")
      throw notFound("Profile not found");
    if (await isBlockedEitherWay(me, target, conn))
      throw notFound("Profile not found");
    const [lo, hi] = pairOrder(me, target);
    const existing = await query(
      "SELECT id FROM connections WHERE user_one_id = ? AND user_two_id = ?",
      [lo, hi],
      conn,
    );
    if (existing.length)
      throw badRequest("You already have a connection with this person");
    if (t[0].intention !== mine.intention) {
      throw forbidden(
        "You can only respond to profiles with the same connection intention",
      );
    }

    await conn.query(
      `INSERT INTO likes (from_user_id, to_user_id, action) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE action = VALUES(action)`,
      [me, target, action],
    );

    if (action !== "like") return { mutual: false };

    const back = await query(
      `SELECT 1 FROM likes WHERE from_user_id = ? AND to_user_id = ? AND action = 'like'`,
      [target, me],
      conn,
    );
    if (!back.length) return { mutual: false };

    const shared = await query(
      `SELECT i.name FROM user_interests a
         JOIN user_interests b ON b.interest_id = a.interest_id AND b.user_id = ?
         JOIN interests i ON i.id = a.interest_id WHERE a.user_id = ? ORDER BY i.name`,
      [me, target],
      conn,
    );
    const summary = shared.length
      ? `You both share an interest in ${shared.map((s) => s.name).join(", ")}`
      : `You both chose ${mine.intention}`;

    const [a, b] = pairOrder(me, target);
    await conn.query(
      `INSERT INTO connections (user_one_id, user_two_id, intention, shared_summary)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = 'active', ended_by = NULL, shared_summary = VALUES(shared_summary)`,
      [a, b, mine.intention, summary],
    );
    const conn2 = await query(
      "SELECT id FROM connections WHERE user_one_id = ? AND user_two_id = ?",
      [a, b],
      conn,
    );
    return {
      mutual: true,
      connectionId: conn2[0].id,
      summary,
      matchedWith: t[0].display_name,
    };
  });

  res.json(result);
}

router.post(
  "/:userId/like",
  validate(idParam, "params"),
  asyncHandler((req, res) => decide(req, res, "like")),
);
router.post(
  "/:userId/pass",
  validate(idParam, "params"),
  asyncHandler((req, res) => decide(req, res, "pass")),
);

module.exports = router;
