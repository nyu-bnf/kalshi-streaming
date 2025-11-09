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
await updateEventsAndMarkets();
await populateNewsCollection(); 

//run every hour
setInterval(async () => {
  await updateEventsAndMarkets();
}, 60 * 60 * 1000);

setInterval(async () => {
  try {
    console.log("\nrunning scheduled news population...");
    await populateNewsCollection();
  } catch (error) {
    console.error("error during scheduled news population:", error);
  }
}, 6 * 60 * 60 * 1000);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
