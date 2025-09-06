const db = require("../config/db"); // Your MySQL connection
require("dotenv").config();
require("chromedriver");
const axios = require("axios");
const cheerio = require("cheerio");
const logger = require("../utils/logger");
const { Builder, By, until } = require("selenium-webdriver"); // For DOM interaction
const chrome = require("selenium-webdriver/chrome");
const Bottleneck = require("bottleneck"); // For rate limiting
const validator = require("validator"); // For URL validation
// Main script
const { isValidBlogPostUrl } = require("./url");
// Track comments posted per domain
const commentsPerDomain = new Map();



// Now you can use isValidBlogPostUrl in your code

// Constants
const OPEN_PAGERANK_API_KEY = process.env.OPEN_PAGERANK_API_KEY;
const MAX_BACKLINKS = 30;
const MIN_WAIT_TIME_MS = 60000; // 1 minute
const MAX_WAIT_TIME_MS = 300000; // 5 minutes
const MAX_RETRIES = 10; // Maximum retries for generating backlinks

// Rate limiter for Open PageRank API
const limiter = new Bottleneck({
  minTime: 1000, // 1 request per second
});

// Track processed domains to avoid duplicates
const processedDomains = new Set();

// Centralized Chrome options
const chromeOptions = new chrome.Options()
  .addArguments("--headless=new")
  .addArguments("--no-sandbox") // Disable sandboxing
  .addArguments("--disable-dev-shm-usage") // Disable shared memory usage
  .addArguments("--disable-gpu"); // Disable GPU acceleration

/**
 * Check if the domain has reached the comment limit
 */
function hasReachedCommentLimit(domain) {
  const commentCount = commentsPerDomain.get(domain) || 0;
  return commentCount >= 2; // Limit of 2 comments per domain
}

/**
 * Increment the comment count for a domain
 */
function incrementCommentCount(domain) {
  const commentCount = commentsPerDomain.get(domain) || 0;
  commentsPerDomain.set(domain, commentCount + 1);
}
async function detectCommentSection(driver) {
  const COMMENT_KEYWORDS = [
    "Leave a Reply",
    "Leave a Comment",
    "Post a Reply",
    "Join the Discussion",
    "Your email address will not be published.",
    "Write a comment",
  ];

  try {
    // Get the page's text content
    const pageSource = await driver.getPageSource();
    const $ = cheerio.load(pageSource);
    const pageText = $("body").text(); // Extract all text from the page

    // Check if any keyword exists in the page text
    const hasCommentSection = COMMENT_KEYWORDS.some((keyword) =>
      pageText.includes(keyword)
    );

    if (hasCommentSection) {
      logger.info("✅ Detected comment section using keywords.");
      return true;
    } else {
      logger.warn("⚠️ No comment section detected using keywords.");
      return false;
    }
  } catch (err) {
    logger.error(`❌ Error detecting comment section: ${err.message}`);
    return false;
  }
}

// List of selectors for input fields


/**
 * Utility: Random 1–5 min delay
 */
function getRandomWaitTime() {
  return Math.floor(Math.random() * (MAX_WAIT_TIME_MS - MIN_WAIT_TIME_MS) + MIN_WAIT_TIME_MS);
}

/**
 * Normalize URLs (convert relative to absolute)
 */
function normalizeUrl(baseUrl, href) {
  if (href.startsWith("http")) {
    return href; // Already absolute
  } else if (href.startsWith("/")) {
    return new URL(href, baseUrl).href; // Convert relative to absolute
  } else {
    return new URL(href, baseUrl).href; // Handle other cases
  }
}



/**
 * 1) Get a random domain from majestic_niches for the given niche (used=0).
 */
async function getRandomMajesticDomainForNiche(nicheName, lastProcessedDomain) {
  try {
    // Fetch the next domain
    const [results] = await db.query(
      `
      SELECT domain
        FROM majestic_niches
       WHERE used = 0
         AND niche = ?
         AND domain > ?
       ORDER BY domain ASC
       LIMIT 1
      `,
      [nicheName.toLowerCase(), lastProcessedDomain || ""]
    );

    if (!results.length) {
      // No more domains left after the last processed domain
      // Reset the `used` flag for all domains in this niche
      await db.query(
        `UPDATE majestic_niches SET used = 0 WHERE niche = ?`,
        [nicheName.toLowerCase()]
      );

      // Fetch the first domain after resetting
      const [resetResults] = await db.query(
        `
        SELECT domain
          FROM majestic_niches
         WHERE niche = ?
         ORDER BY domain ASC
         LIMIT 1
        `,
        [nicheName.toLowerCase()]
      );

      if (!resetResults.length) {
        return null; // No domains left for this niche
      } else {
        return resetResults[0].domain; // Start from the first domain
      }
    } else {
      return results[0].domain; // Continue from the next domain
    }
  } catch (err) {
    logger.error(`❌ Error fetching random domain for niche ${nicheName}: ${err.message}`);
    throw err;
  }
}

