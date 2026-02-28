export enum GameState {
  START = 'START',
  GENERATING = 'GENERATING',
  BRIEFING = 'BRIEFING',
  INVESTIGATION = 'INVESTIGATION',
  ACCUSATION = 'ACCUSATION',
  EVALUATION = 'EVALUATION',
  JOINING = 'JOINING'
}

export interface Suspect {
  id: string;
  name: string;
  description: string;
  personality: string;
  motive: string;
  alibi: string;
  isCulprit: boolean;
  secret: string;
  age?: string;
  occupation?: string;
  traits?: string[];
}

export interface Case {
  title: string;
  victim: string;
  crimeScene: string;
  timeOfCrime: string;
  causeOfDeath: string;
  initialClues: string[];
  suspects: Suspect[];
  solution: string;
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  sender?: string; // For multiplayer
}

export interface RoomData {
  code: string;
  mode: 'SINGLE' | 'COOP';
  case: Case | null;
  notes: string;
  chatHistory: Record<string, Message[]>;
  accusationResult?: {
    isCorrect: boolean;
    feedback: string;
    score: number;
  };
  players: string[];
  currentSuspectId: string | null;
}

export interface InvestigationState extends RoomData {
  myPlayerId: string;
}
