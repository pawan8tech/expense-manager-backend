// routes/budgetRoutes.js
import express from "express";
import {
  getBudgets,
  updateBudget,
  deleteBudget,
  addBudget,
} from "../controllers/budgetController.js";

import validateToken from "../middleware/validateTokenHandler.js";

const router = express.Router();
router.use(validateToken);

router.route("/").get(getBudgets).post(addBudget);
router.route("/:id").put(updateBudget).delete(deleteBudget);

export default router; 


