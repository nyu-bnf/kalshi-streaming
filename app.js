import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./utils/db.js";
//import { updateEventsAndMarkets } from "./services/kalshiService.js";
//import { populateNewsCollection } from "./populate-news-collection.js";

import newsRoutes from "./routes/news.js";
import eventsRoutes from "./routes/events.js";


dotenv.config();
const app = express();

// Middleware
// CORS configuration - allow requests from frontend
app.use(cors({
  origin: [
    'http://localhost:8081',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    process.env.FRONTEND_URL // Add your production frontend URL here
  ].filter(Boolean), // Remove undefined values
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json()); // Parse JSON bodies

await connectDB();

//routes
app.use("/api/news", newsRoutes);
app.use("/api/events", eventsRoutes);


app.get("/", (req, res) => {
  res.send("Kalshi Stream is running");
});

//run once on startup
//await updateEventsAndMarkets();
//await populateNewsCollection(); 


const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