/**
 * 2) Mark domain as used
 */
async function markDomainUsed(domain) {
  try {
    await db.query(
      `UPDATE majestic_niches SET used = 1 WHERE domain = ?`,
      [domain]
    );
    return true;
  } catch (err) {
    logger.error(`❌ Error marking domain ${domain} as used: ${err.message}`);
    throw err;
  }
}

/**
 * 3) Check domain with Open PageRank to ensure rank ≥ 40, spam ≤ 10, traffic ≥ 1000
 */
async function checkDomainWithOpenPageRank(domain) {
  return limiter.schedule(async () => {
    try {
      logger.info(`🔍 Checking Open PageRank for domain: ${domain}`);
      const response = await axios.get("https://openpagerank.com/api/v1.0/getPageRank", {
        headers: { "API-OPR": OPEN_PAGERANK_API_KEY },
        params: { "domains[]": domain },
      });

      if (response.data.status_code !== 200 || !response.data.response?.length) {
        logger.warn(`⚠️ No valid data from Open PageRank for ${domain}`);
        return false;
      }

      const site = response.data.response[0];
      const rank = parseInt(site.rank, 10) || 0;
      const spamScore = site.spam_score ?? 0;
      const organicTraffic = site.organic_traffic ?? 1000;

      logger.info(
        `OPR => Domain: ${domain}, rank: ${rank}, spam_score: ${spamScore}, traffic: ${organicTraffic}`
      );

      if (rank >= 40 && spamScore <= 10 && organicTraffic >= 1000) {
        logger.info(`✅ Domain meets OPR thresholds: ${domain}`);
        return true;
      } else {
        logger.warn(`🚫 Domain fails OPR thresholds: ${domain}`);
        return false;
      }
    } catch (error) {
      logger.error(`❌ Error checking OPR for ${domain}: ${error.message}`);
      return false;
    }
  });
}

/**
 * 4) Scrape domain homepage for blog links
 */
/**
 * Scrape domain homepage for blog links (limit to 15 URLs)
 */
/**
 * Scrape domain homepage for blog links (limit to 15 URLs)
 */
async function scrapeBlogLinks(domain) {
  const siteUrl = `https://${domain}/blog/`; // Target the blog page
  logger.info(`🔍 Scraping for blog links: ${siteUrl}`);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();

  try {
    await driver.get(siteUrl);
    const pageSource = await driver.getPageSource();
    const $ = cheerio.load(pageSource);

    const blogLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const fullUrl = normalizeUrl(siteUrl, href);

      // Check if the URL is a valid blog post URL
      if (isValidBlogPostUrl(fullUrl)) {
        blogLinks.push(fullUrl);
      }
    });

    logger.info(`🔍 Found ${blogLinks.length} valid blog links on ${siteUrl}`);
    return blogLinks.length ? blogLinks : null;
  } catch (err) {
    logger.error(`❌ Error scraping ${siteUrl}: ${err.message}`);
    return null;
  } finally {
    await driver.quit();
  }
}

async function scrapeAllBlogPages(domain) {
  let page = 1;
  const allBlogLinks = [];

  while (true) {
    const siteUrl = `https://${domain}/blog/page/${page}/`;
    logger.info(`🔍 Scraping blog page: ${siteUrl}`);

    const blogLinks = await scrapeBlogLinks(domain);
    if (!blogLinks || blogLinks.length === 0) {
      logger.info(`✅ No more blog posts found on page ${page}.`);
      break; // Exit the loop if no more posts are found
    }

    allBlogLinks.push(...blogLinks);
    page++;
  }

  return allBlogLinks;
}

