import express from "express";
import {
  addRecurring,
  getRecurring,
  getRecurringById,
  updateRecurring,
  deleteRecurring
} from "../controllers/recurringController.js";
import validateToken from "../middleware/validateTokenHandler.js";
const router = express.Router();

router.use(validateToken); 

router.route("/").post(addRecurring).get(getRecurring);
router.route("/:id").get(getRecurringById).put(updateRecurring).delete(deleteRecurring);

export default router;
