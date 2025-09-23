// src/routes/dashboardRoutes.js
import express from "express";
import { getDashboard } from "../controllers/dashboardController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = express.Router();
router.use(validateToken);

router.route("/").get(getDashboard);

export default router;
