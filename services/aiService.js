import { groq } from "../config/groq.js";
import { z } from "zod";

/**
 * Validation Schema (Prevents AI hallucination)
 */
const AIResponseSchema = z.object({
  intent: z.enum([
    "ADD_EXPENSE",
    "ADD_INCOME",
    "UPDATE_FIELD",
    "CANCEL",
    "CONFIRM",
    "UNKNOWN",
  ]),
  data: z.object({
    amount: z.number().nullable(),
    category: z.string().nullable(),
    date: z.string().nullable(),
    note: z.string().nullable(),
    name: z.string().nullable(),
  }),
});

/**
 * Build the system prompt. When the caller passes the user's own
 * categories we list them so the AI matches against the real backend
 * categories first, and only falls back to inventing a new one when
 * nothing fits.
 */
const buildSystemPrompt = ({ expenseCategories = [], incomeCategories = [] } = {}) => {
  const categoryBlock =
    expenseCategories.length || incomeCategories.length
      ? `
KNOWN CATEGORIES:
- Expense: ${expenseCategories.join(", ") || "(none)"}
- Income: ${incomeCategories.join(", ") || "(none)"}

CATEGORY RULES:
- Pick the best-fitting category from the KNOWN CATEGORIES list above that matches the user's intent (Expense list for expenses, Income list for income).
- Match by meaning, not exact wording (e.g. "lunch", "dinner" -> a food/dining category).
- Use the category name EXACTLY as written in the list.
- Only if nothing in the list reasonably fits, return a short, sensible new category name.
`
      : "";

  return `
You are a personal finance assistant that records both EXPENSES (money spent)
and INCOME (money received).

RULES:
1. Return ONLY valid JSON.
2. No explanation, no extra text.
3. Extract only mentioned fields.
4. Missing fields must be null.

INTENTS:
- ADD_EXPENSE: money going out (spent, paid, bought, ordered, a bill).
- ADD_INCOME: money coming in (earned, received, got paid, salary, refund, bonus, gift, sold something).
- UPDATE_FIELD: user is correcting or changing a field of the current draft.
- CANCEL: user wants to discard the current entry.
- CONFIRM: user agrees to save the current entry.
- UNKNOWN: anything that does not fit the above.

EXAMPLES:
"I spent 500 on groceries" -> ADD_EXPENSE, amount 500, category "Groceries"
"paid 1200 electricity bill" -> ADD_EXPENSE, amount 1200, category "Bills"
"got my salary of 50000" -> ADD_INCOME, amount 50000, category "Salary"
"received 2000 refund from amazon" -> ADD_INCOME, amount 2000, category "Refund"
"earned 8000 from freelance work" -> ADD_INCOME, amount 8000, category "Freelance"
${categoryBlock}
OUTPUT JSON FORMAT:
{
  "intent": "...",
  "data": {
    "type": string|null,
    "amount": number|null,
    "category": string|null,
    "date": string|null,
    "note": string|null,
    "name": string|null
  }
}
`;
};

export async function extractExpenseData(userMessage, categories = {}) {
  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant", // Free + fast model (replaces decommissioned llama3-8b-8192)
      messages: [
        { role: "system", content: buildSystemPrompt(categories) },
        { role: "user", content: userMessage },
      ],
    });

    const rawText = response.choices[0].message.content;

    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    // Parse JSON
    const parsed = JSON.parse(jsonText);
    // Validate output
    return AIResponseSchema.parse(parsed);
  } catch (error) {
    console.error("AI extraction error:", error.message);
    
    // Return a fallback response for connection errors
    if (error.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" || 
        error.message?.includes("Connection error")) {
      console.warn("SSL/Connection error - check network or proxy settings");
    }
    
    throw new Error(`AI extraction failed: ${error.message}`);
  }
}
