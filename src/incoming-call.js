import express from "express";
import { createServer } from "http";
import twilio from "twilio";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import dotenv from "dotenv";
import ngrok from "@ngrok/ngrok";
import { Readable } from "stream";

dotenv.config();

const app = express();
const server = createServer(app);

// Initialize clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint to trigger an outbound call
app.post("/make-call", async (req, res) => {
  try {
    const call = await twilioClient.calls.create({
      twiml: `
        <Response>
          <Say voice="Polly.Amy-Neural">
            Hello! This is your AI assistant calling. How can I help you today?
          </Say>
          <Connect>
            <Stream url="wss://${req.headers.host}/stream" />
          </Connect>
        </Response>
      `,
      to: process.env.TARGET_PHONE_NUMBER,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    console.log("Outbound call initiated:", call.sid);
    res.json({ success: true, callSid: call.sid });
  } catch (error) {
    console.error("Error making call:", error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket server setup
const wss = new WebSocketServer({
  server,
  path: "/stream",
});

wss.on("connection", async (ws) => {
  console.log("Call connected to AI assistant");

  let conversation = [
    {
      role: "system",
      content:
        "You are a helpful voice assistant. Keep responses concise and natural.",
    },
  ];

  // Handle WebSocket errors
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  // Handle WebSocket closure
  ws.on("close", () => {
    console.log("WebSocket connection closed");
  });

  ws.on("message", async (data) => {
    try {
      // Create a readable stream from the audio data
      const audioStream = new Readable();
      audioStream.push(data);
      audioStream.push(null);

      // Convert speech to text
      const transcript = await openai.audio.transcriptions.create({
        file: audioStream,
        model: "whisper-1",
      });

      console.log("User said:", transcript.text);

      // Get AI response
      conversation.push({ role: "user", content: transcript.text });

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: conversation,
        max_tokens: 100,
      });

      const aiResponse = completion.choices[0].message.content;
      console.log("AI response:", aiResponse);

      conversation.push({ role: "assistant", content: aiResponse });

      // Convert to speech and send
      const speech = await openai.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: aiResponse,
      });

      const audioBuffer = Buffer.from(await speech.arrayBuffer);
      ws.send(audioBuffer);
    } catch (error) {
      console.error("Error in message handling:", error);
      try {
        const errorSpeech = await openai.audio.speech.create({
          model: "tts-1",
          voice: "alloy",
          input:
            "I'm sorry, I encountered an error. Could you please try again?",
        });
        const errorBuffer = Buffer.from(await errorSpeech.arrayBuffer);
        ws.send(errorBuffer);
      } catch (speechError) {
        console.error("Error creating error message speech:", speechError);
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

ngrok
  .connect({ addr: PORT, authtoken_from_env: true })
  .then((listener) => console.log(`Ingress established at: ${listener.url()}`));
