import { GoogleGenAI, Type } from "@google/genai";
import { Case, Suspect, Message } from "../types";

/**
 * Multi-Key Rotation System
 * Collects all keys from environment variables (GEMINI_API_KEY, GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.)
 */
const getApiKeys = (): string[] => {
  const keys: string[] = [];
  
  // 1. Standard platform key (injected by AI Studio)
  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }

  // 2. Custom keys from import.meta.env (must be prefixed with VITE_)
  // We check for VITE_GEMINI_API_KEY_1, VITE_GEMINI_API_KEY_2, etc.
  const env = (import.meta as any).env || {};
  for (let i = 1; i <= 20; i++) {
    const key = env[`VITE_GEMINI_API_KEY_${i}`];
    if (key) {
      keys.push(key);
    }
  }
  
  // Remove duplicates and empty strings
  const uniqueKeys = Array.from(new Set(keys.filter(k => k && k.trim() !== "")));
  console.log(`Detected ${uniqueKeys.length} API keys for rotation.`);
  return uniqueKeys;
};

let apiKeys = getApiKeys();
let currentKeyIndex = 0;

/**
 * Helper to get the current AI instance or rotate to the next one
 */
const getAiInstance = (rotate = false) => {
  if (apiKeys.length === 0) {
    // Fallback if no keys are found (shouldn't happen if GEMINI_API_KEY is set)
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  if (rotate) {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`Rotating to API Key #${currentKeyIndex + 1}/${apiKeys.length}`);
  }

  return new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
};

/**
 * Helper to handle API calls with exponential backoff and key rotation for 429 errors
 */
async function callWithRetry<T>(fn: (ai: GoogleGenAI) => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: any;
  let ai = getAiInstance();

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn(ai);
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || "";
      const isRateLimit = errorMsg.includes('429') || error.status === 429 || errorMsg.includes('Quota exceeded');

      if (isRateLimit) {
        // If we have multiple keys, rotate immediately
        if (apiKeys.length > 1) {
          console.warn(`Rate limit hit on Key #${currentKeyIndex + 1}. Rotating...`);
          ai = getAiInstance(true);
          // Small delay before retry with new key
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }

        // If only one key, use exponential backoff
        const waitTime = Math.pow(2, i) * 2000 + Math.random() * 1000;
        console.warn(`Rate limit hit (Single Key). Retrying in ${Math.round(waitTime)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const generateCase = async (): Promise<Case> => {
  return callWithRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Generate a detailed criminal case (Murder, Kidnapping, Theft, or Fraud) for an AI Detective game set in India. Use Indian names (e.g., Rajesh, Priya, Vikram), Indian locations (e.g., Mumbai, Delhi, Bangalore), and Indian cultural contexts. The language should be Indian English (using terms like 'yaar', 'beta', 'ji', 'sir/madam', and typical Indian sentence structures). Include a title, type (e.g., 'Murder Investigation'), description (a narrative of what happened), victim, crime scene, time, cause of death (or method of crime), 3 initial clues, a 'worldContext' (defining common facts like names of household staff, layout of the house, and relationships to ensure all suspects agree on these details), a list of 3-4 'evidence' items (e.g., 'Forensic Report: Toxin found in tea', 'Phone Logs: No calls made between 10-11 PM'), 4 suspects (one is the culprit), and a hidden solution. Each suspect should have a name, description, personality, motive, alibi, secret, age, occupation, and 3 personality traits.",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            type: { type: Type.STRING },
            description: { type: Type.STRING },
            victim: { type: Type.STRING },
            crimeScene: { type: Type.STRING },
            timeOfCrime: { type: Type.STRING },
            causeOfDeath: { type: Type.STRING },
            initialClues: { type: Type.ARRAY, items: { type: Type.STRING } },
            worldContext: { type: Type.STRING },
            evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
            suspects: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  personality: { type: Type.STRING },
                  motive: { type: Type.STRING },
                  alibi: { type: Type.STRING },
                  isCulprit: { type: Type.BOOLEAN },
                  secret: { type: Type.STRING },
                  age: { type: Type.STRING },
                  occupation: { type: Type.STRING },
                  traits: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["id", "name", "description", "personality", "motive", "alibi", "isCulprit", "secret", "age", "occupation", "traits"]
              }
            },
            solution: { type: Type.STRING }
          },
          required: ["title", "type", "description", "victim", "crimeScene", "timeOfCrime", "causeOfDeath", "initialClues", "worldContext", "evidence", "suspects", "solution"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  });
};

export const interrogateSuspect = async (
  suspect: Suspect,
  caseInfo: Case,
  history: Message[],
  userInput: string
): Promise<string> => {
  return callWithRetry(async (ai) => {
    const systemInstruction = `
      You are ${suspect.name}, a suspect in a murder mystery set in India.
      Case Context:
      - Victim: ${caseInfo.victim}
      - Crime Scene: ${caseInfo.crimeScene}
      - Cause of Death: ${caseInfo.causeOfDeath}
      - World Context (Common Facts): ${caseInfo.worldContext}
      - Your Personality: ${suspect.personality}
      - Your Motive: ${suspect.motive}
      - Your Alibi: ${suspect.alibi}
      - Your Secret: ${suspect.secret}
      - Are you the culprit? ${suspect.isCulprit ? "YES" : "NO"}

      Rules:
      1. Stay in character. Use Indian English (e.g., "Listen ji", "I am telling you na", "What to do?", "Arre baba").
      2. Do not admit you are an AI.
      3. Do not confess immediately unless the detective presents overwhelming evidence or catches you in a direct lie about your secret/alibi.
      4. Be evasive if you are the culprit. If innocent, be helpful but maybe defensive or annoyed.
      5. Use your personality traits in your speech.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
        { role: "user", parts: [{ text: userInput }] }
      ],
      config: {
        systemInstruction
      }
    });

    return response.text || "I have nothing to say to you, detective.";
  });
};

