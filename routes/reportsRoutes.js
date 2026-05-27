import express from "express";
import { getReports } from "../controllers/reportsController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = express.Router();
router.use(validateToken);

router.get("/", getReports);

export default router;
