import { Router, type IRouter } from "express";

const router: IRouter = Router();

// In-memory store for Decart config
let decartConfig = {
  apiKey: "",
  model: "lucy-2.1",
  endpoint: "wss://api3.decart.ai/v1/stream",
  mirror: "auto",
  enhance: true,
  prompt: "",
};

router.get("/config", (_req, res) => {
  res.json({
    ...decartConfig,
    apiKey: decartConfig.apiKey ? "***" : "",
  });
});

router.put("/config", (req, res) => {
  const { apiKey, model, mirror, enhance, prompt } = req.body;
  
  if (apiKey !== undefined) {
    decartConfig.apiKey = apiKey;
  }
  if (model) {
    decartConfig.model = model;
  }
  if (mirror) {
    decartConfig.mirror = mirror;
  }
  if (enhance !== undefined) {
    decartConfig.enhance = enhance;
  }
  if (prompt !== undefined) {
    decartConfig.prompt = prompt;
  }
  
  res.json({
    ...decartConfig,
    apiKey: decartConfig.apiKey ? "***" : "",
  });
});

export default router;
