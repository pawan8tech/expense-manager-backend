/**
 * Savings Goal Routes
 * 
 * API endpoints for managing savings goals and contributions.
 */
import express from "express";
import {
  createGoal,
  getGoals,
  getGoalById,
  updateGoal,
  updateGoalStatus,
  deleteGoal,
  contributeToGoal,
  withdrawFromGoal,
  getContributions,
  deleteContribution
} from "../controllers/savingGoalController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = express.Router();
router.use(validateToken);

// ===================================
// Goal Routes
// ===================================

// GET /api/savings-goals - Get all goals with summary
// POST /api/savings-goals - Create a new goal
router.route("/")
  .get(getGoals)
  .post(createGoal);

// GET /api/savings-goals/:id - Get a single goal with contributions
// PUT /api/savings-goals/:id - Update goal details
// DELETE /api/savings-goals/:id - Delete goal and its contributions
router.route("/:id")
  .get(getGoalById)
  .put(updateGoal)
  .delete(deleteGoal);

// PATCH /api/savings-goals/:id/status - Update goal status
router.patch("/:id/status", updateGoalStatus);

// ===================================
// Contribution Routes
// ===================================

// POST /api/savings-goals/:id/contribute - Add a deposit contribution
router.post("/:id/contribute", contributeToGoal);

// POST /api/savings-goals/:id/withdraw - Withdraw from savings
router.post("/:id/withdraw", withdrawFromGoal);

// GET /api/savings-goals/:id/contributions - Get all contributions for a goal
router.get("/:id/contributions", getContributions);

// DELETE /api/savings-goals/:goalId/contributions/:contributionId - Delete a contribution
router.delete("/:goalId/contributions/:contributionId", deleteContribution);

// ===================================
// Legacy Routes (backward compatibility)
// ===================================
router.post("/contribute", contributeToGoal);  // Legacy: POST /api/savings-goals/contribute
router.post("/utilize", withdrawFromGoal);     // Legacy: POST /api/savings-goals/utilize
router.patch("/status", updateGoalStatus);     // Legacy: PATCH /api/savings-goals/status

export default router;
