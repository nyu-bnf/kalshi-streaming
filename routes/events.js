import express from "express";
import Event from "../models/event.js";
import Market from "../models/market.js";
import News from "../models/news.js";

const router = express.Router();

//get all events
router.get("/", async (req, res) => {
  try {
    const events = await Event.find().sort({ expires_at: 1 }).populate({path: "markets", model: "Market"}).populate({
      path: "related_news",
      options: { sort: { published_at: -1 },limit: 5 } //newest first
    }).limit(50);

    
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

//get event by id
router.get("/:id", async (req, res) => {
    try {
      const event = await Event.findOne({ event_ticker: req.params.id })
        .populate({path: "markets", model: "Market"})
        .populate({
          path: "related_news",
          options: { sort: { published_at: -1 },limit: 5 } //newest first
        });
  
      if (!event) {
        return res.status(404).json({ error: "Event not