// models/news.js
import mongoose from "mongoose";

const newsSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  title: String,
  canonical_url: String,
  source: String,
  snippet: String,
  published_at: Date,
  event_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }]
}, { timestamps: true });

export default mongoose.model("News", newsSchema);