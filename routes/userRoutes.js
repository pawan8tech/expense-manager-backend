import { Router } from "express";
import {
  loginUser,
  registerUser,
  refreshTokenController,
  currentUser,
  logoutUser,
} from "../controllers/userController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/refresh", refreshTokenController);
router.post("/logout", logoutUser);
router.get("/currentUser", validateToken, currentUser);

export default router;
