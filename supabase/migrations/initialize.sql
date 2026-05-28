-- Karm Yog Database Initialization Script
-- Copy and paste this script into your Supabase SQL Editor (Dashboard > SQL Editor > New Query) and hit Run.

-- 1. Create Tasks Table
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    understanding TEXT,
    score INTEGER,
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row-Level Security (RLS)
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- Allow users to view only their own tasks
CREATE POLICY "Users can only read their own tasks" 
ON public.tasks 
FOR SELECT 
USING (auth.uid() = user_id);

-- Allow users to insert only their own tasks
CREATE POLICY "Users can only insert their own tasks" 
ON public.tasks 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Allow users to update only their own tasks
CREATE POLICY "Users can only update their own tasks" 
ON public.tasks 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow users to delete only their own tasks
CREATE POLICY "Users can only delete their own tasks" 
ON public.tasks 
FOR DELETE 
USING (auth.uid() = user_id);

-- 4. Create Index on user_id for faster queries at scale
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON public.tasks (user_id);
