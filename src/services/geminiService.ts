import { GoogleGenAI, Type } from "@google/genai";
import { Case, Suspect, Message } from "../types";

/**
 * Multi-Key Rotation System
 * Fetches keys from the server-side endpoint to ensure they are always up-to-date
 */
let apiKeys: string[] = [];
let currentKeyIndex = 0;
let keysLoaded = false;

const loadApiKeys = async () => {
  if (keysLoaded) return;
  try {
    const res = await fetch('/api/config/keys');
    if (res.ok) {
      const data = await res.json();
      apiKeys = data.keys || [];
      console.log(`Detected ${apiKeys.length} Gemini keys for rotation.`);
      keysLoaded = true;
    }
  } catch (err) {
    console.error("Failed to load API keys from server:", err);
    // Fallback to platform-injected key if fetch fails
    if (process.env.GEMINI_API_KEY) {
      apiKeys = [process.env.GEMINI_API_KEY];
    }
  }
};

/**
 * Helper to get the current AI instance or rotate to the next one
 */
const getAiInstance = async (rotate = false) => {
  await loadApiKeys();
  
  if (apiKeys.length === 0) {
    // Fallback if no keys are found
    return new GoogleGenAI({ apiKey: (process.env as any).GEMINI_API_KEY || "" });
  }

  if (rotate) {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`Rotating to Gemini Key #${currentKeyIndex + 1}/${apiKeys.length}`);
  }

  return new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
};

/**
 * Helper to handle API calls with exponential backoff and key rotation for 429/503 errors
 */
