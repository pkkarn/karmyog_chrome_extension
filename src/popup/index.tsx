import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Trash2, CheckCircle, Circle, Plus, ListTodo, Flame, LogOut, Key, Mail, UserPlus, AlertCircle, Sparkles, Send, BookOpen } from 'lucide-react';
import { supabase } from '../supabaseClient';
import '../index.css';

interface Task {
  id: string;
  title: string;
  completed: boolean;
  understanding?: string;
  score?: number;
  explanation?: string;
  createdAt: number;
}

const Popup: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newText, setNewText] = useState('');
  const [session, setSession] = useState<any>(null);

  // Auth States
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // In-Popup Feedback & AI States (Matches Content Script)
  const [activeFeedbackId, setActiveFeedbackId] = useState<string | null>(null);
  const [understandingText, setUnderstandingText] = useState('');
  const [analyzingTaskId, setAnalyzingTaskId] = useState<string | null>(null);
  const [viewExplanationId, setViewExplanationId] = useState<string | null>(null);

  // 1. Listen for Supabase Session and local Sync
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      updateSessionStorage(session);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      updateSessionStorage(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Write session to chrome.storage.local so the content script can read it!
  const updateSessionStorage = (session: any) => {
    chrome.storage.local.set({ supabaseSession: session ? {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user_id: session.user.id,
      email: session.user.email
    } : null });
  };

  // Trigger cross-context database sync (tells other frames to refetch)
  const triggerGlobalSync = () => {
    chrome.storage.local.set({ tasksLastSynced: Date.now() });
  };

  // 2. Fetch tasks based on login status & listen for global refetch triggers
  useEffect(() => {
    fetchTasks();

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      // Online mode: refetch from Supabase whenever any tab triggers tasksLastSynced
      if (changes.tasksLastSynced && session) {
        fetchTasks();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [session]);

  const fetchTasks = async () => {
    if (session) {
      // Authenticated Mode: Fetch from Supabase
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

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setAuthError('Sign up successful! Please check your email for confirmation.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    updateSessionStorage(null);
    setTasks([]);
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim() || !session) return;

    const { error } = await supabase
      .from('tasks')
      .insert([{
        title: newText.trim(),
        user_id: session.user.id,
        completed: false
      }]);

    if (error) {
      console.error('Error adding task to Supabase:', error);
    } else {
      fetchTasks();
      triggerGlobalSync(); // Trigger active tab refetch
    }
    setNewText('');
  };

  // Toggle task completed state
  const handleToggleClick = async (task: Task) => {
    if (!session) return;

    if (task.completed) {
      // Clear all AI review data from Supabase
      const { error } = await supabase
        .from('tasks')
        .update({ completed: false, understanding: null, score: null, explanation: null })
        .eq('id', task.id);

      if (error) {
        console.error('Error resetting task in Supabase:', error);
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

  // Skip AI
  const skipAIEvaluation = async (id: string) => {
    if (!session) return;

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

  // Submit feedback
  const submitFeedback = async (id: string) => {
    if (!understandingText.trim() || !session) return;

    setAnalyzingTaskId(id);
    setActiveFeedbackId(null);

    // CRITICAL: Immediately clear out any cached/old AI results from local memory
    // so that the old score/explanation disappears instantly during the analyzing phase.
    setTasks((prev) =>
      prev.map((t) => t.id === id ? { ...t, score: undefined, explanation: undefined, understanding: undefined } : t)
    );

    // Write user understanding to Supabase
    const { error } = await supabase
      .from('tasks')
      .update({
        completed: true,
        understanding: understandingText.trim(),
        score: null,       // Reset in DB to let Edge Function overwrite cleanly
        explanation: null  // Reset in DB to let Edge Function overwrite cleanly
      })
      .eq('id', id);

    if (error) {
      console.error('Error writing feedback to Supabase:', error);
      setAnalyzingTaskId(null);
    } else {
      triggerGlobalSync(); // Trigger active tab refetch to show analyzing skeleton

      // Poll for AI results
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
          triggerGlobalSync(); // Sync back finished results to active tab
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
    if (!session) return;

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
    <div className="flex flex-col min-h-[460px] w-full p-4 relative overflow-hidden bg-slate-950 text-slate-100 select-none font-sans">
      {/* Ambient background lights */}
      <div className="absolute -top-32 -left-32 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-56 h-56 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl shadow-md shadow-blue-500/10">
            <Flame size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              KARM YOG
            </h1>
            <p className="text-[9px] text-slate-505 font-semibold font-mono uppercase">V1.0 • Unified Workspace</p>
          </div>
        </div>
        
        {session && (
          <button 
            onClick={handleLogOut}
            className="p-1.5 bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-lg text-slate-400 hover:text-rose-450 transition-all cursor-pointer"
            title="Log Out"
          >
            <LogOut size={13} />
          </button>
        )}
      </header>

      {/* --- AUTHENTICATION SCREEN --- */}
      {!session ? (
        <div className="flex-1 flex flex-col justify-center relative z-10 py-2">
          <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-4 backdrop-blur-md">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-1.5">
              <Key size={12} className="text-blue-400" />
              {isSignUp ? 'Create Workspace' : 'Sync Workspace'}
            </h2>

            <form onSubmit={handleAuth} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <div className="relative">
                  <Mail size={12} className="absolute left-3.5 top-3 text-slate-550" />
                  <input
                    type="email"
                    required
                    placeholder="Email Address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-850 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-555 focus:outline-none focus:border-blue-500/40 transition-all"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="relative">
                  <Key size={12} className="absolute left-3.5 top-3 text-slate-550" />
                  <input
                    type="password"
                    required
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-850 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-555 focus:outline-none focus:border-blue-500/40 transition-all"
                  />
                </div>
              </div>

              {authError && (
                <div className={`p-2.5 rounded-xl border text-[10px] flex items-center gap-1.5 ${
                  authError.includes('successful')
                    ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400'
                    : 'bg-rose-950/20 border-rose-500/20 text-rose-450'
                }`}>
                  <AlertCircle size={12} className="flex-shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 mt-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 transition-all cursor-pointer shadow-lg shadow-blue-500/10 flex justify-center items-center gap-1.5"
              >
                {isSignUp ? <UserPlus size={13} /> : <Key size={13} />}
                {authLoading ? 'Connecting...' : isSignUp ? 'Register' : 'Connect Workspace'}
              </button>
            </form>

            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setAuthError(null);
              }}
              className="w-full text-center text-[10px] text-slate-500 hover:text-slate-400 mt-4 transition-colors font-medium cursor-pointer"
            >
              {isSignUp ? 'Already have a workspace? Log In' : "Don't have a workspace? Sign Up"}
            </button>
          </div>
        </div>
      ) : (
        // --- AUTHENTICATED ACTIVE TASK MANAGER ---
        <>
          {/* Quick Add Form */}
          <form onSubmit={handleAddTask} className="flex gap-2 mb-4 relative z-10">
            <input
              type="text"
              placeholder="Add a synced task..."
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-850 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-all shadow-inner"
            />
            <button
              type="submit"
              disabled={!newText.trim()}
              className="p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl flex items-center justify-center transition-colors shadow-lg shadow-blue-500/10 cursor-pointer"
            >
              <Plus size={16} />
            </button>
          </form>

          {/* Task List Section */}
          <main className="flex-1 flex flex-col gap-2 relative z-10 overflow-y-auto max-h-[260px] pr-1">
            {tasks.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-4 rounded-2xl bg-slate-900/10 border border-slate-900/40">
                <ListTodo size={32} className="text-slate-700 mb-3" />
                <p className="text-xs font-semibold text-slate-400">No synced tasks</p>
                <p className="text-[10px] text-slate-650 mt-1 max-w-[200px] leading-relaxed">
                  Press <span className="font-mono text-blue-400">Opt+Shift+T</span> on any tab to capture and sync tasks to Supabase.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-col gap-2 px-3 py-2.5 rounded-xl border border-slate-900/60 hover:border-slate-850 bg-slate-900/30 hover:bg-slate-900/55 transition-all duration-200 group"
                  >
                    {/* Task row details */}
                    <div className="flex items-center justify-between gap-3">
                      <div 
                        onClick={() => handleToggleClick(task)}
                        className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                      >
                        <button className="text-slate-500 hover:text-blue-400 transition-colors flex-shrink-0 cursor-pointer">
                          {task.completed ? (
                            <CheckCircle size={16} className="text-emerald-500" />
                          ) : (
                            <Circle size={16} className="text-slate-600 group-hover:text-blue-400" />
                          )}
                        </button>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span 
                            className={`text-xs font-semibold truncate select-text transition-all ${
                              task.completed ? 'text-slate-500 line-through font-normal' : 'text-slate-300 group-hover:text-white'
                            }`}
                          >
                            {task.title}
                          </span>
                          
                          {/* Score and Review explanation toggle inside Popup */}
                          {task.completed && task.score !== undefined && task.score !== null && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[9px] font-mono text-blue-400 font-bold flex items-center gap-0.5">
                                <Sparkles size={9} />
                                Score: {task.score}/10
                              </span>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewExplanationId((prev) => prev === task.id ? null : task.id);
                                }}
                                className="flex items-center gap-0.5 text-[9px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                              >
                                <BookOpen size={9} />
                                {viewExplanationId === task.id ? 'Hide' : 'Review'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-605 hover:text-rose-500 transition-all duration-150 p-1 hover:bg-slate-800/40 rounded-lg flex-shrink-0 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* --- INLINE FEEDBACK INPUT IN POPUP --- */}
                    {activeFeedbackId === task.id && (
                      <div className="mt-2 pt-2 border-t border-slate-900 flex flex-col gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold text-slate-450 flex items-center gap-0.5">
                            <Sparkles size={9} className="text-blue-400" />
                            Summarize your understanding:
                          </label>
                          <textarea
                            placeholder="Type what you know about this topic..."
                            value={understandingText}
                            onChange={(e) => setUnderstandingText(e.target.value)}
                            rows={2}
                            className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-[10px] text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500/40"
                          />
                        </div>

                        <div className="flex justify-between items-center gap-2">
                          <button
                            onClick={() => skipAIEvaluation(task.id)}
                            className="text-[9px] text-slate-550 hover:text-slate-400 transition-colors cursor-pointer"
                          >
                            Skip AI
                          </button>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setActiveFeedbackId(null)}
                              className="px-2.5 py-1 rounded-md border border-slate-850 hover:bg-slate-900 text-[9px] font-semibold text-slate-400 cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => submitFeedback(task.id)}
                              disabled={!understandingText.trim()}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white text-[9px] font-bold shadow-md cursor-pointer"
                            >
                              <Send size={8} />
                              Submit
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* --- ANALYZING LOADER IN POPUP --- */}
                    {analyzingTaskId === task.id && (
                      <div className="mt-2 pt-2 border-t border-slate-900 flex flex-col gap-1.5 animate-pulse">
                        <div className="flex items-center gap-1 text-[9px] font-medium text-blue-400">
                          <Sparkles size={10} className="animate-spin" />
                          <span>AI is evaluating understanding...</span>
                        </div>
                        <div className="h-3 bg-slate-900/60 rounded-md w-full" />
                      </div>
                    )}

                    {/* --- COLLAPSIBLE REVIEW EXPLANATION IN POPUP --- */}
                    {task.completed && viewExplanationId === task.id && task.explanation && (
                      <div className="mt-2 pt-2 border-t border-slate-900">
                        <div className="p-2.5 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col gap-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[8px] uppercase font-mono tracking-wider text-slate-550 font-bold">Your Explanation</span>
                            <p className="text-[10px] text-slate-400 italic">"{task.understanding}"</p>
                          </div>
                          
                          <hr className="border-slate-900" />

                          <div className="flex flex-col gap-0.5">
                            <span className="text-[8px] uppercase font-mono tracking-wider text-blue-450 font-bold flex items-center gap-0.5">
                              <Sparkles size={8} className="text-blue-400" />
                              Expert Explanation
                            </span>
                            <p className="text-[10px] text-slate-350 leading-relaxed font-medium">{task.explanation}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </main>

          {/* Footer Stats & Account Info */}
          <footer className="mt-4 pt-3 border-t border-slate-900 flex justify-between items-center text-[9px] text-slate-505 font-semibold relative z-10">
            <span className="truncate max-w-[150px] font-mono text-slate-600" title={session.user.email}>
              {session.user.email}
            </span>
            <span>{completedCount}/{tasks.length} completed</span>
          </footer>
        </>
      )}
    </div>
  );
};

// Mount App
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>
  );
}
