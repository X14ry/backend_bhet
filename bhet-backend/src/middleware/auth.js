const jwt = require("jsonwebtoken");
const config = require("../config");
const { query } = require("../db");
const { unauthorized, forbidden } = require("../utils/httpError");
const asyncHandler = require("../utils/asyncHandler");

const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (_) {
    throw unauthorized("Invalid or expired token");
  }

  const rows = await query("SELECT id, role, status FROM users WHERE id = ?", [
    payload.sub,
  ]);
  if (!rows.length) throw unauthorized("Account no longer exists");
  if (rows[0].status !== "active") throw forbidden("Account is suspended");

  req.user = { id: rows[0].id, role: rows[0].role };
  next();
});

const requireRole = (role) => (req, _res, next) =>
  req.user && req.user.role === role ? next() : next(forbidden());

const signToken = (userId) =>
  jwt.sign({ sub: userId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

module.exports = { authenticate, requireRole, signToken };