async function processBlogPosts(blogLinks, submittedSiteUrl) {
  for (const blogUrl of blogLinks) {
    logger.info(`🌐 Visiting blog post: ${blogUrl}`);

    // Check if the page has a comment section
    const hasCommentSection = await validateBlogPost(blogUrl);
    if (!hasCommentSection) {
      logger.warn(`⚠️ Skipping page without comment section: ${blogUrl}`);
      continue;
    }

    // Generate a comment
    const commentText = generateCommentText(submittedSiteUrl);
    if (!commentText) {
      logger.warn(`⚠️ Failed to generate comment text for ${blogUrl}`);
      continue;
    }

    // Post the comment
    const success = await postComment(blogUrl, commentText);
    if (success) {
      logger.info(`✅ Successfully posted comment on ${blogUrl}`);
    } else {
      logger.warn(`⚠️ Failed to post comment on ${blogUrl}`);
    }

    // Wait before visiting the next post (to avoid rate limiting)
    const waitTime = getRandomWaitTime();
    logger.info(`⏳ Waiting ${Math.round(waitTime / 1000)}s before next post...`);
    await new Promise((res) => setTimeout(res, waitTime));
  }
}

/**
 * Scrape category links from the domain
 */
async function scrapeCategoryLinks(domain) {
  const siteUrl = `https://${domain}/`;
  logger.info(`🔍 Scraping for category links: ${siteUrl}`);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();

  try {
    await driver.get(siteUrl);
    const pageSource = await driver.getPageSource();
    const $ = cheerio.load(pageSource);

    const categoryLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const fullUrl = normalizeUrl(siteUrl, href);

      // Check if the URL is a category link
      const isCategoryLink = fullUrl.includes("category");

      if (isCategoryLink) {
        categoryLinks.push(fullUrl);
      }
    });

    logger.info(`🔍 Found ${categoryLinks.length} category links on ${siteUrl}`);
    return categoryLinks.length ? categoryLinks : null;
  } catch (err) {
    logger.error(`❌ Error scraping ${siteUrl}: ${err.message}`);
    return null;
  } finally {
    await driver.quit();
  }
}

/**
 * Scrape other post links from the domain
 */
async function scrapeOtherPostLinks(domain) {
  const siteUrl = `https://${domain}/`;
  logger.info(`🔍 Scraping for other post links: ${siteUrl}`);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();

  try {
    await driver.get(siteUrl);
    const pageSource = await driver.getPageSource();
    const $ = cheerio.load(pageSource);

    const otherPostLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const fullUrl = normalizeUrl(siteUrl, href);

      // Check if the URL is a post link (excluding blog and category links)
      const isPostLink =
        !fullUrl.includes("blog") &&
        !fullUrl.includes("category") &&
        !fullUrl.includes("page");

      if (isPostLink) {
        otherPostLinks.push(fullUrl);
      }
    });

    logger.info(`🔍 Found ${otherPostLinks.length} other post links on ${siteUrl}`);
    return otherPostLinks.length ? otherPostLinks : null;
  } catch (err) {
    logger.error(`❌ Error scraping ${siteUrl}: ${err.message}`);
    return null;
  } finally {
    await driver.quit();
  }
}

/**
 * Scrape URLs with the pattern /[^/]+-[^/]+-[^/]+/ (e.g., /how-pinterest-is-making-me-over-3k-month/)
 */
async function scrapePatternedLinks(domain) {
  const siteUrl = `https://${domain}/`;
  logger.info(`🔍 Scraping for patterned links: ${siteUrl}`);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();

  try {
    await driver.get(siteUrl);
    const pageSource = await driver.getPageSource();
    const $ = cheerio.load(pageSource);

    const patternedLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const fullUrl = normalizeUrl(siteUrl, href);

      // Check if the URL matches the desired pattern
      const isPatternedLink = /\/[^/]+-[^/]+-[^/]+\//.test(fullUrl);

      if (isPatternedLink && isValidBlogPostUrl(fullUrl)) {
        patternedLinks.push(fullUrl);
      }
    });

    logger.info(`🔍 Found ${patternedLinks.length} patterned links on ${siteUrl}`);
    return patternedLinks.length ? patternedLinks : null;
  } catch (err) {
    logger.error(`❌ Error scraping ${siteUrl}: ${err.message}`);
    return null;
  } finally {
    await driver.quit();
  }
}
/**
 * Scrape a category page for blog post links
 */
async function scrapeCategoryPage(categoryUrl) {
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions) // Use centralized options
    .build();

  try {
    await driver.get(categoryUrl);
    const pageSource = await driver.getPageSource();
    const $ = cheerio.load(pageSource);

    const blogLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const fullUrl = normalizeUrl(categoryUrl, href);

      // Check if the URL is a blog post
      const isBlogPost = fullUrl.includes("blog") && !fullUrl.includes("category");

      if (isBlogPost) {
        blogLinks.push(fullUrl);
      }
    });

    logger.info(`🔍 Found ${blogLinks.length} blog links on category page: ${categoryUrl}`);
    return blogLinks;
  } catch (err) {
    logger.error(`❌ Error scraping category page ${categoryUrl}: ${err.message}`);
    return [];
  } finally {
    await driver.quit();
  }
}