export const evaluateAccusation = async (
  caseInfo: Case,
  notes: string,
  accusedSuspectId: string,
  reasoning: string
): Promise<{ isCorrect: boolean; feedback: string; score: number }> => {
  return callWithRetry(async (ai) => {
    const accusedSuspect = caseInfo.suspects.find(s => s.id === accusedSuspectId);
    const isCorrect = accusedSuspect?.isCulprit || false;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        As the Chief Inspector (an experienced Indian Police Officer), evaluate the detective's accusation. Use Indian English and a professional yet firm tone.
        Case: ${caseInfo.title}
        The real culprit was: ${caseInfo.suspects.find(s => s.isCulprit)?.name}
        The detective accused: ${accusedSuspect?.name}
        Detective's reasoning: ${reasoning}
        Detective's investigation notes: ${notes}

        IMPORTANT: You must ONLY base your evaluation on the information provided in the case file below. Do NOT hallucinate evidence that was not explicitly given to the player.
        Case File Data:
        - Victim: ${caseInfo.victim}
        - Crime Scene: ${caseInfo.crimeScene}
        - Time: ${caseInfo.timeOfCrime}
        - Cause: ${caseInfo.causeOfDeath}
        - Initial Clues: ${caseInfo.initialClues.join(', ')}
        - World Context: ${caseInfo.worldContext}
        - Evidence Available to Player: ${caseInfo.evidence.join(', ')}
        - Suspect Details: ${caseInfo.suspects.map(s => `${s.name} (${s.occupation}): Motive=${s.motive}, Alibi=${s.alibi}, Secret=${s.secret}`).join(' | ')}

        If the detective is WRONG (accused the wrong person):
        1. Explain why their reasoning for accusing ${accusedSuspect?.name} was flawed.
        2. Explicitly state which specific clues, contradictions, or details from the case (like the suspects' secrets, alibis, or the initial clues) should have led them to ${caseInfo.suspects.find(s => s.isCulprit)?.name}.
        3. Be firm but constructive, like a senior officer teaching a junior.

        If the detective is RIGHT:
        1. Commend their sharp observation.
        2. Mention the key pieces of evidence they correctly identified.

        Provide a score (0-100) and detailed feedback.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            feedback: { type: Type.STRING },
            score: { type: Type.NUMBER }
          },
          required: ["feedback", "score"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return {
      isCorrect,
      feedback: result.feedback,
      score: result.score
    };
  });
};
