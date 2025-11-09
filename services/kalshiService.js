import axios from "axios";
import Event from "../models/event.js";
import Market from "../models/market.js";
import { extractKeywords } from './generic-search-generator.js';
const KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"

// fetch and store new events, update markets, and remove expired events
export async function updateEventsAndMarkets() {
  try {
    let cursor = null;
    const limit = 200;
    let collectionSize = 0;

    do {
      const { data } = await axios.get(`${KALSHI_BASE_URL}/events`, {
        params: { with_nested_markets: true, cursor, limit },
      });

      const events = data.events || [];

      for (const event of events) {
        const exists = await Event.findOne({ event_ticker: event.event_ticker });
        let marketIds = [];

        //create or update markets
        if (event.markets?.length) {
          for (const m of event.markets) {
            const marketDoc = await Market.findOneAndUpdate(
              { market_ticker: m.ticker },
              {
                market_ticker: m.ticker,
                event_ticker: event.event_ticker,
                name: m.title,
                yes_sub_title: m.yes_sub_title,
                no_sub_title: m.no_sub_title,
                status: m.status,
                yes_price: m.yes_bid,
                no_price: m.no_bid,
                volume : m.volume,
                expires_at: new Date(m.latest_expiration_time),
              },
              { upsert: true, new: true }
            );
            marketIds.push(marketDoc._id);
          }
        }

        //determine event expiration
        let expiresAt = event.strike_date
          ? new Date(event.strike_date)
          : event.markets?.length
            ? new Date(Math.max(...event.markets.map(m => new Date(m.latest_expiration_time))))
            : null;

        const keyWords = extractKeywords(event.title);

        if (!exists) {
          //create new event with linked markets
          await Event.create({
            event_ticker: event.event_ticker,
            title: event.title,
            category: event.category,
            sub_title: event.sub_title,
            expires_at: expiresAt,
            status: event.status,
            key_words: keyWords,
            markets: marketIds,
          });
        } else {
          //update existing event with new markets and expiration
          await Event.findOneAndUpdate(
            { event_ticker: event.event_ticker },
            { markets: marketIds, expires_at: expiresAt }
          );
        }

        collectionSize++;
      }

      cursor = data.cursor;
    } while (cursor && collectionSize < 200);

    //remove expired events
    const expired = await Event.deleteMany({ expires_at: { $lt: new Date() } });
    console.log("expired event