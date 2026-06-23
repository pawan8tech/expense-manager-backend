import Groq from "groq-sdk";
import https from "https";
import dotenv from "dotenv";

dotenv.config();

// Create custom HTTPS agent to bypass SSL certificate issues
// (Common in corporate/proxy environments)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // Bypass SSL verification for development
});

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  httpAgent: httpsAgent,
});
