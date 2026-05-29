-- =====================================================================
-- Karm Yog — Consolidated Database Initialization & Security Migration
-- =====================================================================
-- Copy and paste this script directly into your Supabase Console SQL Editor
-- (Dashboard > Database > SQL Editor > New Query) and hit Run.
-- =====================================================================

-- ==========================================
-- 1. SCHEMAS: Core Tables
-- ==========================================

-- Tasks Table (Task lists and technical focus logs)
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    understanding TEXT,
    score INTEGER,
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Profiles Table (Stripe monetization and subscription flags)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL,
    is_premium BOOLEAN DEFAULT FALSE NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================
-- 2. SECURITY: Row-Level Security (RLS) & Policies
-- ==========================================

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Tasks Policies: Sandboxed CRUD operations limited strictly to the owner
CREATE POLICY "Users can only read their own tasks" 
  ON public.tasks FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own tasks" 
  ON public.tasks FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own tasks" 
  ON public.tasks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own tasks" 
  ON public.tasks FOR DELETE USING (auth.uid() = user_id);

-- Profiles Policies: Read-only access for owners. Manual client-side writes are banned.
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

-- ==========================================
-- 3. TRIGGERS: Automated Profile Provisioning on Auth Signup
-- ==========================================

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, is_premium)
  VALUES (NEW.id, NEW.email, FALSE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

-- ==========================================
-- 4. TRIGGERS: Postgres Anti-Spam Rate Limiter (AI Budget Protection)
-- ==========================================

CREATE OR REPLACE FUNCTION public.enforce_task_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  completion_count INT;
BEGIN
  -- Only execute if the task is being marked completed with technical feedback
  IF NEW.completed = true AND NEW.understanding IS NOT NULL AND (OLD.completed = false OR OLD.completed IS NULL) THEN
    
    -- Count completions by the current user in the last hour
    SELECT COUNT(*) INTO completion_count
    FROM public.tasks
    WHERE user_id = auth.uid()
      AND completed = true
      AND updated_at > NOW() - INTERVAL '1 hour';
      
    -- Raise an exception to block the database write if rate limit is exceeded
    IF completion_count >= 10 THEN
      RAISE EXCEPTION 'Rate limit exceeded: You can only submit 10 technical reviews per hour.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER tr_enforce_task_rate_limit
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_task_rate_limit();

-- ==========================================
-- 5. PERFORMANCE: Query Optimizations & Indexes
-- ==========================================

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON public.tasks (user_id);
CREATE INDEX IF NOT EXISTS tasks_completed_updated_idx ON public.tasks (user_id, completed, updated_at);

-- ==========================================
-- 6. BACKFILL: Provision profiles for any pre-existing users (Safe to run multiple times)
-- ==========================================

INSERT INTO public.profiles (id, email, is_premium)
SELECT id, email, FALSE
FROM auth.users
ON CONFLICT (id) DO NOTHING;
