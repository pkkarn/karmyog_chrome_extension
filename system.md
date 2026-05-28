# Project Karm Yog: System Design & Architecture

This document outlines the architecture and system design for building a premium, scalable Chrome Extension designed to handle 10,000+ users. It incorporates Authentication, Payments, and AI Integration, alongside the specific features requested.

---

## 1. Technology Stack

To ensure scalability, developer experience, and a premium feel, we will use the following modern stack:

### Extension Frontend (Client)
*   **Framework:** React 18+ powered by Vite. (Vite + custom sequential `build.js` compiler handles Popup, Content, and Background contexts with zero code-splitting issues in isolated browser scopes).
*   **Styling:** Tailwind CSS + Framer Motion. Styling is inlined directly as a compiled CSS string inside the Shadow DOM container in the content script to bypass CORS, CSP, and `web_accessible_resources` blocks.
*   **State Management:** Zustand (lightweight, unopinionated state management).
*   **Storage:** `chrome.storage.local` for temporary task capture and caching. Supabase PostgreSQL for persistent database synchronization.

### Serverless Backend & Database (Supabase Ecosystem)
Instead of running a separate Express or Next.js server, we use a fully serverless, event-driven backend built entirely on the **Supabase** ecosystem:
*   **Database:** Supabase PostgreSQL (handles users, tasks, scores, and explanations).
*   **Authentication:** Supabase Auth (integrated into the extension popup for signup/login).
*   **Database Triggers & Webhooks:** PostgreSQL triggers detect when a task is marked completed and has a user's understanding text. It automatically invokes our Edge Function via a Database Webhook.
*   **Edge Functions:** **Supabase Edge Functions** (written in TypeScript, running on Deno at the Edge). This securely executes OpenAI API calls using credentials stored in Supabase environment variables.
*   **AI Integration:** OpenAI API (`gpt-4o-mini`) via Edge Functions to evaluate and score user understanding.

---

## 2. System Architecture

The system is divided into two primary environments:

```
[ Chrome Extension ] 
       │ (Sends authenticated queries with JWT)
       ▼
[ Supabase Project ] 
  ├── Auth (JWT & Row-Level Security)
  ├── PostgreSQL DB (Stores tasks, understanding, score, and explanations)
  │     │ 
  │     └── (PostgreSQL Trigger on UPDATE)
  ▼
[ Supabase Edge Function ] 
       │ (Invokes securely with OPENAI_API_KEY)
       ▼
[ OpenAI API ] 
```

### Flow of the AI Evaluation System:
1.  **User Complete Action:** User marks a task (e.g., "AWS SQS") as complete inside the extension.
2.  **In-Page Feedback Form:** The extension detects this and slides open a beautiful glassmorphic text area: *"Explain your understanding of AWS SQS."*
3.  **Submission:** User submits their response. The Chrome extension writes this to Supabase:
    ```json
    {
      "id": "task-uuid",
      "completed": true,
      "understanding": "SQS is a fully managed message queuing service..."
    }
    ```
4.  **Database Trigger:** PostgreSQL detects that `completed = true` and `understanding` is not null. It automatically triggers a database webhook.
5.  **Edge Function Execution (`analyze-understanding`):**
    *   Fired securely inside Supabase Edge.
    *   Constructs a highly detailed prompt:
        > "As an elite systems architect, evaluate the following user understanding of the topic '<title>'.
        > User Understanding: '<understanding>'
        > Score their understanding on a scale of 0 to 10.
        > Provide a concise, highly accurate explanation of the topic.
        > Return the response strictly as JSON with keys: 'score' and 'explanation'."
    *   Calls `gpt-4o-mini`.
    *   Parses the JSON response.
6.  **Writeback:** The Edge Function writes the `score` and `explanation` directly back to that database row.
7.  **Real-Time Sync:** The Chrome extension (listening via Supabase Realtime or standard sync) instantly updates the UI to show: *"Score: 8/10. Here is the correct explanation..."*

---

## 3. Detailed Database Schema

### Table: `tasks`
*   `id`: `uuid` (Primary Key, default `gen_random_uuid()`)
*   `user_id`: `uuid` (Foreign Key referencing `auth.users`, cascades on delete)
*   `title`: `text` (The topic, e.g. "AWS SQS")
*   `completed`: `boolean` (default `false`)
*   `understanding`: `text` (Nullable - filled when marked complete)
*   `score`: `integer` (Nullable - populated by AI Edge function, range 0-10)
*   `explanation`: `text` (Nullable - populated by AI Edge function, correct system summary)
*   `created_at`: `timestamp with time zone` (default `now()`)

### Row-Level Security (RLS) Policies
*   **Enable RLS:** `ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;`
*   **Select Policy:** `CREATE POLICY "Users can only read their own tasks" ON tasks FOR SELECT USING (auth.uid() = user_id);`
*   **Insert Policy:** `CREATE POLICY "Users can only create their own tasks" ON tasks FOR INSERT WITH CHECK (auth.uid() = user_id);`
*   **Update Policy:** `CREATE POLICY "Users can only edit their own tasks" ON tasks FOR UPDATE USING (auth.uid() = user_id);`
*   **Delete Policy:** `CREATE POLICY "Users can only delete their own tasks" ON tasks FOR DELETE USING (auth.uid() = user_id);`

---

## 4. Implementation Strategy

### Phase 1: Foundation & Task Management (Complete)
*   Scaffolded Vite + React extension with custom sequential compilation (`build.js`).
*   Configured global hotkeys:
    *   `Option + Shift + T` (Quick task capture form)
    *   `Option + Shift + V` (Floating workspace task list manager)
*   Inlined styles directly to Shadow DOM to prevent CSS leaks.

### Phase 2: In-Page Feedback UI & Local Flow
*   Add local "Mark Completed" trigger which shows a gorgeous text input area inside the Shadow DOM checklist.
*   Allow testing the flow locally with simulated AI delays.

### Phase 3: Supabase Auth & DB Setup
*   Initialize Supabase project.
*   Create `tasks` table with correct columns, Triggers, and RLS policies.
*   Integrate Supabase Auth inside the Chrome extension popup (Login / Registration form).
*   Sync local tasks to Supabase when authenticated.

### Phase 4: Edge Function & AI Integration
*   Write Deno-based Supabase Edge Function (`analyze-understanding`) using OpenAI SDK.
*   Store `OPENAI_API_KEY` securely in Supabase environment variables.
*   Enable PostgreSQL database webhook to trigger the Edge function on row updates.
*   Provide a premium UI finish displaying the scores and standard explanations.

---
*Document updated with Serverless Edge architecture decisions.*
