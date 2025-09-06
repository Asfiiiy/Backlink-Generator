const fs = require("fs");
const csv = require("csv-parser");

// Define niche keywords
const nicheKeywords = {
  "Artificial Intelligence": ["ai", "artificial intelligence", "machine learning", "deep learning", "neural network"],
  "Automotive": ["car", "auto", "automotive", "vehicle", "truck", "motor"],
  "Business": ["business", "startup", "entrepreneur", "enterprise", "corporate"],
  "Cryptocurrency": ["crypto", "bitcoin", "blockchain", "ethereum", "altcoin"],
  "E-commerce": ["ecommerce", "shop", "store", "online store", "retail"],
  "Education": ["edu", "education", "school", "college", "university", "learn", "course"],
  "Entertainment": ["entertainment", "movie", "tv", "celebrity", "music", "film"],
  "Environment": ["environment", "sustainability", "climate", "eco", "green"],
  "Fashion": ["fashion", "clothing", "style", "apparel", "designer"],
  "Finance": ["finance", "bank", "investment", "loan", "money", "stock"],
  "Fitness": ["fitness", "gym", "workout", "exercise", "health"],
  "Food & Beverage": ["food", "beverage", "restaurant", "recipe", "cooking"],
  "Gaming": ["gaming", "game", "esports", "gamer", "console"],
  "Health": ["health", "medical", "doctor", "clinic", "wellness"],
  "Insurance": ["insurance", "health insurance", "car insurance", "life insurance"],
  "Legal": ["legal", "law", "attorney", "lawyer", "court"],
  "Marketing": ["marketing", "advertising", "seo", "social media", "branding"],
  "Music": ["music", "song", "artist", "album", "concert"],
  "Parenting": ["parenting", "child", "baby", "family", "kids"],
  "Personal Development": ["personal development", "self-improvement", "motivation", "growth", "success"],
  "Pets": ["pet", "dog", "cat", "animal", "veterinary"],
  "Photography": ["photography", "photo", "camera", "lens", "photographer"],
  "Real Estate": ["real estate", "property", "house", "home", "rent"],
  "Science": ["science", "research", "technology", "physics", "chemistry"],
  "Self-Improvement": ["self-improvement", "motivation", "growth", "success", "happiness"],
  // Add more niches as needed
};

// Input/Output paths
const inputFilePath = "C:/Users/Arena Computer/Downloads/majestic_million.csv";
const outputFilePath = "filtered_domains.csv";

// Max number of rows you want to output
const MAX_DOMAINS = 10000;

// Function to determine a domain’s niche
function getNiche(domain) {
  // Convert domain to lowercase for simpler matching
  const lowerDomain = domain.toLowerCase();

  // Check each niche’s keywords
  for (const [niche, keywords] of Object.entries(nicheKeywords)) {
    if (keywords.some((keyword) => lowerDomain.includes(keyword))) {
      return niche;
    }
  }
  return ""; // No matching niche
}

function filterDomains(inputFilePath) {
  const results = [];
  let idCounter = 1;

  fs.createReadStream(inputFilePath)
    .pipe(csv())
    .on("data", (row) => {
      // Assuming your CSV has columns named exactly:
      // Domain, DA, trust_flow, citation_flow, referring_domains, organic_traffic, spam_score
      const domain = row.Domain; 
      const da = parseFloat(row.DA);
      const trust_flow = parseFloat(row.trust_flow);
      const citation_flow = parseFloat(row.citation_flow);
      const referring_domains = parseInt(row.referring_domains);
      const organic_traffic = parseInt(row.organic_traffic);
      const spam_score = parseFloat(row.spam_score);

      // 1) Filter condition: DA ≥ 50, Spam ≤ 10, Traffic ≥ 10K
      if (da >= 50 && spam_score <= 10 && organic_traffic >= 10000) {
        // 2) Get the niche
        const niche = getNiche(domain);

        // 3) Collect the row data
        results.push({
          id: idCounter++,
          domain,
          trust_flow,
          citation_flow,
          referring_domains,
          organic_traffic,
          spam_score,
          niche,
        });
      }
    })
    .on("end", () => {
      // 4) Limit results to MAX_DOMAINS
      const limitedResults = results.slice(0, MAX_DOMAINS);

      // 5) Write the filtered domains to a CSV
      const writeStream = fs.createWriteStream(outputFilePath);
      // Write CSV header
      writeStream.write(
        "id,domain,trust_flow,citation_flow,referring_domains,organic_traffic,spam_score,niche\n"
      );
      // Write rows
      limitedResults.forEach((item) => {
        const rowString = `${item.id},${item.domain},${item.trust_flow},${item.citation_flow},${item.referring_domains},${item.organic_traffic},${item.spam_score},${item.niche}\n`;
        writeStream.write(rowString);
      });
      writeStream.end();

      console.log(`Filtered domains saved to ${outputFilePath}`);
    });
}

// Run the script
filterDomains(inputFilePath);
