const express = require("express");
const {
  loginUser,
  registerUser,
  currentUser,
} = require("../controllers/userController");
const validateToken = require("../middleware/validateTokenHandler");
const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/currentUser", validateToken, currentUser);

module.exports = router;
