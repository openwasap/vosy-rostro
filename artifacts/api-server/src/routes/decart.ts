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
  styleImage: "",
};

router.get("/config", (_req, res) => {
  res.json({
    ...decartConfig,
    apiKey: decartConfig.apiKey ? "***" : "",
    styleImage: decartConfig.styleImage ? "***" : "",
  });
});

router.put("/config", (req, res) => {
  const { apiKey, model, mirror, enhance, prompt, endpoint } = req.body;

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
  if (endpoint !== undefined) {
    decartConfig.endpoint = endpoint;
  }

  res.json({
    ...decartConfig,
    apiKey: decartConfig.apiKey ? "***" : "",
    styleImage: decartConfig.styleImage ? "***" : "",
  });
});

// Store style image separately
router.put("/style-image", (req, res) => {
  const { styleImage } = req.body;
  if (styleImage !== undefined) {
    decartConfig.styleImage = styleImage;
  }
  res.json({
    hasImage: !!decartConfig.styleImage,
    styleImage: decartConfig.styleImage ? "***" : "",
  });
});

router.get("/style-image", (_req, res) => {
  res.json({
    styleImage: decartConfig.styleImage || "",
  });
});

export default router;
