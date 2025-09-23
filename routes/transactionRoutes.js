// src/routes/transactionRoutes.js
import { Router } from "express";
const router = Router();
import {  getTransactions, getTransaction, updateTransaction, deleteTransaction, addTransaction } from "../controllers/transactionController.js";

import validateToken from "../middleware/validateTokenHandler.js";
router.use(validateToken);

router.route('/').get(getTransactions).post(addTransaction)
router.route('/:id').get(getTransaction).put(updateTransaction).delete(deleteTransaction)

export default router;