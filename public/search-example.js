/**
 * Actual Plays Search Example using Fuse.js
 * 
 * This module provides a client-side search interface for the actual plays index.
 * It fetches the search index from /index.json and provides both text search
 * and faceted filtering capabilities.
 * 
 * Usage:
 *   const search = new ActualPlaySearch();
 *   await search.initialize();
 *   const results = search.query('forgotten realms', { systems: ['dnd5e'] });
 */

class ActualPlaySearch {
  constructor() {
    this.index = null;
    this.fuse = null;
    this.initialized = false;
  }

  /**
   * Initialize the search by fetching the index and setting up Fuse.js
   */
  async initialize() {
    try {
      console.log('🔍 Initializing Actual Plays search...');
      
      // Fetch the search index
      const response = await fetch('/index.json');
      if (!response.ok) {
        throw new Error(`Failed to fetch search index: ${response.status}`);
      }
      
      this.index = await response.json();
      console.log(`📚 Loaded ${this.index.count} items from index (generated: ${this.index.generated_at})`);
      
      // Configure Fuse.js for optimal actual plays searching
      const fuseOptions = {
        // Include score and matches for highlighting
        includeScore: true,
        includeMatches: true,
        
        // Search threshold (0.0 = exact match, 1.0 = match anything)
        threshold: 0.3,
        
        // Ignore location for now
        ignoreLocation: true,
        
        // Define searchable fields with weights
        keys: [
          { name: 'title', weight: 3.0 },
          { name: 'series', weight: 2.5 },
          { name: 'description', weight: 2.0 },
          { name: 'content_excerpt', weight: 1.5 },
          { name: 'systems.display', weight: 1.8 },
          { name: 'setting.display', weight: 1.8 },
          { name: 'tags', weight: 1.2 },
          { name: 'players', weight: 1.0 },
          { name: 'search_text', weight: 0.5 }
        ]
      };
      
      // Create Fuse instance
      this.fuse = new Fuse(this.index.items, fuseOptions);
      this.initialized = true;
      
      console.log('✅ Search initialized successfully');
      return this;
      
    } catch (error) {
      console.error('❌ Failed to initialize search:', error);
      throw error;
    }
  }

  /**
   * Execute a search query with optional filters
   * @param {string} query - Text search query
   * @param {Object} filters - Faceted filters
   * @param {string[]} filters.systems - Filter by game systems (canonical names)
   * @param {string[]} filters.settings - Filter by campaign settings (canonical names)
   * @param {string[]} filters.series - Filter by series names
   * @param {string[]} filters.tags - Filter by tags
   * @param {number} filters.minEpisode - Minimum episode number
   * @param {number} filters.maxEpisode - Maximum episode number
   * @param {string} filters.dateFrom - Filter episodes from date (ISO format)
   * @param {string} filters.dateTo - Filter episodes to date (ISO format)
   * @param {number} limit - Maximum number of results (default: 50)
   * @returns {Object} Search results with metadata
   */
  query(query = '', filters = {}, limit = 50) {
    if (!this.initialized) {
      throw new Error('Search not initialized. Call initialize() first.');
    }

    let results;
    
    // If we have a text query, use Fuse search
    if (query.trim()) {
      results = this.fuse.search(query.trim(), { limit: limit * 2 }); // Get extra for filtering
      results = results.map(result => ({
        item: result.item,
        score: result.score,
        matches: result.matches
      }));
    } else {
      // No text query, return all items for filtering
      results = this.index.items.map(item => ({
        item: item,
        score: 0,
        matches: []
      }));
    }

    // Apply filters
    if (Object.keys(filters).length > 0) {
      results = results.filter(result => this._matchesFilters(result.item, filters));
    }

    // Limit results
    results = results.slice(0, limit);

    // Generate facets from current result set
    const facets = this._generateFacets(results.map(r => r.item));

    return {
      query: query,
      filters: filters,
      total_count: this.index.count,
      filtered_count: results.length,
      results: results,
      facets: facets,
      generated_at: this.index.generated_at
    };
  }

