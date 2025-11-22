import express from "express";
import dotenv from "dotenv";
import News from "../models/news.js";

dotenv.config();

const router = express.Router();

//get all news
router.get("/", async (req, res) => {
  try {
    const news = await News.find({})
      .populate("event_ids")
      .sort({ published_at: -1 })
      .limit(50);

    res.json(news);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

//get news by event ID
router.get("/event/:id", async (req, res) => {
  try {
    const eventId = req.params.id;

    const news = await News.find({ event_ids: eventId })
      .populate("event_ids")
      .sort({ published_at: -1 });

    res.json(news);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch news for event" });
  }
});


export default router;
