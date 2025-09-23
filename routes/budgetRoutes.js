// routes/budgetRoutes.js
import express from "express";
import {
  getBudgets,
  getBudgetById,
  updateBudget,
  deleteBudget,
  addBudget,
} from "../controllers/budgetController.js";

import validateToken from "../middleware/validateTokenHandler.js";

const router = express.Router();
router.use(validateToken);

router.route("/").get(getBudgets).post(addBudget);
router.route("/:id").get(getBudgetById).put(updateBudget).delete(deleteBudget);

export default router; 


