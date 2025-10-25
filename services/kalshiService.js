import axios from "axios";
import Event from "../models/event.js";
import Market from "../models/market.js";
import { extractKeywords, generateSearchQueries } from './generic-search-generator.js';
const KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"

// fetch and store new events
export async function updateEvents() {
  try {

    let cursor = null;
    const limit = 200; // max allowed per page
    let eventsFetched;
    let collectionSize=0;

    do{
    const { data } = await axios.get(`${KALSHI_BASE_URL}/events`,{ params: { with_nested_markets: true , status: "open", cursor, limit}});
    const events = data.events || [];
    eventsFetched = events.length;

    for (const event of events) {
      const exists = await Event.findOne({ event_ticker: event.event_ticker });
      if (!exists) {
        collectionSize++;
        let expiresAt = null;
        if(event.strike_date){
            expiresAt= new Date(event.strike_date);
        }
        else if (event.markets?.length) {
            //use latest market expiration
            const latestExp = event.markets
              .map(m => m.latest_expiration_time)
              .map(d => new Date(d))
              .sort((a, b) => b - a)[0]; // latest date
            expiresAt = latestExp;
        }
        let keyWords = extractKeywords(event.title);
        await Event.create({
          event_ticker: event.event_ticker,
          title: event.title,
          category: event.category,
          sub_title: event.sub_title,
          expires_at: expiresAt,
          status: event.status,
          //keywords and other things
          key_words: keyWords
        });
      }
     
    }
    cursor = data.cursor;
    }
    while(cursor && collectionSize<400);

    // remove expired events
    await Event.deleteMany({ expires_at: { $lt: new Date() } });

    console.log("Events updated");
  } catch (err) {
    console.error("Error updating events:", err.message);
  }
}

// fetch and store new markets
export async function updateMarkets() {
  try {
    const { data } = await axios.get(`${KALSHI_BASE_URL}/markets`);
    const markets = data.markets || [];

    for (const market of markets) {
      const exists = await Market.findOne({ market_ticker: market.ticker });
      if (!exists) {
        await Market.create({
          market_ticker: market.ticker,
          event_ticker: market.event_ticker,
          name: market.name,
          status: market.status,
          yes_price: market.yes_price,
          no_price: market.no_price,
          expires_at: new Date(market.latest_expiration_time)
        });
      }
    }

    // remove expired markets
    await Market.deleteMany({ expires_at: { $lt: new Date() } });

    console.log(" Markets updated");
  } catch (err) {
    console.error("Error updating markets:", err.message);
  }
}
