const { query } = require("../db");
const { notFound, forbidden } = require("./httpError");

const pairOrder = (a, b) =>
  Number(a) < Number(b) ? [Number(a), Number(b)] : [Number(b), Number(a)];

/** True if either user has blocked the other. */
async function isBlockedEitherWay(a, b, conn) {
  const rows = await query(
    `SELECT 1 FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`,
    [a, b, b, a],
    conn,
  );
  return rows.length > 0;
}

/**
 * Load a connection the user belongs to. Returns 404 if it does not exist or the
 * user is not a member (so IDs of other people's chats are never revealed).
 */
async function getMemberConnection(
  connectionId,
  userId,
  conn,
  { requireActive = true } = {},
) {
  const rows = await query(
    `SELECT * FROM connections WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)`,
    [connectionId, userId, userId],
    conn,
  );
  if (!rows.length) throw notFound("Connection not found");
  const c = rows[0];
  if (requireActive && c.status !== "active")
    throw forbidden("This connection is no longer active");
  c.other_user_id =
    c.user_one_id === Number(userId) ? c.user_two_id : c.user_one_id;
  return c;
}

module.exports = { pairOrder, isBlockedEitherWay, getMemberConnection };
