import { Router } from "express";
import {
  listLendings,
  createLending,
  addLendingEntry,
  getLendingHistory,
  updateLending,
  deleteLending,
} from "../controllers/lendingController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = Router();
router.use(validateToken);

router.route("/").get(listLendings).post(createLending);
router.post("/:id/entry", addLendingEntry);
router.get("/:id/history", getLendingHistory);
router.route("/:id").put(updateLending).delete(deleteLending);

export default router;