async function callWithRetry<T>(
  fn: (ai: GoogleGenAI) => Promise<T>, 
  maxRetries = 5
): Promise<T> {
  let lastError: any;
  let ai = await getAiInstance();

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn(ai);
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || "";
      const status = error.status || (error as any).code;
      
      // Check for rate limits (429) or server overload (503)
      const isRetryable = 
        errorMsg.includes('429') || 
        errorMsg.includes('503') || 
        status === 429 || 
        status === 503 || 
        errorMsg.includes('Quota exceeded') ||
        errorMsg.includes('high demand') ||
        errorMsg.includes('UNAVAILABLE');

      if (isRetryable) {
        // If we have multiple keys, rotate immediately
        if (apiKeys.length > 1) {
          console.warn(`Gemini issue (${status}) hit on Key #${currentKeyIndex + 1}. Rotating...`);
          ai = await getAiInstance(true);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        // If only one key, use exponential backoff
        const waitTime = Math.pow(2, i) * 3000 + Math.random() * 1000;
        console.warn(`Gemini issue (${status}). Retrying in ${Math.round(waitTime)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

export const generateCase = async (): Promise<Case> => {
  const prompt = `
    Generate a highly detailed and UNIQUE criminal case for an AI Detective game set in India.
    
    VARIETY REQUIREMENTS:
    1. CASE TYPE: Randomly choose from: Murder, High-stakes Art Theft, Corporate Espionage, Kidnapping for Ransom, Cyber Heist, Artifact Smuggling, or Insurance Fraud.
    2. METHOD: If murder, do NOT use Cyanide. Use methods like blunt force, strangulation, rare botanical toxins (e.g., Datura), digital sabotage, or staged accidents. If theft/fraud, describe the complex technical or social engineering method used.
    3. SUSPECTS: Avoid the "family head killed by family members" trope. Use diverse groups: Business rivals, estranged childhood friends, secret society members, disgruntled tech employees, or neighbors with hidden pasts. Ensure suspects have distinct, non-overlapping motives.
    4. NAMES & LOCATIONS: Use authentic Indian names and diverse locations (e.g., a high-tech hub in Hyderabad, a tea estate in Munnar, a bustling market in Chandni Chowk, a luxury cruise off Goa, or a remote Himalayan village).

    INFORMATION CONSISTENCY RULES:
    - ALL critical physical evidence (e.g., a torn note, a specific item left behind, a digital footprint, a misplaced object like a raincoat) MUST be explicitly listed in the 'evidence' or 'initialClues' arrays.
    - The player MUST be able to solve the case using ONLY the facts provided in the case description, clues, evidence, and suspect interrogations.
    - Do NOT leave "hidden" facts that are only revealed at the end. If a piece of evidence is the "smoking gun", it MUST be discoverable in the initial case file or through interrogation.
    - The 'solution' field must explain exactly which pieces of evidence point to the culprit and why the others are exonerated.

    JSON STRUCTURE:
    - title: Catchy name for the case.
    - type: The category of crime.
    - description: A narrative of the crime scene and the event.
    - victim: Name and brief bio.
    - crimeScene: Detailed location description.
    - timeOfCrime: Specific time or window.
    - causeOfDeath: Or "Method of Crime" for non-murder cases.
    - initialClues: 3-4 starting points for the player.
    - worldContext: Common facts that all suspects know (layout, relationships, etc.).
    - evidence: 5-7 specific pieces of evidence found during the initial sweep.
    - suspects: 4 suspects (one is the culprit). Each needs: id, name, description, personality, motive, alibi, secret, age, occupation, traits.
    - solution: A clear explanation of how the evidence points to the culprit.

    Return ONLY valid JSON.
  `;

  return callWithRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
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
  const systemInstruction = `
    You are ${suspect.name}, a suspect in a ${caseInfo.type} case set in India.
    Case Context:
    - Victim: ${caseInfo.victim}
    - Crime Scene: ${caseInfo.crimeScene}
    - Method/Cause: ${caseInfo.causeOfDeath}
    - World Context: ${caseInfo.worldContext}
    - Your Personality: ${suspect.personality}
    - Your Motive: ${suspect.motive}
    - Your Alibi: ${suspect.alibi}
    - Your Secret: ${suspect.secret}
    - Are you the culprit? ${suspect.isCulprit ? "YES" : "NO"}

    STRICT RULES:
    1. Stay in character. Use Indian English (e.g., "ji", "na", "yaar", "arre").
    2. Do NOT hallucinate new evidence. Only talk about facts mentioned in the case context or your own alibi/secret.
    3. If you are innocent, you might be defensive or helpful. If you are the culprit, be evasive but don't lie about "World Context" facts that others would know.
    4. Do not admit you are an AI.
  `;

  return callWithRetry(async (ai) => {
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
  const accusedSuspect = caseInfo.suspects.find(s => s.id === accusedSuspectId);
  const isCorrect = accusedSuspect?.isCulprit || false;
  
  const prompt = `
    As the Chief Inspector, evaluate the detective's accusation.
    
    STRICT EVALUATION RULES:
    1. You MUST ONLY use the facts provided in the 'Case File Data' below.
    2. DO NOT introduce ANY new evidence, facts, or clues that were not in the original case file. (e.g., if a 'raincoat' wasn't in the evidence list, do NOT mention it).
    3. Evaluate if the detective's reasoning logically connects the provided evidence to the culprit.
    4. If the detective is wrong, explain why based ONLY on the provided alibis and evidence.
    5. Use Indian English and a professional tone.

    Case File Data:
    - Title: ${caseInfo.title}
    - Victim: ${caseInfo.victim}
    - Crime Scene: ${caseInfo.crimeScene}
    - Method: ${caseInfo.causeOfDeath}
    - Initial Clues: ${caseInfo.initialClues.join(', ')}
    - Evidence Provided to Player: ${caseInfo.evidence.join(', ')}
    - Suspects: ${caseInfo.suspects.map(s => `${s.name}: Motive=${s.motive}, Alibi=${s.alibi}, Secret=${s.secret}, Culprit=${s.isCulprit}`).join(' | ')}

    Detective's Accusation:
    - Accused: ${accusedSuspect?.name}
    - Reasoning: ${reasoning}
    - Investigation Notes: ${notes}

    Return ONLY valid JSON with 'feedback' and 'score' (0-100).
  `;

  return callWithRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
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
    return { isCorrect, feedback: result.feedback, score: result.score };
  });
};
