/**
 * Generic Search Query Generator for Kalshi Events
 * 
 * A clean, generic solution for generating search queries from Kalshi event titles.
 * Works for ANY event type without overfitting to specific cases.
 * 
 * Usage:
 *   import { generateSearchQueries } from './generic-search-generator.js';
 *   const queries = generateSearchQueries(event);
 *   console.log(queries.searchQueries); // ['cleaned title', 'key words', 'category enhanced']
 */
  
  /**
   * Clean event title by removing unnecessary words and formatting
   */
  export function cleanEventTitle(title){
    return title
      .replace(/^(Will|Who|What|When|Where|Why|How)\s+/i, '') // Remove question starters
      .replace(/\s+(be|become|happen|occur|start|begin|end|finish|complete|reach|achieve|pass|exceed|surpass)\s+/gi, ' ') // Remove common verbs
      .replace(/\s+(before|after|by|until|during|in|on|at)\s+\d{4}/gi, '') // Remove time references
      .replace(/\s+(before|after|by|until|during)\s+[A-Z][a-z]+\s+\d{4}/gi, '') // Remove "before California 2050" etc
      .replace(/\s+(before|after|by|until|during)\s+[A-Z][a-z]+/gi, '') // Remove "before California" etc
      .replace(/\s+(in his|in her|in their)\s+(lifetime|career|tenure)/gi, '') // Remove lifetime references
      .replace(/\s+(a|an|the)\s+/gi, ' ') // Remove articles
      .replace(/\s+(will|would|should|could|might|may)\s+/gi, ' ') // Remove modal verbs
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }
  
  /**
   * Extract key terms from event title
   */
  export function extractKeywords(title) {
    const cleaned = cleanEventTitle(title);
    
    const words = cleaned
      .split(' ')
      .map(word => word.toLowerCase().replace(/[?!.,]/g, '')) // Remove punctuation
      .filter(word => 
        word.length >= 3 && // At least 3 characters
        !['and', 'or', 'but', 'for', 'nor', 'yet', 'so'].includes(word) && // Remove conjunctions
        !['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being'].includes(word) && // Remove common words
        !['will', 'would', 'should', 'could', 'might', 'may'].includes(word) && // Remove modal verbs
        !['this', 'that', 'these', 'those', 'here', 'there'].includes(word) && // Remove demonstratives
        !/^\d+$/.test(word) // Remove pure numbers
      );
  
    return [...new Set(words)]; // Remove duplicates
  }
  
  /**
   * Generate targeted search queries for Google News
   * 
   * Creates 3 search strategies:
   * 1. Cleaned title (most relevant)
   * 2. Key terms only (3-4 most important words)
   * 3. Category-enhanced query (optional)
   */
  export function generateSearchQueries(event){
    const original = event.title;
    const cleaned = cleanEventTitle(original);
    const keywords = extractKeywords(original);
    
    const searchQueries= [];
    
    // Strategy 1: Cleaned title (most relevant)
    if (cleaned.length > 0) {
      searchQueries.push(cleaned);
    }
    
    // Strategy 2: Key terms only (3-4 most important words)
    if (keywords.length > 0) {
      const topKeywords = keywords.slice(0, 4);
      searchQueries.push(topKeywords.join(' '));
    }
    
    // Strategy 3: Category-enhanced query (optional)
    if (event.category && keywords.length >= 2) {
      const categoryEnhanced = `${keywords.slice(0, 2).join(' ')} ${event.category.toLowerCase()}`;
      searchQueries.push(categoryEnhanced);
    }
    
    return {
      original,
      cleaned,
      keywords,
      searchQueries: [...new Set(searchQueries)] // Remove duplicates
    };
  }
  
  // Example usage:
  /*
  const event = {
    id: 'test1',
    event_ticker: 'KXSUPERBOWL-25',
    title: 'Will the Kansas City Chiefs win Super Bowl 2025?',
    category: 'Sports',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  const result = generateSearchQueries(event);
  console.log(result.searchQueries);
  // Output: [
  //   "the Kansas City Chiefs win Super Bowl 2025?",
  //   "kansas city chiefs win", 
  //   "kansas city sports"
  // ]
  */