  /**
   * Check if an item matches the provided filters
   */
  _matchesFilters(item, filters) {
    // System filter
    if (filters.systems && filters.systems.length > 0) {
      const itemSystems = item.systems?.map(s => s.canonical) || [];
      if (!filters.systems.some(system => itemSystems.includes(system))) {
        return false;
      }
    }

    // Setting filter
    if (filters.settings && filters.settings.length > 0) {
      const itemSetting = item.setting?.canonical;
      if (!itemSetting || !filters.settings.includes(itemSetting)) {
        return false;
      }
    }

    // Series filter
    if (filters.series && filters.series.length > 0) {
      if (!item.series || !filters.series.includes(item.series)) {
        return false;
      }
    }

    // Tags filter
    if (filters.tags && filters.tags.length > 0) {
      const itemTags = item.tags || [];
      if (!filters.tags.some(tag => itemTags.includes(tag))) {
        return false;
      }
    }

    // Episode number filters
    if (filters.minEpisode && item.episode) {
      if (parseInt(item.episode) < filters.minEpisode) {
        return false;
      }
    }

    if (filters.maxEpisode && item.episode) {
      if (parseInt(item.episode) > filters.maxEpisode) {
        return false;
      }
    }

    // Date filters
    if (filters.dateFrom && item.date) {
      if (new Date(item.date) < new Date(filters.dateFrom)) {
        return false;
      }
    }

    if (filters.dateTo && item.date) {
      if (new Date(item.date) > new Date(filters.dateTo)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate facet counts from a result set
   */
  _generateFacets(items) {
    const facets = {
      systems: {},
      settings: {},
      series: {},
      tags: {},
      media: {}
    };

    items.forEach(item => {
      // Systems facets
      if (item.systems) {
        item.systems.forEach(system => {
          const key = system.canonical;
          if (!facets.systems[key]) {
            facets.systems[key] = {
              canonical: key,
              display: system.display,
              count: 0
            };
          }
          facets.systems[key].count++;
        });
      }

      // Settings facets
      if (item.setting) {
        const key = item.setting.canonical;
        if (!facets.settings[key]) {
          facets.settings[key] = {
            canonical: key,
            display: item.setting.display,
            count: 0
          };
        }
        facets.settings[key].count++;
      }

      // Series facets
      if (item.series) {
        const key = item.series;
        if (!facets.series[key]) {
          facets.series[key] = {
            name: key,
            count: 0
          };
        }
        facets.series[key].count++;
      }

      // Tags facets (top 10)
      if (item.tags) {
        item.tags.forEach(tag => {
          if (!facets.tags[tag]) {
            facets.tags[tag] = { name: tag, count: 0 };
          }
          facets.tags[tag].count++;
        });
      }

      // Media facets
      if (item.media) {
        item.media.forEach(media => {
          if (!facets.media[media]) {
            facets.media[media] = { name: media, count: 0 };
          }
          facets.media[media].count++;
        });
      }
    });

    // Sort facets by count and convert to arrays
    Object.keys(facets).forEach(facetType => {
      facets[facetType] = Object.values(facets[facetType])
        .sort((a, b) => b.count - a.count);
    });

    // Limit tags to top 10
    facets.tags = facets.tags.slice(0, 10);

    return facets;
  }

  /**
   * Get all available filter options
   */
  getAvailableFilters() {
    if (!this.initialized) {
      throw new Error('Search not initialized. Call initialize() first.');
    }

    return this._generateFacets(this.index.items);
  }

  /**
   * Get basic statistics about the index
   */
  getStatistics() {
    if (!this.initialized) {
      throw new Error('Search not initialized. Call initialize() first.');
    }

    const stats = {
      total_items: this.index.count,
      generated_at: this.index.generated_at,
      systems: new Set(),
      settings: new Set(),
      series: new Set(),
      date_range: { earliest: null, latest: null }
    };

    this.index.items.forEach(item => {
      // Collect unique systems
      if (item.systems) {
        item.systems.forEach(system => stats.systems.add(system.display));
      }

      // Collect unique settings
      if (item.setting) {
        stats.settings.add(item.setting.display);
      }

      // Collect unique series
      if (item.series) {
        stats.series.add(item.series);
      }

      // Track date range
      if (item.date) {
        const date = new Date(item.date);
        if (!stats.date_range.earliest || date < stats.date_range.earliest) {
          stats.date_range.earliest = date;
        }
        if (!stats.date_range.latest || date > stats.date_range.latest) {
          stats.date_range.latest = date;
        }
      }
    });

    // Convert sets to arrays
    stats.systems = Array.from(stats.systems).sort();
    stats.settings = Array.from(stats.settings).sort();
    stats.series = Array.from(stats.series).sort();

    return stats;
  }
}

/**
 * Standalone function for simple queries
 * @param {string} query - Search query
 * @param {Object} filters - Optional filters
 * @returns {Promise<Object>} Search results
 */
async function runExampleQuery(query, filters = {}) {
  const search = new ActualPlaySearch();
  await search.initialize();
  return search.query(query, filters);
}

// Export for both module and script usage
if (typeof module !== 'undefined' && module.exports) {
  // Node.js module
  module.exports = { ActualPlaySearch, runExampleQuery };
} else if (typeof window !== 'undefined') {
  // Browser global
  window.ActualPlaySearch = ActualPlaySearch;
  window.runExampleQuery = runExampleQuery;
}

// Example usage and demo (runs when script is loaded in browser)
if (typeof window !== 'undefined' && window.location) {
  console.log('🎲 Actual Plays Search Example loaded');
  console.log('Usage: const search = new ActualPlaySearch(); await search.initialize();');
  console.log('Example: runExampleQuery("dragon", { systems: ["dnd5e"] })');
}