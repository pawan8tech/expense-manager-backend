import { Router } from "express";
import {
  listBills,
  createBill,
  updateBill,
  deleteBill,
  payBill,
} from "../controllers/billController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = Router();
router.use(validateToken);

router.route("/").get(listBills).post(createBill);
router.post("/:id/pay", payBill);
router.route("/:id").put(updateBill).delete(deleteBill);

export default router;
