import mongoose from "mongoose";

const marketSchema = new mongoose.Schema({
  market_ticker: { type: String, unique: true },
  event_ticker: String,
  name: String,
  status: String,
  yes_price: Number,
  no_price: Number,
  created_at: Date,
  expires_at: Date,
}, { timestamps: true });

marketSchema.index({ created_at: -1 });
export default mongoose.model("Market", marketSchema);