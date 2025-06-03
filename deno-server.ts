// main.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { config } from "https://deno.land/x/dotenv@v3.2.0/mod.ts";

// ─── 1) Load .env (only needed locally) ──────────────────────────────────────
config({ export: true });

// ─── 2) Import the default export from @sendgrid/mail via esm.sh ────────────
// (Notice we import it as `sgMail` so we can call `sgMail.setApiKey(...)` directly.)
import sgMail from "https://esm.sh/@sendgrid/mail@7.7.0?target=deno";

// ─── 3) Read required environment variables ─────────────────────────────────
const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "";

if (!SENDGRID_API_KEY) {
  console.error("❌ Missing SENDGRID_API_KEY in environment");
  Deno.exit(1);
}
if (!FROM_EMAIL) {
  console.error("❌ Missing FROM_EMAIL in environment");
  Deno.exit(1);
}

sgMail.setApiKey(SENDGRID_API_KEY);

// ─── 4) Types and Payload Validation ────────────────────────────────────────
interface EmailRequest {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

interface ReservationPayload {
  date: string;
  time: string;
  reservationNumber: string;
}

// If your endpoint accepts `{ date, time, reservationNumber }`, convert that into a SendGrid‐friendly object:
function validateReservationPayload(data: unknown): EmailRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (
    typeof obj.date !== "string" ||
    typeof obj.time !== "string" ||
    typeof obj.reservationNumber !== "string"
  ) {
    return null;
  }

  return {
    to: "szpila.mikolaj@gmail.com", // fixed internal recipient
    subject: `Rezerwacja nr ${obj.reservationNumber}`,
    text: [
      "Dzień dobry,",
      "",
      `Rezerwacja o dacie ${obj.date} i godzinie ${obj.time} została potwierdzona.`,
      "",
      "Autoresponder Cyklo2",
    ].join("\n"),
  };
}

// If you ever want a generic “to/subject/text/html” payload, you could add:
// function validateDirectEmailPayload(data: unknown): EmailRequest | null { … }

// ─── 5) JSON Response Helpers ────────────────────────────────────────────────
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

// ─── 6) Main HTTP handler ───────────────────────────────────────────────────
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS headers (only if you need cross‐origin from browsers)
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Health check
  if (path === "/" && method === "GET") {
    return new Response(
      JSON.stringify({
        message: "Deno + SendGrid Mail Server is up!",
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: corsHeaders },
    );
  }

  // POST /send-email
  if (path === "/send-email" && method === "POST") {
    try {
      const body = await req.json();
      // If you expect a reservation payload:
      const emailData = validateReservationPayload(body);
      if (!emailData) {
        return errorResponse(
          "Invalid payload. Expected fields: date (string), time (string), reservationNumber (string).",
          400,
        );
      }

      // Build the message object exactly as @sendgrid/mail expects:
      const msg: {
        to: string;
        from: string;
        subject: string;
        text?: string;
        html?: string;
      } = {
        to: emailData.to,
        from: FROM_EMAIL,
        subject: emailData.subject,
      };
      if (emailData.text) msg.text = emailData.text;
      if (emailData.html) msg.html = emailData.html;

      // Send the email
      await sgMail.send(msg);

      return new Response(
        JSON.stringify({ success: true, message: "Email sent" }),
        { status: 200, headers: corsHeaders },
      );
    } catch (err) {
      console.error("Error in /send-email:", err);
      // If SendGrid returns an error, `err` might be a Response or an Error.
      const errorMsg =
        err instanceof Error ? err.message : JSON.stringify(err);
      return errorResponse(`Failed to send email: ${errorMsg}`, 500);
    }
  }

  return errorResponse("Route not found", 404);
}

// ─── 7) Start the server ─────────────────────────────────────────────────────
const port = parseInt(Deno.env.get("PORT") ?? "8000", 10);
console.log(`🚀 Starting on https://localhost:${port}`);
serve(handler, { port });
