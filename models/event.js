import mongoose from "mongoose";

const eventSchema = new mongoose.Schema({
  event_ticker: { type: String, unique: true },
  title: String,
  category: String,
  sub_title: String,
  expires_at: Date,
  status: String,
  //markets
  key_words: [{ type: String }],
  related_news: [{ type: mongoose.Schema.Types.ObjectId, ref: "News" }], //related news is object id
  markets: [{ type: mongoose.Schema.Types.ObjectId, ref: "Market" }] //markets
}, { timestamps: true });

eventSchema.index({ created_at: -1 });
export default mongoose.model("Event", eventSchema);
