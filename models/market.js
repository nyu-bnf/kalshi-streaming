import mongoose from "mongoose";

const marketSchema = new mongoose.Schema({
  market_ticker: { type: String, unique: true },
  event_ticker: String,
  name: String,
  yes_sub_title: String,
  no_sub_title:String,
  status: String,
  yes_price: Number,
  no_price: Number,
  volume: Number,
  expires_at: Date,
}, { timestamps: true });

marketSchema.index({ create