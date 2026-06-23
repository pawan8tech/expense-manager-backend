/**
 * Zod schemas for chat-related data structures
 * 
 * NOTE: AI response validation is now handled directly in aiService.js
 * These schemas are kept for reference and potential future use
 */
import { z } from "zod";

// Conversation draft schema - tracks collected expense data
export const draftSchema = z.object({
  amount: z.number().positive().optional(),
  category: z.string().optional(),
  date: z.string().optional(),
  note: z.string().optional(),
  name: z.string().optional(),
  type: z.enum(["expense", "income"]).optional(),
});

// Conversation state schema
export const conversationStateSchema = z.object({
  conversationId: z.string(),
  intent: z.enum(["ADD_EXPENSE", "ADD_INCOME", "NONE"]).nullable(),
  draft: draftSchema,
  missingFields: z.array(z.string()),
  status: z.enum(["COLLECTING", "READY_TO_CONFIRM", "IDLE"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export default {
  draftSchema,
  conversationStateSchema,
};
