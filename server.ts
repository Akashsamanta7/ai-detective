import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB Schema
const roomSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  mode: { type: String, required: true },
  data: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 * 365 } // Auto-delete after 365 days of inactivity
});

const Room = mongoose.model("Room", roomSchema);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri);
      console.log("Connected to MongoDB Cloud");
    } catch (err) {
      console.error("MongoDB connection error:", err);
    }
  } else {
    console.warn("MONGODB_URI not found. Persistence will not work on Render free tier.");
  }

  app.use(express.json());

  // API Route to provide keys to the client (safely filtered)
  app.get("/api/config/keys", (req, res) => {
    const keys: string[] = [];
    if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
    
    // Check for both VITE_ and non-VITE versions for flexibility
    for (let i = 1; i <= 20; i++) {
      const key = process.env[`GEMINI_API_KEY_${i}`] || process.env[`VITE_GEMINI_API_KEY_${i}`];
      if (key) keys.push(key);
    }
    res.json({ keys: Array.from(new Set(keys.filter(k => k.trim() !== ""))) });
  });

  // API Routes
  app.post("/api/rooms", async (req, res) => {
    const { code, mode, data } = req.body;
    try {
      const newRoom = new Room({ code, mode, data });
      await newRoom.save();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create room" });
    }
  });

  app.get("/api/rooms/:code", async (req, res) => {
    try {
      const room = await Room.findOne({ code: req.params.code });
      if (room) {
        res.json(room);
      } else {
        res.status(404).json({ error: "Room not found" });
      }
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/rooms/:code", async (req, res) => {
    const { data } = req.body;
    try {
      await Room.findOneAndUpdate(
        { code: req.params.code }, 
        { data, createdAt: new Date() } // Refresh the TTL timer on every update
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update room" });
    }
  });

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res, next) => {
      // Skip API routes
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // WebSocket Setup
  const wss = new WebSocketServer({ server });
  const clients = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const code = url.searchParams.get("code");

    if (!code) {
      ws.close();
      return;
    }

    if (!clients.has(code)) {
      clients.set(code, new Set());
    }
    clients.get(code)!.add(ws);

    ws.on("message", (message) => {
      const data = JSON.parse(message.toString());
      // Broadcast to other clients in the same room
      const roomClients = clients.get(code);
      if (roomClients) {
        roomClients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      }
    });

    ws.on("close", () => {
      const roomClients = clients.get(code);
      if (roomClients) {
        roomClients.delete(ws);
        if (roomClients.size === 0) {
          clients.delete(code);
        }
      }
    });
  });
}

startServer();
