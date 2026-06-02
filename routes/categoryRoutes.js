import express from "express";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryUsage,
  reassignCategory,
} from "../controllers/categoryController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = express.Router();
router.use(validateToken);

router.get("/", listCategories);
router.post("/", createCategory);
router.get("/:id/usage", getCategoryUsage);
router.post("/:id/reassign", reassignCategory);
router.patch("/:id", updateCategory);
router.delete("/:id", deleteCategory);

export default router;
