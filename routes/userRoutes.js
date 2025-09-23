import { Router } from "express";
import { loginUser, registerUser, currentUser } from "../controllers/userController.js";
import validateToken from "../middleware/validateTokenHandler.js";
const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/currentUser", validateToken, currentUser);

export default router;
