const jwt = require("jsonwebtoken");
const config = require("../config/env");

function signToken(user) {
  // Keep the token payload small — id + role are all any middleware
  // needs; everything else is fetched fresh from the DB per request
  // so a role change takes effect without waiting for token expiry.
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret); // throws if invalid/expired
}

module.exports = { signToken, verifyToken };