/**
 * Validate if a URL matches the desired blog post pattern
 */


/**
 * 5) Pre-written random comments referencing the submitted site.
 */
const RANDOM_COMMENTS = [
  "Loved this post! It's so helpful and well-written. Keep up the great work!",
  "Really appreciate your thoughts here. This was a fantastic read!",
  "This blog is fantastic. I’ve learned so much from your content.",
  "Great explanation! It’s always refreshing to read such insightful posts.",
  "Fantastic write-up! Your perspective is really valuable.",
  "I enjoyed reading this. It’s clear you put a lot of effort into this post.",
  "Great article! I’ve found your insights to be very useful.",
];

/**
 * 6) Generate a random comment referencing the submitted site.
 */
function generateCommentText() {
  // Randomly select a comment template
  const randomIndex = Math.floor(Math.random() * RANDOM_COMMENTS.length);
  let comment = RANDOM_COMMENTS[randomIndex];

  // Add slight variations to the comment (optional)
  const variations = [
    " Keep up the great work!",
    " Thanks for sharing this!",
    " Looking forward to more posts like this.",
    " This was really insightful.",
    " I’ll definitely be coming back for more.",
  ];
  const randomVariation = variations[Math.floor(Math.random() * variations.length)];
  comment += randomVariation;

  return comment;
}
/**
 * 7) Check if a page contains forms (e.g., email opt-in forms)
 */
async function hasForm(pageUrl) {
  try {
    const resp = await axios.get(pageUrl, { timeout: 10000 });
    const $ = cheerio.load(resp.data);

    // Check if the page contains a form (excluding the comment form)
    const formExists = $("form").length > 0 && !$("form").has("textarea[name='comment']");
    return formExists;
  } catch (err) {
    logger.error(`❌ Error checking for forms at ${pageUrl}: ${err.message}`);
    return false;
  }
}

async function findCommentForm(driver) {
  try {
    // Get the page's HTML
    const pageSource = await driver.getPageSource();
    const $ = cheerio.load(pageSource);

    // Look for a <textarea> or <input> near comment-related keywords
    const commentForm = $("textarea, input").filter((_, el) => {
      const elementText = $(el).text().toLowerCase();
      const nearbyText = $(el).parent().text().toLowerCase();
      return (
        elementText.includes("comment") ||
        nearbyText.includes("comment") ||
        nearbyText.includes("reply")
      );
    });

    if (commentForm.length > 0) {
      logger.info("✅ Detected comment form using keywords.");
      return {
        commentField: commentForm[0], // Focus on the comment field
      };
    } else {
      logger.warn("⚠️ No comment form found using keywords.");
      return null;
    }
  } catch (err) {
    logger.error(`❌ Error finding comment form: ${err.message}`);
    return null;
  }
}
async function validateBlogPost(pageUrl) {
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();

  try {
    await driver.get(pageUrl);

    // Wait for the page to load
    await driver.wait(until.elementLocated(By.css("body")), 15000);

    // Check for comment section using keywords
    const hasCommentSection = await detectCommentSection(driver);

    if (hasCommentSection) {
      logger.info(`✅ Detected comment section on: ${pageUrl}`);
      return true;
    }

    logger.warn(`⚠️ No comment section detected on: ${pageUrl}`);
    return false;
  } catch (err) {
    logger.error(`❌ Error validating blog post at ${pageUrl}: ${err.message}`);
    return false;
  } finally {
    await driver.quit();
  }
}

/**
 * 9) Function to generate random data for input fields
 */
function generateRandomData(fieldName, submittedSiteUrl) {
  const randomNames = [
    "John Doe", "Jane Smith", "Alice Johnson", "Bob Brown", "Charlie Davis",
    "Eva Wilson", "Frank Miller", "Grace Lee", "Henry Garcia", "Ivy Martinez"
  ];
  const randomEmails = [
    "johndoe", "janesmith", "alicejohnson", "bobbrown", "charliedavis",
    "evawilson", "frankmiller", "gracelee", "henrygarcia", "ivymartinez"
  ].map((name) => `${name}${Math.floor(Math.random() * 1000)}@gmail.com`);

  const randomData = {
    name: randomNames[Math.floor(Math.random() * randomNames.length)],
    email: randomEmails[Math.floor(Math.random() * randomEmails.length)],
    website: submittedSiteUrl, // Use the submitted site URL as the website
  };

  return randomData[fieldName] || "Random Data";
}

