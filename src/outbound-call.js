import ngrok from "@ngrok/ngrok";
import express from "express";
import { createServer } from "http";
import twilio from "twilio";
import WebSocket, { WebSocketServer } from "ws";
import {
  OPENAI_API_KEY,
  PORT,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} from "./config/env.config.js";
import {
  LOG_EVENT_TYPES,
  SYSTEM_MESSAGE,
  VOICE,
} from "./constants/constants.js";
import executeFunction from "./utils/execute.js";
import { process_order_definition } from "./utils/processOrder.js";
import { search_product_definition } from "./utils/searchProduct.js";

async function makeCall(to, req) {
  try {
    const call = await client.calls.create({
      from: TWILIO_PHONE_NUMBER,
      to,
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Amy-Neural">
            Hello! This is your AI assistant calling. How can I help you today?
          </Say><Connect><Stream url="wss://${req.headers.host}/stream" /></Connect></Response>`,
    });
    console.log(`Call started with SID: ${call.sid}`);
    return call.sid;
  } catch (error) {
    console.error("Error making call:", error);
  }
}

// Initialize the Twilio library and set our outgoing call TwiML
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Initialize express app
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
  const callerId = await makeCall(req.body.to, req);
  res.json({ success: true, callerId });
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
        tool_choice: "auto",
        tools: [process_order_definition, search_product_definition],
      },
    };

    console.log("Sending session update:", JSON.stringify(sessionUpdate));
    openAiWs.send(JSON.stringify(sessionUpdate));
  };

  openAiWs.on("open", () => {
    console.log("Connected to the OpenAI Realtime API");
    setTimeout(sendInitialSessionUpdate, 100); // Ensure connection stability, send after .1 second
  });

  // Add a map to store user messages by item_id
  const userMessageMap = new Map();
  let lastMessageId = null;

  // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
  openAiWs.on("message", async (data) => {
    try {
      const response = JSON.parse(data);

      if (LOG_EVENT_TYPES.includes(response.type)) {
        console.log(`Received event: ${response.type}`, response);
      }

      if (response.type === "session.updated") {
        console.log("Session updated successfully:", response);
      }

      // When receiving a user message, store its ID
      if (
        response.type === "conversation.item.created" &&
        response.item?.type === "message" &&
        response.item?.role === "user"
      ) {
        lastMessageId = response.item.id;
      }

      // When receiving a transcript update
      if (
        response.type === "response.audio_transcript.done" &&
        response.item_id === lastMessageId &&
        response.transcript
      ) {
        userMessageMap.set(lastMessageId, response.transcript);
      }

      if (response.type === "response.function_call_arguments.done") {
        console.log("Received function call arguments:", response);
        let result = await executeFunction(response);

        const response_message = {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: streamSid,
            output: result["result"],
          },
        };

        openAiWs.send(JSON.stringify(response_message));

        // Get the user's message using the call_id
        const userMessage = userMessageMap.get(response.call_id) || "";
        console.log(`User said: ${userMessage}`);
        let instructions = `
          Respond to the user's question based on this information:
          === 
          ${result["result"]}. 
          ===
          Be concise and friendly.
        `;
        console.log("Generate audio response:", instructions);

        const response_create = {
          type: "response.create",
          response: {
            modalities: ["text", "audio"],
            instructions: instructions,
          },
        };
        openAiWs.send(JSON.stringify(response_create));

        // Optionally, clean up the stored message
        userMessageMap.delete(response.call_id);
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
