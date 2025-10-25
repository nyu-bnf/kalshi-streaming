import mongoose from "mongoose";

const eventSchema = new mongoose.Schema({
  event_ticker: { type: String, unique: true },
  title: String,
  category: String,
  sub_title: String,
  created_at: { type: Date, default: Date.now },
  expires_at: Date,
  status: String,
  key_words: Array
}, { timestamps: true });

eventSchema.index({ created_at: -1 });
export default mongoose.model("Event", eventSchema);
