const router = require("express").Router();
const { z } = require("zod");
const { query, transaction } = require("../db");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const { badRequest, notFound } = require("../utils/httpError");
const { pairOrder } = require("../utils/helpers");

const userIdParam = z.object({ userId: z.coerce.number().int().positive() });
const idParam = z.object({ id: z.coerce.number().int().positive() });

const reportSchema = z.object({
  reportedUserId: z.number().int().positive(),
  connectionId: z.number().int().positive().optional(),
  reason: z.enum([
    "harassment",
    "fake_profile",
    "unsafe_behaviour",
    "spam",
    "other",
  ]),
  details: z.string().trim().max(1000).optional(),
  alsoBlock: z.boolean().default(false),
});

const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(5).max(30).optional(),
    email: z.string().trim().email().max(255).optional(),
  })
  .refine((d) => d.phone || d.email, {
    message: "Provide a phone number or an email",
    path: ["phone"],
  });

/** Block a user and close any shared connection (one tap in the app). */
async function applyBlock(conn, me, target) {
  await conn.query(
    "INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)",
    [me, target],
  );
  const [a, b] = pairOrder(me, target);
  await conn.query(
    `UPDATE connections SET status = 'blocked', ended_by = ? WHERE user_one_id = ? AND user_two_id = ?`,
    [me, a, b],
  );
  await conn.query(
    `UPDATE meetup_plans mp JOIN connections c ON c.id = mp.connection_id
        SET mp.status = 'cancelled'
      WHERE c.user_one_id = ? AND c.user_two_id = ? AND mp.status IN ('proposed','accepted')`,
    [a, b],
  );
}

async function requireUser(id) {
  const rows = await query("SELECT id FROM users WHERE id = ?", [id]);
  if (!rows.length) throw notFound("User not found");
}

// ------------------------------------------------------------ blocks
router.get(
  "/blocks",
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT b.blocked_id AS user_id, p.display_name, b.created_at
       FROM blocks b LEFT JOIN profiles p ON p.user_id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
      [req.user.id],
    );
    res.json({ blocked: rows });
  }),
);

router.post(
  "/blocks/:userId",
  validate(userIdParam, "params"),
  asyncHandler(async (req, res) => {
    if (req.params.userId === req.user.id)
      throw badRequest("You cannot block yourself");
    await requireUser(req.params.userId);
    await transaction((conn) =>
      applyBlock(conn, req.user.id, req.params.userId),
    );
    res.status(201).json({ message: "Blocked. Chat closed." });
  }),
);

router.delete(
  "/blocks/:userId",
  validate(userIdParam, "params"),
  asyncHandler(async (req, res) => {
    await query("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?", [
      req.user.id,
      req.params.userId,
    ]);
    res.status(204).end(); // a closed connection stays closed; users must discover each other again
  }),
);

// ----------------------------------------------------------- reports
router.post(
  "/reports",
  validate(reportSchema),
  asyncHandler(async (req, res) => {
    const { reportedUserId, connectionId, reason, details, alsoBlock } =
      req.body;
    if (reportedUserId === req.user.id)
      throw badRequest("You cannot report yourself");
    await requireUser(reportedUserId);

    if (connectionId) {
      const c = await query(
        `SELECT id FROM connections WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)`,
        [connectionId, req.user.id, req.user.id],
      );
      if (!c.length) throw badRequest("Connection not found");
    }

    const id = await transaction(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO reports (reporter_id, reported_id, connection_id, reason, details) VALUES (?, ?, ?, ?, ?)`,
        [
          req.user.id,
          reportedUserId,
          connectionId ?? null,
          reason,
          details ?? null,
        ],
      );
      if (alsoBlock) await applyBlock(conn, req.user.id, reportedUserId);
      return r.insertId;
    });
    res.status(201).json({
      reportId: id,
      blocked: alsoBlock,
      message:
        "Report sent. The other person is not told that you reported them.",
    });
  }),
);

// ------------------------------------------------- trusted contacts
router.get(
  "/trusted-contacts",
  asyncHandler(async (req, res) => {
    res.json({
      contacts: await query(
        "SELECT id, name, phone, email, created_at FROM trusted_contacts WHERE user_id = ? ORDER BY id",
        [req.user.id],
      ),
    });
  }),
);

router.post(
  "/trusted-contacts",
  validate(contactSchema),
  asyncHandler(async (req, res) => {
    const count = await query(
      "SELECT COUNT(*) AS n FROM trusted_contacts WHERE user_id = ?",
      [req.user.id],
    );
    if (count[0].n >= 5)
      throw badRequest("You can add up to 5 trusted contacts");
    const { name, phone, email } = req.body;
    const [r] = await require("../db").pool.query(
      "INSERT INTO trusted_contacts (user_id, name, phone, email) VALUES (?, ?, ?, ?)",
      [req.user.id, name, phone ?? null, email ?? null],
    );
    res
      .status(201)
      .json({
        contact: {
          id: r.insertId,
          name,
          phone: phone ?? null,
          email: email ?? null,
        },
      });
  }),
);

router.delete(
  "/trusted-contacts/:id",
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const r = await require("../db").pool.query(
      "DELETE FROM trusted_contacts WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id],
    );
    if (!r[0].affectedRows) throw notFound("Trusted contact not found");
    res.status(204).end();
  }),
);

module.exports = router;
