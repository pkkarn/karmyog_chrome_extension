// Deno / Supabase Edge Function to evaluate user topic understanding using OpenAI
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS Preflight Requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log("Processing incoming Database Webhook...")
    const payload = await req.json()

    // 1. Verify that this is a valid row update or insert on public.tasks
    const record = payload.record
    if (!record || !record.id || !record.title) {
      console.warn("Invalid webhook payload received.")
      return new Response(JSON.stringify({ error: "Invalid record data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const { id, title, completed, understanding } = record

    // 2. Only process if the task is completed and has a user's understanding text
    if (!completed || !understanding || !understanding.trim()) {
      console.log(`Task ${id} "${title}" is not ready for evaluation (completed: ${completed}, has understanding: ${!!understanding}). Skipping.`)
      return new Response(JSON.stringify({ message: "Task is not ready for evaluation" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    console.log(`Evaluating task ${id}: "${title}"`)
    console.log(`User Understanding: "${understanding}"`)

    // 3. Initialize OpenAI Client using Deno environment variables
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiApiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable in Supabase Vault.")
    }

    // 4. Construct System Evaluation Prompt for GPT-4o-mini
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an elite, senior-level systems architect and technical interviewer. 
Evaluate the user's technical understanding of the topic provided.
You must return a JSON object with exactly two keys:
1. "score": An integer between 0 and 10 representing the depth and accuracy of their understanding. (0 = completely wrong/empty, 10 = absolute expert level understanding).
2. "explanation": A highly concise, 3-4 sentence professional explanation of the topic, correcting any flaws in their description and providing senior-level technical insights (such as trade-offs, architecture context, or scalability facts).

Return JSON format strictly:
{
  "score": number,
  "explanation": "string"
}`
          },
          {
            role: "user",
            content: `Topic: "${title}"\nUser's Description of their understanding: "${understanding}"`
          }
        ]
      })
    })

    if (!openAiResponse.ok) {
      const errText = await openAiResponse.text()
      throw new Error(`OpenAI API failed: ${errText}`)
    }

    const aiData = await openAiResponse.json()
    const aiResultString = aiData.choices[0]?.message?.content
    if (!aiResultString) {
      throw new Error("Empty response received from OpenAI.")
    }

    const { score, explanation } = JSON.parse(aiResultString)
    console.log(`AI Evaluation Completed. Score: ${score}/10`)

    // 5. Initialize Supabase Admin Client using service role key (bypasses RLS safely inside edge container)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase URL or Service Role Key in Edge container.")
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })

    // 6. Write evaluation back to the specific row in public.tasks
    const { error: updateError } = await supabaseAdmin
      .from('tasks')
      .update({
        score: parseInt(score) || 0,
        explanation: explanation || "Evaluation completed."
      })
      .eq('id', id)

    if (updateError) {
      throw new Error(`Failed to write evaluation back to DB: ${updateError.message}`)
    }

    console.log(`Successfully updated database row ${id} with evaluation.`)

    return new Response(JSON.stringify({ success: true, score, explanation }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })

  } catch (err: any) {
    console.error("Error in Edge Function execution:", err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})