async function isDoFollowLink(driver, linkElement) {
  try {
    const relAttribute = await linkElement.getAttribute("rel");
    return !relAttribute || !relAttribute.includes("nofollow");
  } catch (err) {
    logger.error(`❌ Error checking do-follow status: ${err.message}`);
    return false;
  }
}
/**
 * Post the comment using Selenium and return the exact blog post URL
 */


async function postComment(pageUrl, commentText, submittedSiteUrl, siteId) {
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();

  try {
    await driver.get(pageUrl);

    // ✅ Auto-detect comment form using keywords
    let commentForm = await findCommentForm(driver);
    if (!commentForm) {
      logger.warn("⚠️ No comment form found. Skipping...");
      return false;
    }

    // ✅ Fill in the comment field
    if (commentForm.commentField) {
      const commentField = await driver.findElement(By.css("textarea"));
      await driver.wait(until.elementIsVisible(commentField), 10000);
      await driver.executeScript("arguments[0].scrollIntoView(true);", commentField);
      await driver.wait(until.elementIsEnabled(commentField), 10000);
      await commentField.sendKeys(commentText);
    }

    // ✅ Fill in name, email, and website fields
    const name = generateRandomData("name");
    const email = generateRandomData("email");
    const website = submittedSiteUrl; // Use the submitted site URL

    const nameField = await driver.findElement(By.css('input[name="author"], input[name="name"]'));
    if (nameField) {
      await nameField.sendKeys(name);
    }

    const emailField = await driver.findElement(By.css('input[name="email"]'));
    if (emailField) {
      await emailField.sendKeys(email);
    }

    const websiteField = await driver.findElement(By.css('input[name="url"], input[name="website"]'));
    if (websiteField) {
      await websiteField.sendKeys(website);
    }

    // ✅ Submit the form
    const submitButton = await driver.findElement(By.css('input[type="submit"], button[type="submit"]'));
    if (submitButton) {
      // Scroll the button into view
      await driver.executeScript("arguments[0].scrollIntoView(true);", submitButton);

      // Wait for the button to be visible and enabled
      await driver.wait(until.elementIsVisible(submitButton), 10000);
      await driver.wait(until.elementIsEnabled(submitButton), 10000);

      // Add a small delay (optional)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Click the button using JavaScript
      await driver.executeScript("arguments[0].click();", submitButton);

      logger.info("✅ Comment posted successfully!");

      // Wait for the comment to be published (if necessary)
      await driver.wait(until.elementLocated(By.css(`a[href="${submittedSiteUrl}"]`)), 30000);

      // Check if the link is do-follow
      const linkElement = await driver.findElement(By.css(`a[href="${submittedSiteUrl}"]`));
      const isDoFollow = await isDoFollowLink(driver, linkElement);

      // Insert the backlink record
      await insertBacklinkRecord({
        siteId,
        backlinkUrl: pageUrl, // URL of the post where the comment was made
        sourceSite: `https://${new URL(pageUrl).hostname}/`, // Source site domain
        submittedSiteUrl,
        commentText,
        name,
        email,
        website,
        postUrl: pageUrl, // URL of the post where the comment was made
        isDoFollow,
      });

      return true;
    } else {
      logger.warn("⚠️ No submit button found.");
      return false;
    }
  } catch (error) {
    logger.error(`❌ Error posting comment: ${error.message}`);
    return false;
  } finally {
    await driver.quit();
  }
}



/**
 * 11) Insert the final comment URL into 'backlinks' table
 */
/**
 * Insert a backlink record into the database
 */
