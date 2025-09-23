import express from "express";
import {  contributeToGoal, utilizeGoal, getGoals, createGoal, updateGoalStatus } from "../controllers/savingGoalController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = express.Router();
router.use(validateToken);

router.route("/").post(createGoal).get(getGoals); // create new goal and getgoals
router.post("/contribute", contributeToGoal);    // contribute money
router.post("/utilize", utilizeGoal);           // use money from goal
router.patch("/status", updateGoalStatus);        

export default router;
