import mongoose from "mongoose";

const eventSchema = new mongoose.Schema({
  event_ticker: { type: String, unique: true },
  title: String,
  category: String,
  sub_title: String,
  expires_at: Date,
  status: String,
  key_words: [{ type: String }],
  related_news: [{ type: String }]
}, { timestamps: true });

eventSchema.index({ created_at: -1 });
export default mongoose.model("Event", eventSchema);