async function insertBacklinkRecord({
  siteId,
  backlinkUrl,
  sourceSite,
  submittedSiteUrl,
  commentText,
  postUrl,
  isDoFollow,
}) {
  try {
    await db.query(
      `
      INSERT INTO backlinks
      (site_id, backlink_url, status, submission_status, source_site, method, submitted_site, comment_text, post_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        siteId,
        backlinkUrl, // URL of the post where the comment was made
        isDoFollow ? "active" : "inactive", // Set status based on do-follow check
        "success", // Submission status
        sourceSite, // Source site domain
        "comment", // Method is 'comment'
        submittedSiteUrl, // The site URL being promoted
        commentText, // The comment text
        postUrl, // URL of the post where the comment was made
      ]
    );
    logger.info(`✅ Inserted backlink record for ${submittedSiteUrl}: ${backlinkUrl}`);
    return true;
  } catch (err) {
    logger.error(`❌ Error inserting backlink for ${submittedSiteUrl}: ${err.message}`);
    return false;
  }
}

/**
 * Update the backlinks_generated column for a site
 */
async function updateBacklinksGenerated(siteId) {
  try {
    await db.query(
      `
      UPDATE submitted_sites
      SET backlinks_generated = backlinks_generated + 1
      WHERE id = ?
      `,
      [siteId]
    );
    logger.info(`✅ Updated backlinks_generated for site ID: ${siteId}`);
    return true;
  } catch (err) {
    logger.error(`❌ Error updating backlinks_generated for site ID: ${siteId}: ${err.message}`);
    return false;
  }
}

/**
 * Post a comment and save the data
 */
async function postCommentAndSaveData(pageUrl, commentText, submittedSiteUrl, siteId) {
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();

  try {
    await driver.get(pageUrl);

    // ✅ Auto-detect comment form using keywords
    let commentForm = await findCommentForm(driver);
    if (!commentForm) {
      logger.warn("⚠️ No comment form found. Skipping...");
      return false;
    }

    // ✅ Fill in the comment field
    if (commentForm.commentField) {
      const commentField = await driver.findElement(By.css("textarea"));
      await driver.wait(until.elementIsVisible(commentField), 15000); // Increased timeout
      await driver.executeScript("arguments[0].scrollIntoView(true);", commentField);
      await driver.wait(until.elementIsEnabled(commentField), 15000); // Increased timeout
      await commentField.sendKeys(commentText);
    }

    // ✅ Submit the form
    const submitButton = await driver.findElement(By.css('input[type="submit"], button[type="submit"]'));
    if (submitButton) {
      await driver.executeScript("arguments[0].scrollIntoView(true);", submitButton);
      await driver.wait(until.elementIsVisible(submitButton), 15000); // Increased timeout
      await driver.wait(until.elementIsEnabled(submitButton), 15000); // Increased timeout
      await driver.executeScript("arguments[0].click();", submitButton);

      logger.info("✅ Comment posted successfully!");

      // Wait for the comment to be published
      await driver.wait(until.elementLocated(By.css(`a[href="${submittedSiteUrl}"]`)), 45000); // Increased timeout

      // Insert the backlink record
      await insertBacklinkRecord({
        siteId,
        backlinkUrl: pageUrl,
        sourceSite: `https://${new URL(pageUrl).hostname}/`,
        submittedSiteUrl,
        commentText,
        postUrl: pageUrl,
      });

      return true;
    } else {
      logger.warn("⚠️ No submit button found.");
      return false;
    }
  } catch (error) {
    logger.error(`❌ Error posting comment: ${error.message}`);
    return false;
  } finally {
    await driver.quit();
  }
}

const processedUrls = new Set();

/**
 * Try to create one comment-based backlink for the domain
 */
async function tryCommentBacklink(domain, submittedSiteUrl, siteId) {
  // Skip if already 2 comments on this domain
  if (hasReachedCommentLimit(domain)) {
    logger.info(`⏩ Domain ${domain} already has 2 comments. Moving to next.`);
    return false;
  }

  let backlinksPosted = 0;

  // Scrape blog links
  const blogLinks = await scrapeBlogLinks(domain);
  if (!blogLinks?.length) return false;

  // Try to post up to 2 comments
  for (const url of blogLinks) {
    if (backlinksPosted >= 2) break; // Stop after 2

    const success = await postCommentAndSaveData(url, generateCommentText(), submittedSiteUrl, siteId);
    if (success) {
      backlinksPosted++;
      incrementCommentCount(domain); // Track per-domain count
    }
  }

  return backlinksPosted > 0;
}

/**
 * Get the next domain for a niche (in order) and loop back if needed
 */
