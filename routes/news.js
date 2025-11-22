import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const MONGODB_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || "Kalshi";

let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
  }
  return client.db(DB_NAME);
}

//get all news
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const news = await db.collection("news").populate("event_ids")
      .find({})
      .sort({ published_at: -1 })
      .limit(50)
      .toArray();
    res.json(news);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

//get news by event ID
router.get("/event/:id", async (req, res) => {
  try {
    //ID IS actual id, not ticker
    const db = await getDb();
    const eventId = new ObjectId(req.params.id);
    const news = await db.collection("news").populate("event_ids")
      .find({ event_ids: eventId })
      .sort({ published_at: -1 })
      .toArray();
    res.json(news);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch news for event" });
  }
});


export default router;
