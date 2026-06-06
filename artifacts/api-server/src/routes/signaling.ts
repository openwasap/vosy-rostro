import { Router, type IRouter } from "express";

const router: IRouter = Router();

// In-memory store for signaling data
const rooms = new Map<string, {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  mobileConnected: boolean;
  pcConnected: boolean;
  offer: any | null;
  answer: any | null;
  mobileIce: any[];
  pcIce: any[];
}>();

// Generate a short, easy-to-type 3-char alphanumeric ID
// Excludes visually ambiguous chars: 0/O, 1/I/l
function generateRoomId(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 3; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  // Ensure uniqueness
  if (rooms.has(id)) return generateRoomId();
  return id;
}

router.post("/rooms", (req, res) => {
  const { name } = req.body;
  const roomId = generateRoomId();
  
  rooms.set(roomId, {
    id: roomId,
    name: name || "Sala",
    status: "waiting",
    createdAt: new Date().toISOString(),
    mobileConnected: false,
    pcConnected: false,
    offer: null,
    answer: null,
    mobileIce: [],
    pcIce: [],
  });
  
  res.status(201).json({
    id: roomId,
    status: "waiting",
    createdAt: new Date().toISOString(),
    mobileConnected: false,
    pcConnected: false,
  });
});

router.get("/rooms/:roomId", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  res.json({
    id: room.id,
    status: room.status,
    createdAt: room.createdAt,
    mobileConnected: room.mobileConnected,
    pcConnected: room.pcConnected,
  });
});

router.post("/rooms/:roomId/offer", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  room.offer = req.body;
  room.mobileConnected = true;
  if (room.pcConnected) {
    room.status = "connected";
  }
  
  res.json({ success: true, message: "Offer stored" });
});

router.get("/rooms/:roomId/offer", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  if (!room.offer) {
    res.json({ success: false, message: "No offer yet" });
    return;
  }
  
  res.json({ success: true, message: "Offer available", ...room.offer });
});

router.post("/rooms/:roomId/answer", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  room.answer = req.body;
  room.pcConnected = true;
  if (room.mobileConnected) {
    room.status = "connected";
  }
  
  res.json({ success: true, message: "Answer stored" });
});

router.get("/rooms/:roomId/answer", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  if (!room.answer) {
    res.json({ success: false, message: "No answer yet" });
    return;
  }
  
  res.json({ success: true, message: "Answer available", ...room.answer });
});

router.post("/rooms/:roomId/ice", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  const { candidate, sdpMid, sdpMLineIndex, source } = req.body;
  
  if (source === "mobile") {
    room.mobileIce.push({ candidate, sdpMid, sdpMLineIndex });
  } else {
    room.pcIce.push({ candidate, sdpMid, sdpMLineIndex });
  }
  
  res.json({ success: true, message: "ICE candidate stored" });
});

router.get("/rooms/:roomId/ice/mobile", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  res.json({ candidates: room.mobileIce });
});

router.get("/rooms/:roomId/ice/pc", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  
  res.json({ candidates: room.pcIce });
});

export default router;