async function getNextDomainForNiche(nicheName, lastProcessedDomain = "") {
  try {
    const [domains] = await db.query(
      `SELECT domain FROM majestic_niches 
       WHERE niche = ? 
       ORDER BY domain ASC`,
      [nicheName.toLowerCase()]
    );

    if (!domains.length) return null;

    // If no last processed domain, start from the first
    if (!lastProcessedDomain) return domains[0].domain;

    // Find the next domain after lastProcessedDomain
    const nextIndex = domains.findIndex(d => d.domain > lastProcessedDomain);
    if (nextIndex === -1) {
      // Reached end? Loop back to the first domain
      return domains[0].domain;
    } else {
      return domains[nextIndex].domain;
    }
  } catch (err) {
    logger.error(`❌ Error fetching next domain for niche ${nicheName}: ${err.message}`);
    throw err;
  }
}
/**
 * Try to create one comment-based backlink for the domain
 * Checks 5 category posts, 5 blog posts, and 5 other posts for comment sections
 */
/**
 * Try to create one comment-based backlink for the domain
 * Checks 5 category posts, 5 blog posts, 5 other posts, and 5 patterned URLs for comment sections
 */
async function tryCommentBacklink(domain, submittedSiteUrl, siteId) {
  // Scrape the website for blog links, category links, other post links, and patterned links
  const blogLinks = await scrapeBlogLinks(domain);
  const categoryLinks = await scrapeCategoryLinks(domain);
  const otherPostLinks = await scrapeOtherPostLinks(domain);
  const patternedLinks = await scrapePatternedLinks(domain);

  if (!blogLinks && !categoryLinks && !otherPostLinks && !patternedLinks) {
    logger.warn(`⚠️ No valid links found on ${domain}`);
    return null;
  }

  // Function to process a set of links and attempt to post comments
  const processLinks = async (links, type) => {
    if (!links || links.length === 0) {
      logger.warn(`⚠️ No ${type} links found on ${domain}`);
      return false;
    }

    // Limit to 5 links
    const limitedLinks = links.slice(0, 5);

    for (const link of limitedLinks) {
      let fullUrl = link;

      // Convert relative URLs to absolute
      if (link.startsWith("/")) {
        fullUrl = `https://${domain}${link}`;
      } else if (!link.startsWith("http")) {
        fullUrl = `https://${domain}/${link}`;
      }

      logger.info(`🌐 Checking ${type} URL: ${fullUrl}`);

      // Check if the page has a comment section
      const hasCommentSection = await validateBlogPost(fullUrl);
      if (!hasCommentSection) {
        logger.warn(`⚠️ Skipping page without comment section: ${fullUrl}`);
        continue;
      }

      // Generate a comment
      const commentText = generateCommentText(submittedSiteUrl);
      if (!commentText) {
        logger.warn(`⚠️ Failed to generate comment text for ${fullUrl}`);
        continue;
      }

      // Post the comment and get the comment URL
      const success = await postComment(fullUrl, commentText, submittedSiteUrl, siteId);
      if (!success) {
        logger.warn(`⚠️ Failed to post comment on ${fullUrl}`);
        continue;
      }

      // Insert the comment into the database
      const successi = await insertBacklinkRecord({
        siteId: siteId,
        backlinkUrl: fullUrl, // Use the post URL as backlink URL
        sourceSite: `https://${domain}/`,
        submittedSiteUrl: submittedSiteUrl,
        commentText: commentText,
        postUrl: fullUrl,
        isDoFollow: true // Assuming it's dofollow unless checked otherwise
      });

      if (successi) {
        logger.info(`✅ Successfully posted comment on ${fullUrl}`);
        return true; // Stop after posting one comment
      }
    }

    return false; // No comments were made on this set of links
  };

  // Process 5 category posts
  const categorySuccess = await processLinks(categoryLinks, "category");
  if (categorySuccess) return true;

  // Process 5 blog posts
  const blogSuccess = await processLinks(blogLinks, "blog");
  if (blogSuccess) return true;

  // Process 5 other posts
  const otherPostSuccess = await processLinks(otherPostLinks, "other post");
  if (otherPostSuccess) return true;

  // Process 5 patterned URLs
  const patternedSuccess = await processLinks(patternedLinks, "patterned");
  if (patternedSuccess) return true;

  // If no comments were made, return `null`
  logger.warn(`⚠️ No valid comment sections found on ${domain}`);
  return null;
}


/**
 * 13) generateBacklinkOnce: pick random domain, check OPR, try comment
 */
/**
 * Generate a single backlink for a site
 */
