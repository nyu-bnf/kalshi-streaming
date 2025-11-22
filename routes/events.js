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
        return res.status(404).json({ error: "Event not found" });
      }
  
      res.json({ event });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch event" });
    }
});

//filter by category
router.get("/category/:category", async (req, res) => {
  try {
    const events = await Event.aggregate([
      { $match: { category: req.params.category } },

      // populate markets
      {
        $lookup: {
          from: "markets",          // collection name in MongoDB
          localField: "markets",    // field in Event
          foreignField: "_id",      // field in Market
          as: "markets"
        }
      },

      // populate related_news
      {
        $lookup: {
          from: "news",
          localField: "related_news",
          foreignField: "_id",
          as: "related_news"
        }
      },

      // count related news
      {
        $addFields: {
          related_news: { $slice: [ "$related_news", 5 ] },
          newsCount: { $size: "$related_news" }
        }
      },

      // sort by expiration and news count
      {
        $sort: { expires_at: 1, newsCount: -1 }
      }
    ]);

    res.json(events);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

export default router;

