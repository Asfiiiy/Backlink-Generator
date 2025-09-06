const db = require("../config/db");

// **Fetch the Next Submission for Reddit**
const fetchNextRedditSubmission = async () => {
    return new Promise((resolve, reject) => {
        db.query(
            `SELECT submitted_sites.id, submitted_sites.site_url, submitted_sites.niche_id, submitted_sites.post_content,
                    submitted_sites.max_comments, submitted_sites.comments_posted, niches.name AS niche_name
             FROM submitted_sites
             JOIN niches ON submitted_sites.niche_id = niches.id
             WHERE submitted_sites.status = 'pending' 
             AND submitted_sites.backlinks_generated >= 5 
             AND submitted_sites.comments_posted < submitted_sites.max_comments
             ORDER BY submitted_sites.created_at ASC
             LIMIT 1`,
            (err, results) => {
                if (err) {
                    console.error("❌ Database error while fetching Reddit submission:", err);
                    reject(err);
                } else {
                    if (results.length > 0) {
                        console.log(`✅ Found submission for Reddit: ${results[0].site_url} (Niche: ${results[0].niche_name})`);
                        resolve(results[0]);
                    } else {
                        console.log("❌ No pending submissions available for Reddit.");
                        resolve(null);
                    }
                }
            }
        );
    });
};

module.exports = { fetchNextRedditSubmission };
