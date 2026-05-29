import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import Stripe from "https://esm.sh/stripe@14.15.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing Stripe Signature", { status: 400 });
  }

  try {
    const rawBody = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
    
    // Verify the webhook event signature securely
    const event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret
    );

    console.log(`🔔 Stripe Webhook received event: ${event.type}`);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id || session.metadata?.user_id;
      const stripeCustomerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (userId) {
        // Activate Premium access for this user
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({
            is_premium: true,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: subscriptionId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        if (error) {
          console.error(`❌ DB Update Error: ${error.message}`);
          return new Response("Database Error", { status: 500 });
        }
        console.log(`✅ Activated Premium for user: ${userId}`);
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const stripeCustomerId = subscription.customer as string;
      const isPremiumActive = ["active", "trialing"].includes(subscription.status);

      // Query database for user matching customer ID
      const { data: profile, error: fetchErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", stripeCustomerId)
        .single();

      if (fetchErr || !profile) {
        console.error(`❌ Could not locate profile for customer: ${stripeCustomerId}`);
      } else {
        const { error: updateErr } = await supabaseAdmin
          .from("profiles")
          .update({
            is_premium: isPremiumActive,
            stripe_subscription_id: subscription.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", profile.id);

        if (updateErr) {
          console.error(`❌ DB Update Error: ${updateErr.message}`);
        } else {
          console.log(`🔄 Updated Premium status to ${isPremiumActive} for user: ${profile.id}`);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
});
