import express from "express";
import dotenv from "dotenv";
import { connectDB } from "./utils/db.js";
import { updateEvents, updateMarkets } from "./services/kalshiService.js";

dotenv.config();
const app = express();
await connectDB();

app.get("/", (req, res) => {
  res.send("Kalshi Stream is running");
});

//run once on startup
await updateEvents();
await updateMarkets();

//run every 30 minutes
setInterval(async () => {
  await updateEvents();
  await updateMarkets();
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
