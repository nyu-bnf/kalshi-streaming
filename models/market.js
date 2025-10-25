import mongoose from "mongoose";

const marketSchema = new mongoose.Schema({
  market_ticker: { type: String, unique: true },
  event_ticker: String,
  name: String,
  status: String,
  yes_price: Number,
  no_price: Number,
  expires_at: Date,
}, { timestamps: true });

marketSchema.index({ createdAt: -1 });
export default mongoose.model("Market", marketSchema);