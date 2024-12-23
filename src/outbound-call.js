import twilio from "twilio";
import WebSocket from "ws";
import ngrok from "@ngrok/ngrok";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { SYSTEM_MESSAGE, VOICE, LOG_EVENT_TYPES } from "./constants.js";
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  OPENAI_API_KEY,
  PORT,
} from "./config.js";

// Function to make an outbound call
async function makeCall(to, req) {
  try {
    //todo:for now make number constant
    // const isAllowed = await isNumberAllowed(to);
    // if (!isAllowed) {
    //   console.warn(
    //     `The number ${to} is not recognized as a valid outgoing number or caller ID.`
    //   );
    //   process.exit(1);
    // }

    const call = await client.calls.create({
      from: TWILIO_PHONE_NUMBER,
      to,
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Amy-Neural">
            Hello! This is your AI assistant calling. How can I help you today?
          </Say><Connect><Stream url="wss://${req.headers.host}/stream" /></Connect></Response>`,
    });
    console.log(`Call started with SID: ${call.sid}`);
  } catch (error) {
    console.error("Error making call:", error);
  }
}

// Initialize the Twilio library and set our outgoing call TwiML
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Initialize Fastify
const app = express();
const server = createServer(app);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint to trigger an outbound call
app.post("/make-call", async (req, res) => {
  if (!req.body.to) {
    res.status(400).json({ error: "Missing to parameter" });
    return;
  }
  makeCall(req.body.to, req);
  res.json({ success: true });
});

// WebSocket server setup
const wss = new WebSocketServer({
  server,
  path: "/stream",
});

wss.on("connection", async (ws) => {
  console.log("Client connected");

  const openAiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  let streamSid = null;

  const sendInitialSessionUpdate = () => {
    const sessionUpdate = {
      type: "session.update",
      session: {
        turn_detection: { type: "server_vad" },
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: VOICE,
        instructions: SYSTEM_MESSAGE,
        modalities: ["text", "audio"],
        temperature: 0.8,
      },
    };

    console.log("Sending session update:", JSON.stringify(sessionUpdate));
    openAiWs.send(JSON.stringify(sessionUpdate));

    const initialConversationItem = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: 'Greet the user with "Hello there! I\'m an AI voice assistant from Palmmind Realtime API. How can I help?"',
          },
        ],
      },
    };

    // openAiWs.send(JSON.stringify(initialConversationItem));
    openAiWs.send(JSON.stringify({ type: "response.create" }));
  };

  openAiWs.on("open", () => {
    console.log("Connected to the OpenAI Realtime API");
    setTimeout(sendInitialSessionUpdate, 100); // Ensure connection stability, send after .1 second
  });

  // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
  openAiWs.on("message", (data) => {
    try {
      const response = JSON.parse(data);

      if (LOG_EVENT_TYPES.includes(response.type)) {
        console.log(`Received event: ${response.type}`, response);
      }

      if (response.type === "session.updated") {
        console.log("Session updated successfully:", response);
      }

      if (response.type === "response.audio.delta" && response.delta) {
        const audioDelta = {
          event: "media",
          streamSid: streamSid,
          media: {
            payload: Buffer.from(response.delta, "base64").toString("base64"),
          },
        };
        ws.send(JSON.stringify(audioDelta));
      }
    } catch (error) {
      console.error(
        "Error processing OpenAI message:",
        error,
        "Raw message:",
        data
      );
    }
  });

  ws.on("message", async (data) => {
    try {
      const dataReceived = JSON.parse(data);

      switch (dataReceived.event) {
        case "media":
          if (openAiWs.readyState === WebSocket.OPEN) {
            const audioAppend = {
              type: "input_audio_buffer.append",
              audio: dataReceived.media.payload,
            };

            openAiWs.send(JSON.stringify(audioAppend));
          }
          break;
        case "start":
          streamSid = dataReceived.start.streamSid;
          console.log("Incoming stream has started", streamSid);
          break;
        default:
          console.log("Received non-media event:", dataReceived.event);
          break;
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on("close", () => {
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
    console.log("Client disconnected.");
  });

  openAiWs.on("close", () => {
    console.log("Disconnected from the OpenAI Realtime API");
  });

  openAiWs.on("error", (error) => {
    console.error("Error in the OpenAI WebSocket:", error);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Set up ngrok tunnel
// TWILIO DONT WORK WITH LOCALHOST SO USE NGROK
ngrok
  .connect({ addr: PORT, authtoken_from_env: true })
  .then((listener) => console.log(`Ingress established at: ${listener.url()}`));
