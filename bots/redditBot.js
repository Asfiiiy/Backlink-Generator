const snoowrap = require("snoowrap");
const db = require("../config/db");
const { fetchNextRedditSubmission } = require("./fetchNextRedditSubmission");
require("dotenv").config();

// **Reddit API Client**
const redditClient = new snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
});

// **Daily Comment Limit**
const DAILY_COMMENT_LIMIT = 100;
const DELAY_BETWEEN_COMMENTS = 5 * 60 * 1000; // 5 minutes in milliseconds

// **Retry Mechanism for API Calls**
const fetchWithRetry = async (apiCall, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            console.error(`Attempt ${i + 1} failed: ${error.message}. Retrying...`);
        }
    }
    throw new Error("Reddit API failed after multiple retries");
};

// **Fetch Subreddits Assigned to the User-Selected Niche**
const fetchSubredditsForNiche = async (niche) => {
    return new Promise((resolve, reject) => {
        db.query(
            `SELECT subreddit_name FROM niche_subreddits WHERE niche_name = ?`,
            [niche],
            (err, results) => {
                if (err) {
                    console.error(`❌ Database error fetching subreddits for niche '${niche}':`, err);
                    reject(err);
                } else {
                    resolve(results.map(row => row.subreddit_name));
                }
            }
        );
    });
};

// **Get Today's Comment Count**
const getTodaysCommentCount = async () => {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
        db.query(
            `SELECT SUM(comments_posted) AS total_comments FROM submitted_sites WHERE DATE(updated_at) = ?`,
            [today],
            (err, results) => {
                if (err) reject(err);
                else resolve(results[0].total_comments || 0);
            }
        );
    });
};

// **Find & Comment on Niche Posts**
const autoCommentOnNichePosts = async (submission) => {
    const { niche_name, post_content, max_comments, comments_posted } = submission;

    // **Fetch subreddits dynamically from the database**
    const subreddits = await fetchSubredditsForNiche(niche_name);

    if (subreddits.length === 0) {
        console.log(`❌ No subreddits found for niche: ${niche_name}`);
        return;
    }

    let commentCount = comments_posted || 0;

    for (let subreddit of subreddits) {
        if (commentCount >= max_comments) break;

        try {
            const posts = await redditClient.getSubreddit(subreddit).getHot({ limit: 10 });

            for (let post of posts) {
                if (commentCount >= max_comments) break;

                // **Check Daily Comment Limit**
                const todaysCommentCount = await getTodaysCommentCount();
                if (todaysCommentCount >= DAILY_COMMENT_LIMIT) {
                    console.log("🚫 Daily comment limit reached. Stopping comments for today.");
                    return;
                }

                // **Add Delay Between Comments**
                if (commentCount > 0) {
                    console.log(`⏳ Waiting ${DELAY_BETWEEN_COMMENTS / 1000} seconds before next comment...`);
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_COMMENTS));
                }

                // **Post Comment**
                await fetchWithRetry(() => post.reply(post_content)); // **Apply Retry**
                console.log(`✅ Commented on: r/${post.subreddit.display_name} - ${post.title}`);
                commentCount++;

                // **Update the comments count in the database**
                db.query(
                    "UPDATE submitted_sites SET comments_posted = comments_posted + 1, updated_at = NOW() WHERE id = ?",
                    [submission.id],
                    (err) => {
                        if (err) {
                            console.error(`❌ Database error updating comment count for site ${submission.site_url}:`, err);
                        }
                    }
                );
            }
        } catch (error) {
            console.error(`❌ Error commenting on r/${subreddit}:`, error.message);
        }
    }

    console.log(`🚀 Completed ${commentCount} comments for ${submission.site_url}`);

    // **Mark Submission as Completed if Comments Limit is Reached**
    if (commentCount >= max_comments) {
        db.query(
            "UPDATE submitted_sites SET status = 'completed' WHERE id = ?",
            [submission.id],
            (err) => {
                if (err) console.error("❌ Error updating submission status:", err);
                else console.log("✅ Submission marked as completed.");
            }
        );
    }
};

// **Main Function to Process Reddit Comments**
const processRedditComments = async () => {
    const submission = await fetchNextRedditSubmission();
    if (!submission) return console.log("❌ No pending submissions for Reddit comments.");

    console.log(`🚀 Processing Reddit Comments for: ${submission.site_url}`);

    await autoCommentOnNichePosts(submission);

    console.log("✅ Reddit Bot Process Completed. Moving to Next Submission...");
};

// **Run Bot**
processRedditComments();