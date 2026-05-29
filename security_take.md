# 🛡️ Karm Yog — Security & Billing Audit Take

This log documents the active architectural safeguards, database triggers, and API billing caps configured to ensure the **Karm Yog** Chrome Extension is completely bulletproof against malicious hacks and billing exploits.

---

## 🔒 Implemented Security Safeguards

### 1. The Financial Safety Cap (OpenAI Hard Budget Limits)
- **Status:** **Active & Verified**
- **Configuration:** 
  - **Monthly Hard Budget Cap:** **`$5.00`** (Hard ceiling limit).
  - **Active Usage Warnings:** Configured at **50% (`$2.50`)** and **100% (`$5.00`)** monthly budget marks.
- **Architectural Safety:** Once total credit usage reaches $5.00, the OpenAI server instantly locks your API key, shutting down all request pathways and returning errors. **Your credit card can never be charged a single penny more than the $5.00 limit.**

### 2. Postgres Database Rate Limiting (Audit Control)
- **Status:** **Active & Bound**
- **SQL Implementation:** Added a database trigger function `enforce_task_rate_limit()` to the Postgres database:
  - Tracks task completion updates per unique user ID in a sliding **1-hour** window.
  - Blocks the transaction and raises an exception the moment a user attempts to complete more than **10 tasks per hour**.
- **Architectural Safety:** Since our AI edge function is called via database webhooks, blocking the task update at the Postgres layer stops the webhook from firing entirely. A malicious loop script will get blocked at the door on the 11th request, **safeguarding your OpenAI credit from spam.**

### 3. Database Row-Level Security (RLS)
- **Status:** **Enabled on all Tables**
- **Schema Gating:** Enforced RLS policies on the `tasks` and `profiles` tables:
  - Users are fully sandboxed. Standard clients connecting with public publishable `anon` keys can only view, insert, or delete data where `auth.uid() = user_id`.
  - Postgres automatically intercepts and appends these owner checks to every raw HTTP request.
- **Architectural Safety:** Bypasses any attempts at cross-user SQL injection or data theft. To the hacker, other users' task histories are completely invisible.

### 4. Zero Client-Side Secret Exposure (Vault Secrets)
- **Status:** **Server-Side Encapsulated**
- **Configuration:** Sensitive variables (`OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) are stored strictly inside the **Supabase Secrets Vault** on the cloud.
- **Architectural Safety:** The client-side extension package, content scripts, and Popup Javascript code contain zero backend credentials besides the public `anon` key. Your API keys are physically inaccessible to decompiling or reverse engineering.

### 5. Active Session & Cryptographic Token Verification
- **Status:** **Active on Handshake**
- **Implementation:** Content scripts do not trust stale session objects inside local storage. On startup and storage changes, they call `supabase.auth.setSession()` to verify token validity against the backend. Stale or tampered tokens are instantly wiped from local storage, forcing a UI lockout.
- **Deno JWT Auditing:** The Edge Function verifies the cryptographic signature of the user's JWT token, validating the caller's authentic identity before proceeding.

### 6. Stripe Premium Billing Gates ($5/Month Pricing)
- **Status:** **Active & White-Labeled**
- **Implementation:** 
  - Added a `profiles` table that tracks user subscription state. 
  - Provisioned automated Postgres triggers `on_auth_user_created` that default new sign-ups to the standard free tier (`is_premium = FALSE`).
  - Edge Functions query the `profiles` table first. If the caller is not premium, the function writes a custom locked reminder (`⭐ Premium subscription required...`) back to their database task list and **terminates immediately without calling OpenAI**, protecting your usage tier completely.
  - Webhooks deployed at `supabase/functions/stripe-webhook/` automatically capture Stripe payment events to activate premium features when a user buys a $5/month subscription.