async function generateBacklinkOnce(site) {
  const { id: siteId, site_url, niche_name } = site;

  // Load all domains for this niche
  const domains = await getAllDomainsForNiche(niche_name);
  if (!domains || domains.length === 0) {
    logger.warn(`❌ No domains found for niche: ${niche_name}`);
    return false;
  }

  let index = 0;

  while (true) {
    const domain = domains[index];

    logger.info(`🔍 Trying domain ${domain} (index ${index}) for niche ${niche_name}`);

    const meetsOPR = await checkDomainWithOpenPageRank(domain);
    if (!meetsOPR) {
      index = (index + 1) % domains.length;
      continue;
    }

    const result = await tryCommentBacklink(domain, site_url, siteId);
    if (!result) {
      index = (index + 1) % domains.length;
      continue;
    }

    logger.info(`✅ Successfully made comment on ${domain}`);
    return true;
  }
}
 // Helper Function domain Reloda //

 async function getAllDomainsForNiche(nicheName) {
  const [rows] = await db.query(`
    SELECT m.domain
    FROM majestic_niches m
    JOIN niches n ON m.niche_id = n.id
    WHERE n.name = ?
  `, [nicheName]);

  return rows.map(row => row.domain);
}


/**
 * 14) generateBacklink: indefinite tries
 */
async function generateBacklink(site) {
  while (true) {
    const success = await generateBacklinkOnce(site);
    if (success) {
      return true;
    }
    logger.warn(`⚠️ Could not create a comment backlink for ${site.site_url}, retrying in 5s...`);
    await new Promise((res) => setTimeout(res, 5000));
  }
}

/**
 * 15) generate up to 30 backlinks
 */
/**
 * Main workflow to generate backlinks
 */
/**
 * Generate 2 backlinks for a website, then move to the next site
 */
async function generateBacklinksForSite(site) {
  const { id: siteId, site_url, niche_name, last_processed_domain } = site;
  let currentDomain = last_processed_domain || "";

  while (true) {
    // Get the next domain in order
    currentDomain = await getNextDomainForNiche(niche_name, currentDomain);
    if (!currentDomain) break; // No domains left

    // Check domain quality
    const meetsOPR = await checkDomainWithOpenPageRank(currentDomain);
    if (!meetsOPR) continue;

    // Try posting up to 2 backlinks
    const success = await tryCommentBacklink(currentDomain, site_url, siteId);
    if (success) {
      // Update last processed domain
      await db.query(
        `UPDATE submitted_sites SET last_processed_domain = ? WHERE id = ?`,
        [currentDomain, siteId]
      );
    }

    // Move to next domain after 2 backlinks (or if no opportunities)
    const waitTime = getRandomWaitTime();
    logger.info(`⏳ Waiting ${waitTime / 1000}s before next domain...`);
    await new Promise(res => setTimeout(res, waitTime));
  }
}

/**
 * Process submitted sites — generate 2 backlinks per site, move to the next site
 */
async function processSubmittedSites() {
  try {
    // Get the next site that needs backlinks
    const [results] = await db.query(
      `
      SELECT s.id, s.site_url, s.niche_id, n.name AS niche_name, s.backlinks_generated, s.last_processed_domain
        FROM submitted_sites s
        JOIN niches n ON s.niche_id = n.id
       WHERE s.backlinks_generated < ?
         AND s.status IN ('approved','pending')
       ORDER BY s.created_at ASC
       LIMIT 1
      `,
      [MAX_BACKLINKS]
    );

    if (results.length === 0) {
      logger.info("✅ All submitted sites are maxed out or none remain in 'approved/pending'.");
      return;
    }

    const site = results[0];
    logger.info(`🚀 Processing backlinks for: ${site.site_url} (Niche: ${site.niche_name})`);

    // Generate backlinks for the site (2 backlinks at a time)
    await generateBacklinksForSite(site);

    // Move on to the next submitted site
    processSubmittedSites();
  } catch (err) {
    logger.error("❌ Database error fetching submitted sites:", {
      message: err.message,
      code: err.code,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage,
      sqlQuery: `
        SELECT s.id, s.site_url, s.niche_id, n.name AS niche_name, s.backlinks_generated, s.last_processed_domain
        FROM submitted_sites s
        JOIN niches n ON s.niche_id = n.id
        WHERE s.backlinks_generated < ?
        AND s.status IN ('approved','pending')
        ORDER BY s.created_at ASC
        LIMIT 1
      `,
      queryParams: [MAX_BACKLINKS],
    });
  }
}

// Start the process
processSubmittedSites();

module.exports = {
  processSubmittedSites,
  generateBacklinksForSite,
  generateBacklink, // Ensure this is included
  generateBacklinkOnce,
  tryCommentBacklink,
  generateCommentText,
};
