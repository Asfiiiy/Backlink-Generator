// utils.js
function isValidBlogPostUrl(url) {
    // Exclude non-relevant URLs
    if (
      url.includes("/about/") ||
      url.includes("/contact/") ||
      url.includes("/category/") ||
      url.includes("/list-fast/") ||
      url.includes("/blog-niche/") ||
      url.includes("/to-sell/") ||
      url.includes("/pinterest/") || 
      url.includes("/cars/") ||  
      url.includes("/market/") || 
      url.includes("/the/") ||
      url.includes("/service /") ||
      url.includes("/volkswagens/")  
    ) {
      return false;
    }
  
    // Include URLs with specific patterns
    const patterns = [
      /\/\d{4}\/\d{2}\//, // Dates (e.g., /2025/03/)
      /\/how-to\//, // Tutorials (e.g., /how-to-write-on-a-pdf/)
      /\/things-i-did\//, // Personal posts (e.g., /things-i-did-differently/)
      /\/blog\//, // Blog posts (e.g., /blog/some-post/)
      /\/[^/]+-[^/]+-[^/]+\//, // Pattern like /how-pinterest-is-making-me-over-3k-month/
    ];
  
    return patterns.some((pattern) => pattern.test(url));
  }
  
  module.exports = { isValidBlogPostUrl };