import { Router } from "express";
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getAccountUsage,
  getAccountTransactions,
} from "../controllers/accountController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = Router();
router.use(validateToken);

router.route("/").get(listAccounts).post(createAccount);
router.get("/:id/usage", getAccountUsage);
router.get("/:id/transactions", getAccountTransactions);
router.route("/:id").put(updateAccount).delete(deleteAccount);

export default router;
