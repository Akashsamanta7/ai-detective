import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  MessageSquare, 
  BookOpen, 
  User, 
  AlertCircle, 
  ChevronRight, 
  Send, 
  Loader2, 
  Gavel,
  RefreshCw,
  MapPin,
  Clock,
  Skull,
  History,
  X,
  Users,
  Copy,
  Check,
  Info
} from 'lucide-react';
import { GameState, Case, Suspect, Message, InvestigationState, RoomData } from './types';
import { generateCase, interrogateSuspect, evaluateAccusation } from './services/geminiService';

const generateRoomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

export default function App() {
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [investigation, setInvestigation] = useState<InvestigationState>(() => {
    let myId = localStorage.getItem('detective_player_id');
    if (!myId) {
      myId = Math.random().toString(36).substring(7);
      localStorage.setItem('detective_player_id', myId);
    }
    return {
      code: '',
      mode: 'SINGLE',
      case: null,
      notes: '',
      chatHistory: {},
      players: [],
      currentSuspectId: null,
      myPlayerId: myId,
    };
  });
  const [loading, setLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [reasoningText, setReasoningText] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [showProfile, setShowProfile] = useState<string | null>(null);
  const [showBriefingModal, setShowBriefingModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'sidebar'>('chat');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [investigation.chatHistory, investigation.currentSuspectId]);

  // WebSocket sync
  useEffect(() => {
    if (investigation.code) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}?code=${investigation.code}`);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'SYNC_STATE') {
          setInvestigation(prev => ({ ...prev, ...data.payload }));
        } else if (data.type === 'SYNC_NOTES') {
          setInvestigation(prev => ({ ...prev, notes: data.payload }));
        } else if (data.type === 'SYNC_CHAT') {
          const { suspectId, message } = data.payload;
          setInvestigation(prev => ({
            ...prev,
            chatHistory: {
              ...prev.chatHistory,
              [suspectId]: [...(prev.chatHistory[suspectId] || []), message]
            }
          }));
        } else if (data.type === 'SYNC_ACCUSATION') {
          setInvestigation(prev => ({ ...prev, accusationResult: data.payload }));
          setGameState(GameState.EVALUATION);
        }
      };

      return () => socket.close();
    }
  }, [investigation.code]);

  const broadcast = (type: string, payload: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, payload }));
    }
  };

  const syncWithServer = async (updatedData: Partial<RoomData>) => {
    const newData = { ...investigation, ...updatedData };
    const { myPlayerId, ...roomData } = newData;
    await fetch(`/api/rooms/${investigation.code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: roomData }),
    });
  };

  const createRoom = async (mode: 'SINGLE' | 'COOP') => {
    setLoading(true);
    setGameState(GameState.GENERATING);
    try {
      const newCase = await generateCase();
      const code = generateRoomCode();
      const initialData: RoomData = {
        code,
        mode,
        case: newCase,
        notes: '',
        chatHistory: {},
        players: [investigation.myPlayerId],
        currentSuspectId: null,
      };

      await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, mode, data: initialData }),
      });

      setInvestigation(prev => ({ ...prev, ...initialData }));
      setGameState(GameState.BRIEFING);
    } catch (error) {
      console.error("Failed to create room:", error);
      setGameState(GameState.START);
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${joinCode.toUpperCase()}`);
      if (!res.ok) throw new Error("Room not found");
      const room = await res.json();
      
      // Check mode compatibility
      if (room.mode === 'SINGLE' && room.data.players.length >= 1 && !room.data.players.includes(investigation.myPlayerId)) {
        alert("This is a single player room and is already occupied.");
        return;
      }
      if (room.mode === 'COOP' && room.data.players.length >= 2 && !room.data.players.includes(investigation.myPlayerId)) {
        alert("This room is full.");
        return;
      }

      const updatedPlayers = room.data.players.includes(investigation.myPlayerId) 
        ? room.data.players 
        : [...room.data.players, investigation.myPlayerId];

      const updatedData = { ...room.data, players: updatedPlayers };
      await fetch(`/api/rooms/${joinCode.toUpperCase()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: updatedData }),
      });

      setInvestigation(prev => ({ ...prev, ...updatedData }));
      setGameState(GameState.BRIEFING);
      broadcast('SYNC_STATE', updatedData);
    } catch (error) {
      alert("Could not join room. Please check the code.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !investigation.currentSuspectId || !investigation.case) return;

    const suspect = investigation.case.suspects.find(s => s.id === investigation.currentSuspectId)!;
    const currentHistory = investigation.chatHistory[suspect.id] || [];
    
    const newUserMessage: Message = { 
      role: 'user', 
      text: inputText, 
      sender: investigation.myPlayerId 
    };
    const updatedHistory = [...currentHistory, newUserMessage];

    setInvestigation(prev => ({
      ...prev,
      chatHistory: {
        ...prev.chatHistory,
        [suspect.id]: updatedHistory
      }
    }));
    broadcast('SYNC_CHAT', { suspectId: suspect.id, message: newUserMessage });
    
    setInputText('');
    setLoading(true);

    try {
      const responseText = await interrogateSuspect(suspect, investigation.case, currentHistory, inputText);
      const modelMessage: Message = { role: 'model', text: responseText };
      
      const finalHistory = [...updatedHistory, modelMessage];
      setInvestigation(prev => ({
        ...prev,
        chatHistory: {
          ...prev.chatHistory,
          [suspect.id]: finalHistory
        }
      }));
      broadcast('SYNC_CHAT', { suspectId: suspect.id, message: modelMessage });
      syncWithServer({ chatHistory: { ...investigation.chatHistory, [suspect.id]: finalHistory } });
    } catch (error) {
      console.error("Interrogation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateNotes = (newNotes: string) => {
    setInvestigation(prev => ({ ...prev, notes: newNotes }));
    broadcast('SYNC_NOTES', newNotes);
    syncWithServer({ notes: newNotes });
  };

  const handleAccuse = async (suspectId: string) => {
    if (!investigation.case) return;
    setLoading(true);
    try {
      const result = await evaluateAccusation(investigation.case, investigation.notes, suspectId, reasoningText);
      setInvestigation(prev => ({
        ...prev,
        accusationResult: result
      }));
      broadcast('SYNC_ACCUSATION', result);
      syncWithServer({ accusationResult: result });
      setGameState(GameState.EVALUATION);
    } catch (error) {
      console.error("Evaluation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(investigation.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderStart = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] text-white p-6 text-center">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full"
      >
        <h1 className="text-6xl font-bold mb-4 tracking-tighter font-serif italic">AI DETECTIVE</h1>
        <p className="text-zinc-400 text-lg mb-12 font-light">
          Indian noir investigation. Solve procedurally generated crimes solo or with a partner.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl space-y-4">
            <h3 className="text-xl font-serif italic">Start New Case</h3>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => createRoom('SINGLE')}
                className="w-full py-3 bg-white text-black rounded-xl font-bold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
              >
                <User size={18} /> SINGLE PLAYER
              </button>
              <button 
                onClick={() => createRoom('COOP')}
                className="w-full py-3 bg-zinc-800 text-white rounded-xl font-bold hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2"
              >
                <Users size={18} /> 2 PLAYER CO-OP
              </button>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl space-y-4">
            <h3 className="text-xl font-serif italic">Join Existing Case</h3>
            <div className="space-y-3">
              <input 
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ENTER ROOM CODE"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 text-center font-mono tracking-widest focus:outline-none focus:border-zinc-600"
              />
              <button 
                onClick={joinRoom}
                disabled={!joinCode.trim() || loading}
                className="w-full py-3 bg-zinc-100 text-black rounded-xl font-bold hover:bg-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : 'JOIN ROOM'}
              </button>
            </div>
          </div>
        </div>

        <p className="text-zinc-600 text-xs font-mono uppercase tracking-widest">
          Room codes store your progress. Save them manually to resume later.
        </p>
      </motion.div>
    </div>
  );

  const renderGenerating = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] text-white p-6">
      <Loader2 className="animate-spin mb-4 text-zinc-500" size={48} />
      <p className="text-zinc-400 font-mono text-sm uppercase tracking-widest">Drafting Case File...</p>
    </div>
  );

  const renderBriefing = () => (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 flex flex-col items-center">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="max-w-3xl w-full space-y-8"
      >
        <div className="flex justify-between items-start border-b border-zinc-800 pb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 bg-red-900/30 text-red-500 text-[10px] font-mono border border-red-900/50 rounded uppercase tracking-widest">
                {investigation.case?.type || 'Criminal Case'}
              </span>
              <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest">Case File #{investigation.code}</h2>
            </div>
            <h1 className="text-4xl font-serif italic">{investigation.case?.title}</h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
              <span className="text-xs font-mono text-zinc-500">CODE:</span>
              <span className="font-mono font-bold text-white">{investigation.code}</span>
              <button onClick={copyCode} className="text-zinc-500 hover:text-white transition-colors">
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              </button>
            </div>
            <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
              {investigation.mode} MODE
            </span>
          </div>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-2xl">
          <h3 className="text-xs font-mono text-zinc-500 uppercase mb-3">Case Summary</h3>
          <p className="text-zinc-300 leading-relaxed italic">
            {investigation.case?.description}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-zinc-300">
              <User className="text-zinc-500" size={20} />
              <span><strong className="text-white">Victim:</strong> {investigation.case?.victim}</span>
            </div>
            <div className="flex items-center gap-3 text-zinc-300">
              <MapPin className="text-zinc-500" size={20} />
              <span><strong className="text-white">Scene:</strong> {investigation.case?.crimeScene}</span>
            </div>
            <div className="flex items-center gap-3 text-zinc-300">
              <Clock className="text-zinc-500" size={20} />
              <span><strong className="text-white">Time:</strong> {investigation.case?.timeOfCrime}</span>
            </div>
            <div className="flex items-center gap-3 text-zinc-300">
              <Skull className="text-zinc-500" size={20} />
              <span><strong className="text-white">Cause:</strong> {investigation.case?.causeOfDeath}</span>
            </div>
          </div>

          <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800">
            <h3 className="text-sm font-mono text-zinc-500 uppercase mb-4">Initial Clues</h3>
            <ul className="space-y-2">
              {investigation.case?.initialClues.map((clue, i) => (
                <li key={i} className="text-zinc-300 flex gap-2">
                  <span className="text-zinc-600">•</span> {clue}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <button 
          onClick={() => setGameState(GameState.INVESTIGATION)}
          className="w-full py-4 bg-zinc-100 text-black rounded-xl font-bold hover:bg-white transition-all flex items-center justify-center gap-2"
        >
          COMMENCE INVESTIGATION <ChevronRight size={20} />
        </button>
      </motion.div>
    </div>
  );

  const renderInvestigation = () => (
    <div className="flex flex-col md:flex-row h-screen bg-[#0a0a0a] text-white overflow-hidden">
      {/* Sidebar: Suspects & Notes - Hidden on mobile unless activeTab is 'sidebar' */}
      <div className={`${activeTab === 'sidebar' ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-r border-zinc-800 flex-col h-full bg-[#0a0a0a] z-20`}>
        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <div className="p-4 md:p-6 border-b border-zinc-800">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Suspects</h3>
              <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-600">
                <Users size={10} /> {investigation.players.length} ACTIVE
              </div>
            </div>
            <div className="space-y-2">
              {investigation.case?.suspects.map(suspect => (
                <div key={suspect.id} className="relative group">
                  <button
                    onClick={() => {
                      setInvestigation(prev => ({ ...prev, currentSuspectId: suspect.id }));
                      if (window.innerWidth < 768) setActiveTab('chat');
                    }}
                    className={`w-full p-3 rounded-xl text-left transition-all flex items-center gap-3 ${
                      investigation.currentSuspectId === suspect.id 
                        ? 'bg-white text-black' 
                        : 'hover:bg-zinc-900 text-zinc-400'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${investigation.currentSuspectId === suspect.id ? 'bg-black' : 'bg-zinc-700'}`} />
                    <span className="font-medium flex-1 truncate">{suspect.name}</span>
                  </button>
                  <button 
                    onClick={() => setShowProfile(suspect.id)}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${
                      investigation.currentSuspectId === suspect.id ? 'text-black hover:bg-black/5' : 'text-zinc-500 hover:bg-zinc-800'
                    }`}
                  >
                    <Info size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 md:p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen size={16} className="text-zinc-500" />
              <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Shared Notes</h3>
            </div>
            <textarea
              value={investigation.notes}
              onChange={(e) => updateNotes(e.target.value)}
              placeholder="Record clues, contradictions, and theories..."
              className="w-full h-48 md:h-64 bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-300 focus:outline-none focus:border-zinc-600 resize-none"
            />
          </div>
        </div>

        <div className="p-4 md:p-6 border-t border-zinc-800 space-y-3 bg-[#0a0a0a] shrink-0 mb-16 md:mb-0">
          <button 
            onClick={() => setShowBriefingModal(true)}
            className="w-full py-3 bg-zinc-900 text-zinc-400 border border-zinc-800 rounded-xl font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
          >
            <AlertCircle size={18} />
            CASE BRIEFING
          </button>
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-mono text-zinc-600 uppercase">Room Code</span>
            <span className="text-[10px] font-mono text-white">{investigation.code}</span>
          </div>
          <button 
            onClick={() => setGameState(GameState.ACCUSATION)}
            className="w-full py-3 bg-red-900/20 text-red-500 border border-red-900/50 rounded-xl font-bold hover:bg-red-900/30 transition-all flex items-center justify-center gap-2"
          >
            <Gavel size={18} />
            MAKE ACCUSATION
          </button>
        </div>
      </div>

      {/* Main: Interrogation - Hidden on mobile unless activeTab is 'chat' */}
      <div className={`${activeTab === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 flex-col relative h-full`}>
        {investigation.currentSuspectId ? (
          <>
            <div className="p-4 md:p-6 border-b border-zinc-800 flex justify-between items-center bg-[#0a0a0a]">
              <div>
                <h2 className="text-xl md:text-2xl font-serif italic">
                  {investigation.case?.suspects.find(s => s.id === investigation.currentSuspectId)?.name}
                </h2>
                <p className="text-[10px] md:text-xs text-zinc-500 font-mono uppercase">Interrogation in progress</p>
              </div>
              <button 
                onClick={() => setShowProfile(investigation.currentSuspectId)}
                className="flex items-center gap-2 text-[10px] md:text-xs font-mono text-zinc-500 hover:text-white transition-colors"
              >
                <span className="hidden sm:inline">VIEW PROFILE</span> <Info size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 pb-32 md:pb-6">
              {investigation.chatHistory[investigation.currentSuspectId]?.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {msg.sender && msg.sender !== investigation.myPlayerId && (
                    <span className="text-[10px] font-mono text-zinc-600 mb-1 uppercase">Partner</span>
                  )}
                  <div className={`max-w-[85%] md:max-w-[80%] p-3 md:p-4 rounded-2xl ${
                    msg.role === 'user' 
                      ? (msg.sender === investigation.myPlayerId ? 'bg-zinc-100 text-black rounded-tr-none' : 'bg-zinc-800 text-white rounded-tr-none border border-zinc-700')
                      : 'bg-zinc-900 text-zinc-200 rounded-tl-none border border-zinc-800'
                  }`}>
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-900 p-4 rounded-2xl rounded-tl-none border border-zinc-800">
                    <Loader2 className="animate-spin text-zinc-500" size={16} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 md:p-6 border-t border-zinc-800 bg-[#0a0a0a] absolute bottom-16 md:bottom-0 left-0 right-0">
              <div className="relative">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask a question..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-full py-3 md:py-4 pl-5 md:pl-6 pr-12 md:pr-14 focus:outline-none focus:border-zinc-600 text-sm"
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={loading || !inputText.trim()}
                  className="absolute right-1.5 md:right-2 top-1.5 md:top-2 p-2 bg-white text-black rounded-full hover:bg-zinc-200 disabled:opacity-50 transition-all"
                >
                  <Send size={18} md:size={20} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 text-center">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-zinc-900 rounded-full flex items-center justify-center mb-6 border border-zinc-800">
              <MessageSquare size={32} md:size={40} className="text-zinc-700" />
            </div>
            <h2 className="text-lg md:text-xl font-medium mb-2">Select a Suspect</h2>
            <p className="text-zinc-500 max-w-sm text-sm">Choose a suspect from the sidebar to begin interrogation. Watch for contradictions and hidden motives.</p>
            <button 
              onClick={() => setActiveTab('sidebar')}
              className="mt-6 md:hidden px-6 py-2 bg-zinc-800 text-white rounded-full text-sm font-bold"
            >
              OPEN SUSPECT LIST
            </button>
          </div>
        )}
      </div>

      {/* Mobile Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-zinc-950 border-t border-zinc-800 flex items-center justify-around z-30 px-4">
        <button 
          onClick={() => setActiveTab('sidebar')}
          className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'sidebar' ? 'text-white' : 'text-zinc-500'}`}
        >
          <BookOpen size={20} />
          <span className="text-[10px] font-mono uppercase">Case</span>
        </button>
        <button 
          onClick={() => setActiveTab('chat')}
          className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'chat' ? 'text-white' : 'text-zinc-500'}`}
        >
          <MessageSquare size={20} />
          <span className="text-[10px] font-mono uppercase">Chat</span>
        </button>
      </div>

      {/* Suspect Profile Modal */}
      <AnimatePresence>
        {showProfile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            onClick={() => setShowProfile(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-3xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-3xl font-serif italic mb-1">
                      {investigation.case?.suspects.find(s => s.id === showProfile)?.name}
                    </h2>
                    <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
                      {investigation.case?.suspects.find(s => s.id === showProfile)?.occupation} • {investigation.case?.suspects.find(s => s.id === showProfile)?.age} Years Old
                    </p>
                  </div>
                  <button onClick={() => setShowProfile(null)} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Description</h4>
                    <p className="text-sm text-zinc-300 leading-relaxed">
                      {investigation.case?.suspects.find(s => s.id === showProfile)?.description}
                    </p>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Personality Traits</h4>
                    <div className="flex flex-wrap gap-2">
                      {investigation.case?.suspects.find(s => s.id === showProfile)?.traits?.map((trait, i) => (
                        <span key={i} className="px-3 py-1 bg-zinc-800 text-zinc-400 rounded-full text-[10px] font-mono uppercase">
                          {trait}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-zinc-800">
                    <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Known Alibi</h4>
                    <p className="text-sm text-zinc-400 italic">
                      "{investigation.case?.suspects.find(s => s.id === showProfile)?.alibi}"
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => setShowProfile(null)}
                  className="w-full py-3 bg-white text-black rounded-xl font-bold hover:bg-zinc-200 transition-colors"
                >
                  CLOSE PROFILE
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Case Briefing Modal */}
      <AnimatePresence>
        {showBriefingModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            onClick={() => setShowBriefingModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 w-full max-w-2xl rounded-3xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-8 space-y-6 max-h-[80vh] overflow-y-auto">
                <div className="flex justify-between items-start border-b border-zinc-800 pb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-red-900/30 text-red-500 text-[10px] font-mono border border-red-900/50 rounded uppercase tracking-widest">
                        {investigation.case?.type}
                      </span>
                      <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Case File #{investigation.code}</h4>
                    </div>
                    <h2 className="text-3xl font-serif italic">{investigation.case?.title}</h2>
                  </div>
                  <button onClick={() => setShowBriefingModal(false)} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">What Happened</h4>
                    <p className="text-sm text-zinc-300 leading-relaxed italic">
                      {investigation.case?.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Victim</h4>
                      <p className="text-sm text-white">{investigation.case?.victim}</p>
                    </div>
                    <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Scene</h4>
                      <p className="text-sm text-white">{investigation.case?.crimeScene}</p>
                    </div>
                    <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Time</h4>
                      <p className="text-sm text-white">{investigation.case?.timeOfCrime}</p>
                    </div>
                    <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Method</h4>
                      <p className="text-sm text-white">{investigation.case?.causeOfDeath}</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Initial Clues</h4>
                    <ul className="space-y-2">
                      {investigation.case?.initialClues.map((clue, i) => (
                        <li key={i} className="text-sm text-zinc-300 flex gap-2">
                          <span className="text-zinc-600">•</span> {clue}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <button 
                  onClick={() => setShowBriefingModal(false)}
                  className="w-full py-3 bg-white text-black rounded-xl font-bold hover:bg-zinc-200 transition-colors"
                >
                  RETURN TO INVESTIGATION
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const renderAccusation = () => (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 flex flex-col items-center justify-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-2xl w-full bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl space-y-8"
      >
        <div className="text-center">
          <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest mb-2">Final Deduction</h2>
          <h1 className="text-4xl font-serif italic">Who committed the crime?</h1>
        </div>

        <div className="space-y-4">
          <label className="text-xs font-mono text-zinc-500 uppercase">Select Culprit</label>
          <div className="grid grid-cols-2 gap-4">
            {investigation.case?.suspects.map(suspect => (
              <button
                key={suspect.id}
                onClick={() => setInvestigation(prev => ({ ...prev, currentSuspectId: suspect.id }))}
                className={`p-4 rounded-xl border transition-all text-left ${
                  investigation.currentSuspectId === suspect.id 
                    ? 'bg-white text-black border-white' 
                    : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                <p className="font-bold">{suspect.name}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-xs font-mono text-zinc-500 uppercase">Explain Your Reasoning</label>
          <textarea
            value={reasoningText}
            onChange={(e) => setReasoningText(e.target.value)}
            placeholder="Connect the clues and explain why this suspect is the killer..."
            className="w-full h-32 bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-300 focus:outline-none focus:border-zinc-600 resize-none"
          />
        </div>

        <div className="flex gap-4">
          <button 
            onClick={() => setGameState(GameState.INVESTIGATION)}
            className="flex-1 py-4 border border-zinc-800 rounded-xl font-bold hover:bg-zinc-800 transition-all"
          >
            BACK TO CASE
          </button>
          <button 
            onClick={() => investigation.currentSuspectId && handleAccuse(investigation.currentSuspectId)}
            disabled={loading || !investigation.currentSuspectId || !reasoningText.trim()}
            className="flex-1 py-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <><Gavel size={20} /> SUBMIT VERDICT</>}
          </button>
        </div>
      </motion.div>
    </div>
  );

  const renderEvaluation = () => (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 flex flex-col items-center justify-center overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl w-full space-y-8 py-12"
      >
        <div className="text-center space-y-4">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold uppercase tracking-widest ${
            investigation.accusationResult?.isCorrect ? 'bg-emerald-900/20 text-emerald-500' : 'bg-red-900/20 text-red-500'
          }`}>
            {investigation.accusationResult?.isCorrect ? 'Case Solved' : 'Case Cold'}
          </div>
          <h1 className="text-6xl font-serif italic">
            {investigation.accusationResult?.isCorrect ? 'Justice Served' : 'The Killer Escaped'}
          </h1>
          <div className="text-4xl font-mono text-zinc-500">
            Score: {investigation.accusationResult?.score}/100
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-6">
          <div>
            <h3 className="text-xs font-mono text-zinc-500 uppercase mb-2">Chief Inspector's Report</h3>
            <p className="text-zinc-300 leading-relaxed italic">
              "{investigation.accusationResult?.feedback}"
            </p>
          </div>

          <div className="pt-6 border-t border-zinc-800">
            <h3 className="text-xs font-mono text-zinc-500 uppercase mb-2">The Truth</h3>
            <p className="text-zinc-400">
              {investigation.case?.solution}
            </p>
          </div>
        </div>

        <button 
          onClick={() => setGameState(GameState.START)}
          className="w-full py-4 bg-white text-black rounded-xl font-bold hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw size={20} />
          RETURN TO HEADQUARTERS
        </button>
      </motion.div>
    </div>
  );

  return (
    <div className="font-sans selection:bg-zinc-500 selection:text-white">
      <AnimatePresence mode="wait">
        {gameState === GameState.START && renderStart()}
        {gameState === GameState.GENERATING && renderGenerating()}
        {gameState === GameState.BRIEFING && renderBriefing()}
        {gameState === GameState.INVESTIGATION && renderInvestigation()}
        {gameState === GameState.ACCUSATION && renderAccusation()}
        {gameState === GameState.EVALUATION && renderEvaluation()}
      </AnimatePresence>
    </div>
  );
}
