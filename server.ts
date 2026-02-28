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

// Temporary memory fallback for local testing without MongoDB
const localRooms = new Map<string, any>();

// MongoDB Schema
const roomSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  mode: { type: String, required: true },
  data: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 * 7 } // Auto-delete after 7 days
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
    console.warn("MONGODB_URI not found. Using local memory fallback for testing.");
  }

  app.use(express.json());

  // API Routes
  app.post("/api/rooms", async (req, res) => {
    const { code, mode, data } = req.body;
    try {
      if (mongoose.connection.readyState === 1) {
        const newRoom = new Room({ code, mode, data });
        await newRoom.save();
      } else {
        localRooms.set(code, { code, mode, data });
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create room" });
    }
  });

  app.get("/api/rooms/:code", async (req, res) => {
    try {
      let room;
      if (mongoose.connection.readyState === 1) {
        room = await Room.findOne({ code: req.params.code });
      } else {
        room = localRooms.get(req.params.code);
      }

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
      if (mongoose.connection.readyState === 1) {
        await Room.findOneAndUpdate({ code: req.params.code }, { data });
      } else {
        const room = localRooms.get(req.params.code);
        if (room) {
          room.data = data;
          localRooms.set(req.params.code, room);
        }
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update room" });
    }
  });

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res, next) => {
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