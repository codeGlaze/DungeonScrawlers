#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { glob } = require('glob');
const slugify = require('slugify');

// Load vocabulary for normalization
const vocab = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/vocab.json'), 'utf8'));

/**
 * Normalize a value using the vocabulary
 */
function normalize(category, value) {
  if (!value || !vocab[category]) return value;
  
  const normalizedValue = value.toString().toLowerCase().trim();
  const entry = vocab[category][normalizedValue];
  
  return entry ? {
    canonical: entry.canonical,
    display: entry.display
  } : {
    canonical: slugify(normalizedValue, { lower: true, strict: true }),
    display: value
  };
}

/**
 * Normalize an array of values
 */
function normalizeArray(category, values) {
  if (!Array.isArray(values)) {
    return values ? [normalize(category, values)] : [];
  }
  return values.map(value => normalize(category, value));
}

/**
 * Generate content excerpt from markdown content
 */
function generateExcerpt(content, maxLength = 200) {
  // Remove markdown syntax for a clean excerpt
  const cleaned = content
    .replace(/^#{1,6}\s+/gm, '') // Remove headers
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.*?)\*/g, '$1') // Remove italic
    .replace(/`(.*?)`/g, '$1') // Remove inline code
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links, keep text
    .replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
    .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered list markers
    .replace(/\n\s*\n/g, '\n') // Collapse multiple newlines
    .trim();
  
  if (cleaned.length <= maxLength) return cleaned;
  
  // Find the last complete sentence within the limit
  const truncated = cleaned.substring(0, maxLength);
  const lastSentence = truncated.lastIndexOf('.');
  const lastSpace = truncated.lastIndexOf(' ');
  
  const cutoff = lastSentence > maxLength * 0.7 ? lastSentence + 1 : lastSpace;
  return cleaned.substring(0, cutoff) + '...';
}

/**
 * Process a single markdown file
 */
function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(content);
    const data = parsed.data;
    
    // Generate slug from filename if not provided
    const filename = path.basename(filePath, '.md');
    const slug = data.slug || slugify(filename, { lower: true, strict: true });
    
    // Normalize controlled vocabulary fields
    const systems = normalizeArray('systems', data.systems);
    const setting = data.setting ? normalize('settings', data.setting) : null;
    const genres = normalizeArray('genres', data.tags?.filter(tag => 
      vocab.genres[tag?.toLowerCase()]
    ));
    
    return {
      // Core metadata
      title: data.title || filename,
      slug: slug,
      date: data.date,
      description: data.description,
      
      // Episode/Series info
      series: data.series,
      episode: data.episode,
      
      // Game/Setting info
      systems: systems,
      setting: setting,
      era: data.era,
      
      // Production info
      players: data.players || [],
      duration: data.duration,
      media: data.media || [],
      
      // Content categorization
      tags: data.tags || [],
      genres: genres,
      content_warnings: data.content_warnings || [],
      languages: data.languages || ['English'],
      
      // Additional metadata
      aliases: data.aliases || [],
      
      // Generated fields
      content_excerpt: generateExcerpt(parsed.content),
      file_path: path.relative(process.cwd(), filePath),
      
      // Normalized for search
      search_text: [
        data.title,
        data.description,
        data.series,
        data.tags?.join(' '),
        systems?.map(s => s.display).join(' '),
        setting?.display,
        parsed.content
      ].filter(Boolean).join(' ').toLowerCase()
    };
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Main build function
 */
async function buildIndex() {
  console.log('Building search index...');
  
  // Find all markdown files in content/actual-plays
  const pattern = 'content/actual-plays/**/*.md';
  const files = await glob(pattern, { ignore: ['**/node_modules/**'] });
  
  console.log(`Found ${files.length} markdown files`);
  
  // Process each file
  const items = [];
  for (const file of files) {
    const processed = processFile(file);
    if (processed) {
      items.push(processed);
    }
  }
  
  // Sort by date (newest first) and series/episode
  items.sort((a, b) => {
    // First sort by date if available
    if (a.date && b.date) {
      return new Date(b.date) - new Date(a.date);
    }
    
    // Then by series and episode
    if (a.series === b.series && a.episode && b.episode) {
      return parseInt(a.episode) - parseInt(b.episode);
    }
    
    // Finally by title
    return (a.title || '').localeCompare(b.title || '');
  });
  
  // Create index object
  const index = {
    generated_at: new Date().toISOString(),
    count: items.length,
    items: items
  };
  
  // Ensure public directory exists
  const publicDir = path.join(__dirname, '../public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  
  // Write index file
  const outputPath = path.join(publicDir, 'index.json');
  fs.writeFileSync(outputPath, JSON.stringify(index, null, 2));
  
  console.log(`✅ Index built successfully: ${outputPath}`);
  console.log(`   📁 Processed ${items.length} items`);
  console.log(`   📊 Generated at: ${index.generated_at}`);
}

// Run if called directly
if (require.main === module) {
  buildIndex().catch(error => {
    console.error('❌ Error building index:', error);
    process.exit(1);
  });
}

module.exports = { buildIndex, processFile, normalize };