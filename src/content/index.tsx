import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Sparkles, X, PlusCircle, Check, Trash2, CheckCircle, Circle, ListTodo, Flame, Send, Award, BookOpen, Lock, ShieldAlert } from 'lucide-react';
import { supabase } from '../supabaseClient';
// Import tailwind compiled CSS directly as a string using Vite's ?inline query
import shadowStyles from '../index.css?inline';

interface Task {
  id: string;
  title: string;
  completed: boolean;
  understanding?: string;
  score?: number;
  explanation?: string;
  createdAt: number;
}

const RootModalManager: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  
  // Supabase Authenticated Session State
  const [supabaseSession, setSupabaseSession] = useState<any>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // State for task creation modal
  const [taskText, setTaskText] = useState('');
  const [showToast, setShowToast] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // States for interactive task completion & AI feedback inside workspace list
  const [activeFeedbackId, setActiveFeedbackId] = useState<string | null>(null);
  const [understandingText, setUnderstandingText] = useState('');
  const [analyzingTaskId, setAnalyzingTaskId] = useState<string | null>(null);
  const [viewExplanationId, setViewExplanationId] = useState<string | null>(null);

  // 1. Authenticated Session Handshake & Sync with Verification
  useEffect(() => {
    const initSession = async () => {
      chrome.storage.local.get(['supabaseSession'], async (result) => {
        const session = result.supabaseSession;
        if (session) {
          try {
            // Verify active session with backend to prevent stale local session bypass
            const { data: { user }, error } = await supabase.auth.setSession({
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            });
            if (error || !user) {
              console.warn('Karm Yog: Stale/invalid session on init. Clearing storage.');
              setSupabaseSession(null);
              chrome.storage.local.set({ supabaseSession: null });
            } else {
              setSupabaseSession(session);
            }
          } catch (e) {
            console.error('Karm Yog: Error checking initial session:', e);
            setSupabaseSession(null);
            chrome.storage.local.set({ supabaseSession: null });
          }
        } else {
          setSupabaseSession(null);
        }
        setSessionLoaded(true);
      });
    };

    initSession();

    // Listen for storage login changes in Popup UI
    const handleStorageChange = async (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.supabaseSession) {
        const session = changes.supabaseSession.newValue;
        if (session) {
          try {
            const { data: { user }, error } = await supabase.auth.setSession({
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            });
            if (error || !user) {
              console.warn('Karm Yog: Stale/invalid session from change. Clearing.');
              setSupabaseSession(null);
            } else {
              setSupabaseSession(session);
            }
          } catch (e) {
            setSupabaseSession(null);
          }
        } else {
          await supabase.auth.signOut();
          setSupabaseSession(null);
        }
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Trigger cross-context database sync (notifies other frames to pull latest)
  const triggerGlobalSync = () => {
    chrome.storage.local.set({ tasksLastSynced: Date.now() });
  };

  // 2. Fetch tasks based on Session Status & listen for global refetch triggers
  useEffect(() => {
    if (sessionLoaded) {
      fetchTasks();
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      // Only online mode allowed; refetch from Supabase whenever any tab or popup triggers tasksLastSynced
      if (changes.tasksLastSynced && supabaseSession) {
        fetchTasks();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [supabaseSession, sessionLoaded]);

  const fetchTasks = async () => {
    if (supabaseSession) {
      // Authenticated Mode: Query Supabase
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching tasks from Supabase:', error);
      } else if (data) {
        const mapped = data.map((t: any) => ({
          id: t.id,
          title: t.title,
          completed: t.completed,
          understanding: t.understanding,
          score: t.score,
          explanation: t.explanation,
          createdAt: new Date(t.created_at).getTime(),
        }));
        setTasks(mapped);
      }
    } else {
      setTasks([]);
    }
  };

  useEffect(() => {
    // Listen for trigger commands from the background service worker
    const handleMessage = (message: { action: string }) => {
      if (message.action === 'TRIGGER_MODAL') {
        setIsModalOpen(true);
        setIsListOpen(false); // Close list if modal opens
      } else if (message.action === 'TRIGGER_LIST') {
        setIsListOpen((prev) => !prev);
        setIsModalOpen(false); // Close modal if list opens
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // Escape key closes both windows
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
        setIsListOpen(false);
        setActiveFeedbackId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (isModalOpen && supabaseSession) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isModalOpen, supabaseSession]);



  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskText.trim() || !supabaseSession) return;

    // Authenticated sync insert
    const { error } = await supabase
      .from('tasks')
      .insert([{
        title: taskText.trim(),
        user_id: supabaseSession.user_id,
        completed: false
      }]);

    if (error) {
      console.error('Error adding task to Supabase:', error);
    } else {
      fetchTasks();
      triggerGlobalSync(); // Alert other frames
    }
    
    setTaskText('');
    setIsModalOpen(false);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  // Toggle completion checkmark click
  const handleToggleClick = async (task: Task) => {
    if (!supabaseSession) return;

    if (task.completed) {
      // Authenticated reset (wipes previous AI results)
      const { error } = await supabase
        .from('tasks')
        .update({ completed: false, understanding: null, score: null, explanation: null })
        .eq('id', task.id);

      if (error) {
        console.error('Error updating task in Supabase:', error);
      } else {
        fetchTasks();
        triggerGlobalSync();
      }
    } else {
      // Toggle Feedback Form expansion
      setActiveFeedbackId(task.id);
      setUnderstandingText('');
    }
  };

  // Skip AI path
  const skipAIEvaluation = async (id: string) => {
    if (!supabaseSession) return;

    const { error } = await supabase
      .from('tasks')
      .update({ completed: true })
      .eq('id', id);

    if (error) {
      console.error('Error updating task in Supabase:', error);
    } else {
      fetchTasks();
      triggerGlobalSync();
    }
    setActiveFeedbackId(null);
  };

  // Submit feedback for AI evaluation
  const submitFeedback = async (id: string) => {
    if (!understandingText.trim() || !supabaseSession) return;

    setAnalyzingTaskId(id);
    setActiveFeedbackId(null);

    // CRITICAL: Immediately clear out any cached/old AI results from local memory
    setTasks((prev) => 
      prev.map((t) => t.id === id ? { ...t, score: undefined, explanation: undefined, understanding: undefined } : t)
    );

    // Write to Supabase DB (triggers DB Webhook & Edge Function)
    const { error } = await supabase
      .from('tasks')
      .update({
        completed: true,
        understanding: understandingText.trim(),
        score: null,
        explanation: null
      })
      .eq('id', id);

    if (error) {
      console.error('Error writing feedback to Supabase:', error);
      setAnalyzingTaskId(null);
    } else {
      triggerGlobalSync(); // Alert other frames to show the loading skeleton!

      // Safe CSP-compliant HTTPS polling to check for AI response writebacks
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const { data } = await supabase
          .from('tasks')
          .select('score, explanation')
          .eq('id', id)
          .single();

        if (data && data.score !== null) {
          clearInterval(interval);
          setAnalyzingTaskId(null);
          fetchTasks();
          triggerGlobalSync(); // Alert other frames to show the finished results!
        } else if (attempts >= 6) {
          clearInterval(interval);
          setAnalyzingTaskId(null);
          fetchTasks();
          triggerGlobalSync();
        }
      }, 1500);
    }
  };

  const deleteTask = async (id: string) => {
    if (!supabaseSession) return;

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting task in Supabase:', error);
    } else {
      fetchTasks();
      triggerGlobalSync();
    }
    if (activeFeedbackId === id) setActiveFeedbackId(null);
  };

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <div className="karm-yog-scope font-sans antialiased text-slate-100 selection:bg-blue-500/30">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed bottom-5 right-5 z-[2147483647] flex items-center gap-2 bg-slate-900 border border-emerald-500/30 px-4 py-3 rounded-xl shadow-lg backdrop-blur-md">
          <Check size={18} className="text-emerald-400" />
          <span className="text-sm font-medium">Task captured successfully!</span>
        </div>
      )}

      {/* --- QUICK CAPTURE FORM MODAL (Opt + Shift + T) --- */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-[2147483645] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setIsModalOpen(false)}
        >
          {!supabaseSession ? (
            /* Locked Gate state if not logged in */
            <div 
              className="w-[420px] bg-slate-900 border border-slate-850 rounded-2xl shadow-2xl p-6 relative overflow-hidden flex flex-col items-center text-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

              <div className="flex justify-between w-full border-b border-slate-800/40 pb-3 items-center">
                <span className="text-[10px] font-bold font-mono tracking-widest text-rose-450 uppercase flex items-center gap-1">
                  <ShieldAlert size={12} />
                  Access Required
                </span>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-500 hover:text-slate-350 p-1 hover:bg-slate-800/40 rounded-lg cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="p-3.5 bg-rose-550/10 border border-rose-500/20 text-rose-400 rounded-full mt-2">
                <Lock size={28} />
              </div>

              <div className="flex flex-col gap-1.5 px-2 mt-1">
                <h3 className="text-sm font-bold text-slate-200">Workspace Connection Required</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                  Please click the **Karm Yog** icon in your browser toolbar to log in or create an account, syncing your workspace before capturing tasks.
                </p>
              </div>

              <button 
                onClick={() => setIsModalOpen(false)}
                className="w-full mt-3 py-2 bg-slate-950 border border-slate-850 hover:bg-slate-900 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Got it
              </button>
            </div>
          ) : (
            /* Normal input form if logged in */
            <div 
              className="w-[450px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 relative overflow-hidden flex flex-col gap-4 text-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="flex items-center justify-between border-b border-slate-800/50 pb-3 relative z-10">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-500/10 rounded-lg">
                    <Sparkles size={16} className="text-blue-400" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-100">Karm Yog Quick Task</h3>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-400 hover:text-slate-200 transition-colors p-1 hover:bg-slate-800/50 rounded-lg cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleAddTask} className="flex flex-col gap-4 relative z-10">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="task-input" className="text-xs font-medium text-slate-400">
                    What are you focusing on next?
                  </label>
                  <input
                    id="task-input"
                    ref={inputRef}
                    type="text"
                    placeholder="Type task details and press Enter..."
                    value={taskText}
                    onChange={(e) => setTaskText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all shadow-inner"
                  />
                </div>

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/30">
                  <span className="text-[10px] text-slate-555 font-mono">ESC to cancel</span>
                  <button
                    type="submit"
                    disabled={!taskText.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
                  >
                    <PlusCircle size={14} />
                    Add Task
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* --- TASK LIST MANAGER MODAL (Opt + Shift + V) --- */}
      {isListOpen && (
        <div 
          className="fixed inset-0 z-[2147483645] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setIsListOpen(false)}
        >
          {!supabaseSession ? (
            /* Locked Gate state if not logged in */
            <div 
              className="w-[420px] bg-slate-900 border border-slate-850 rounded-2xl shadow-2xl p-6 relative overflow-hidden flex flex-col items-center text-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

              <div className="flex justify-between w-full border-b border-slate-800/40 pb-3 items-center">
                <span className="text-[10px] font-bold font-mono tracking-widest text-rose-450 uppercase flex items-center gap-1">
                  <ShieldAlert size={12} />
                  Access Required
                </span>
                <button 
                  onClick={() => setIsListOpen(false)}
                  className="text-slate-500 hover:text-slate-350 p-1 hover:bg-slate-800/40 rounded-lg cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="p-3.5 bg-rose-550/10 border border-rose-500/20 text-rose-400 rounded-full mt-2">
                <Lock size={28} />
              </div>

              <div className="flex flex-col gap-1.5 px-2 mt-1">
                <h3 className="text-sm font-bold text-slate-200">Workspace Connection Required</h3>
                <p className="text-[11px] text-slate-505 leading-relaxed font-medium">
                  Please click the **Karm Yog** icon in your browser toolbar to log in or create an account, syncing your workspace before viewing tasks.
                </p>
              </div>

              <button 
                onClick={() => setIsListOpen(false)}
                className="w-full mt-3 py-2 bg-slate-950 border border-slate-850 hover:bg-slate-900 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Got it
              </button>
            </div>
          ) : (
            /* Normal checklist list if logged in */
            <div 
              className="w-[520px] max-h-[585px] bg-slate-900 border border-slate-850 rounded-2xl shadow-2xl p-6 relative overflow-hidden flex flex-col text-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute -top-32 -left-32 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4 relative z-10">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/15">
                    <Flame size={18} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-100 tracking-wide">Karm Yog Workspace</h3>
                    <p className="text-[10px] text-slate-505 font-medium font-mono uppercase">
                      Synced Account: {supabaseSession.email}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsListOpen(false)}
                  className="text-slate-400 hover:text-slate-200 transition-colors p-1 hover:bg-slate-800/50 rounded-lg cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Main scrollable list */}
              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 relative z-10 mb-4 min-h-[300px] max-h-[380px]">
                {tasks.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6 bg-slate-950/20 border border-slate-850/30 rounded-2xl">
                    <ListTodo size={40} className="text-slate-700 mb-3" />
                    <p className="text-sm font-semibold text-slate-400">No tasks captured yet</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-[260px] leading-relaxed">
                      Hit <span className="font-mono text-blue-400 bg-blue-500/5 px-1 py-0.5 rounded border border-blue-500/10">Opt+Shift+T</span> inside any tab to capture things in real-time.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex flex-col gap-2.5 px-4 py-3.5 rounded-xl border border-slate-850 bg-slate-950/20 hover:bg-slate-950/30 transition-all duration-200 group"
                      >
                        {/* Task Info Row */}
                        <div className="flex items-center justify-between gap-4">
                          <div 
                            onClick={() => handleToggleClick(task)}
                            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                          >
                            <button className="text-slate-500 hover:text-blue-400 transition-colors flex-shrink-0 cursor-pointer">
                              {task.completed ? (
                                <CheckCircle size={18} className="text-emerald-500" />
                              ) : (
                                <Circle size={18} className="text-slate-600 group-hover:text-blue-400" />
                              )}
                            </button>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span 
                                className={`text-sm font-semibold truncate transition-all leading-relaxed ${
                                  task.completed ? 'text-slate-505 line-through font-normal' : 'text-slate-200 group-hover:text-white'
                                }`}
                              >
                                {task.title}
                              </span>
                              {/* Score Tag if present */}
                              {task.completed && task.score !== undefined && task.score !== null && (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/10">
                                    <Award size={10} />
                                    AI Score: {task.score}/10
                                  </span>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewExplanationId((prev) => prev === task.id ? null : task.id);
                                    }}
                                    className="flex items-center gap-1 text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                                  >
                                    <BookOpen size={10} />
                                    {viewExplanationId === task.id ? 'Hide explanation' : 'Review explanation'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <button
                            onClick={() => deleteTask(task.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-555 hover:text-rose-500 transition-all duration-150 p-1.5 hover:bg-slate-800/40 rounded-lg flex-shrink-0 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* --- ACTIVE FEEDBACK INPUT AREA --- */}
                        {activeFeedbackId === task.id && (
                          <div className="mt-2.5 pt-3 border-t border-slate-850 flex flex-col gap-3">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                                <Sparkles size={11} className="text-blue-400" />
                                Describe your understanding of this topic:
                              </label>
                              <textarea
                                placeholder="Describe it in your own words. We will evaluate it using AI and generate your score..."
                                value={understandingText}
                                onChange={(e) => setUnderstandingText(e.target.value)}
                                rows={3}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-650 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 transition-all"
                              />
                            </div>

                            <div className="flex justify-between items-center gap-2">
                              <button
                                onClick={() => skipAIEvaluation(task.id)}
                                className="text-[10px] text-slate-550 hover:text-slate-405 transition-colors cursor-pointer"
                              >
                                Skip AI & just complete
                              </button>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setActiveFeedbackId(null)}
                                  className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800/40 text-[10px] font-semibold text-slate-400 transition-all cursor-pointer"
                                  >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => submitFeedback(task.id)}
                                  disabled={!understandingText.trim()}
                                  className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white text-[10px] font-bold shadow-md shadow-blue-500/10 transition-all cursor-pointer"
                                >
                                  <Send size={9} />
                                  Submit & Score
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* --- ANALYZING SKELETON LOAD STATE --- */}
                        {analyzingTaskId === task.id && (
                          <div className="mt-2 pt-2 border-t border-slate-850 flex flex-col gap-2 animate-pulse">
                            <div className="flex items-center gap-2 text-[10px] font-medium text-blue-400">
                              <Sparkles size={11} className="animate-spin text-blue-400" />
                              <span>AI Edge Function is evaluating your response...</span>
                            </div>
                            <div className="h-4 bg-slate-900/60 rounded-md w-full" />
                            <div className="h-4 bg-slate-900/60 rounded-md w-[80%]" />
                          </div>
                        )}

                        {/* --- COLLAPSIBLE EXPLANATION PANEL --- */}
                        {task.completed && viewExplanationId === task.id && task.explanation && (
                          <div className="mt-2.5 pt-3 border-t border-slate-850 flex flex-col gap-2">
                            <div className="p-3.5 bg-slate-950/60 border border-slate-850 rounded-xl flex flex-col gap-2.5 relative">
                              {/* User Understanding Snippet */}
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[9px] uppercase font-mono tracking-wider text-slate-555 font-bold">Your Understanding</span>
                                <p className="text-xs text-slate-400 italic">"{task.understanding}"</p>
                              </div>
                              
                              <hr className="border-slate-850/50" />

                              {/* System Explanation */}
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] uppercase font-mono tracking-wider text-blue-450 font-bold flex items-center gap-1">
                                  <Sparkles size={10} className="text-blue-400" />
                                  Expert Review & Explanation
                                </span>
                                <p className="text-xs text-slate-300 leading-relaxed font-medium">{task.explanation}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer Summary stats */}
              {tasks.length > 0 && (
                <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500 font-semibold relative z-10">
                  <span>{tasks.length} active tasks</span>
                  <span>{completedCount} / {tasks.length} completed</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Initialize shadow DOM container for scoping styles
const initKarmYogRoot = () => {
  const containerId = 'karm-yog-root';
  let container = document.getElementById(containerId);
  
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    
    container.style.position = 'fixed';
    container.style.zIndex = '2147483647';
    
    document.body.appendChild(container);

    // Create shadow DOM root
    const shadowRoot = container.attachShadow({ mode: 'open' });

    // Inject Tailwind Styles directly as a <style> block inside the Shadow DOM
    const styleTag = document.createElement('style');
    styleTag.textContent = shadowStyles;
    shadowRoot.appendChild(styleTag);

    // Create mounting div for React
    const reactMount = document.createElement('div');
    reactMount.id = 'karm-yog-react-root';
    shadowRoot.appendChild(reactMount);

    // Mount the React Application
    const root = createRoot(reactMount);
    root.render(
      <React.StrictMode>
        <RootModalManager />
      </React.StrictMode>
    );
  }
};

// Start injection check when script runs
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initKarmYogRoot);
} else {
  initKarmYogRoot();
}
