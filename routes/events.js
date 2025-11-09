import express from "express";
import Event from "../models/event.js";
import Market from "../models/market.js";
import News from "../models/news.js";

const router = express.Router();

//get all events
router.get("/", async (req, res) => {
  try {
    const events = await Event.find().sort({ expires_at: 1 });
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

//get event by id
router.get("/:id", async (req, res) => {
  try {
    //id is the event ticker
    const event = await Event.findOne({event_ticker: req.params.id});
    await event.populate("markets");
    await event.populate("related_news");

    if (!event) return res.status(404).json({ error: "Event not found" });

    res.json({event});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

export default router;
