import asyncHandler from "express-async-handler";
import pkg from "jsonwebtoken";
const { verify } = pkg;

const validateToken = asyncHandler(async (req, res, next) => {
  let token;
  let authHeader = req.headers.Authorization || req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer")) {
    token = authHeader.split(" ")[1];
    verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        res.status(401);
        throw new Error("User is not Authorized");
      }
      req.user = decoded.user;
      next();
    });
    if (!token) {
      res.status(401);
      throw new Error("Missing Token or User is not Authorized");
    }
  }
});

export default validateToken;
