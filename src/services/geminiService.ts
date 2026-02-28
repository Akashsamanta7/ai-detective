import { GoogleGenAI, Type } from "@google/genai";
import { Case, Suspect, Message } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const generateCase = async (): Promise<Case> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: "Generate a detailed criminal case (Murder, Kidnapping, Theft, or Fraud) for an AI Detective game set in India. Use Indian names (e.g., Rajesh, Priya, Vikram), Indian locations (e.g., Mumbai, Delhi, Bangalore), and Indian cultural contexts. The language should be Indian English (using terms like 'yaar', 'beta', 'ji', 'sir/madam', and typical Indian sentence structures). Include a title, type (e.g., 'Murder Investigation'), description (a narrative of what happened), victim, crime scene, time, cause of death (or method of crime), 3 initial clues, 4 suspects (one is the culprit), and a hidden solution. Each suspect should have a name, description, personality, motive, alibi, secret, age, occupation, and 3 personality traits.",
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
        required: ["title", "type", "description", "victim", "crimeScene", "timeOfCrime", "causeOfDeath", "initialClues", "suspects", "solution"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
};

export const interrogateSuspect = async (
  suspect: Suspect,
  caseInfo: Case,
  history: Message[],
  userInput: string
): Promise<string> => {
  const systemInstruction = `
    You are ${suspect.name}, a suspect in a murder mystery set in India.
    Case Context:
    - Victim: ${caseInfo.victim}
    - Crime Scene: ${caseInfo.crimeScene}
    - Cause of Death: ${caseInfo.causeOfDeath}
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
};

export const evaluateAccusation = async (
  caseInfo: Case,
  notes: string,
  accusedSuspectId: string,
  reasoning: string
): Promise<{ isCorrect: boolean; feedback: string; score: number }> => {
  const accusedSuspect = caseInfo.suspects.find(s => s.id === accusedSuspectId);
  const isCorrect = accusedSuspect?.isCulprit || false;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
      As the Chief Inspector (an experienced Indian Police Officer), evaluate the detective's accusation. Use Indian English and a professional yet firm tone.
      Case: ${caseInfo.title}
      Culprit was: ${caseInfo.suspects.find(s => s.isCulprit)?.name}
      Detective accused: ${accusedSuspect?.name}
      Detective's reasoning: ${reasoning}
      Detective's notes: ${notes}

      Provide a score (0-100) and detailed feedback on their logic and investigation.
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
};
