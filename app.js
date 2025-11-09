import express from "express";
import dotenv from "dotenv";
import { connectDB } from "./utils/db.js";
import { updateEventsAndMarkets } from "./services/kalshiService.js";
import { populateNewsCollection } from "./populate-news-collection.js";
import newsRoutes from "./routes/news.js";
import eventsRoutes from "./routes/events.js";


dotenv.config();
const app = express();
await connectDB();

//routes
app.use("/api/news", newsRoutes);
app.use("/api/events", eventsRoutes);


app.get("/", (req, res) => {
  res.send("Kalshi Stream is running");
});

//run once on startup
await updateEventsAndMarkets