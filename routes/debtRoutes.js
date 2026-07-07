import { Router } from "express";
import {
  listDebts,
  createDebt,
  payEmi,
  getEmiSplit,
  updateDebt,
  deleteDebt,
} from "../controllers/debtController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = Router();
router.use(validateToken);

router.route("/").get(listDebts).post(createDebt);
router.get("/:id/split", getEmiSplit);
router.post("/:id/pay", payEmi);
router.route("/:id").put(updateDebt).delete(deleteDebt);

export default router;
