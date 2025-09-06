const snoowrap = require("snoowrap");
require("dotenv").config();

// **Reddit API Client**
const redditClient = new snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
});

// **Function to Post Without a URL (Disguised as Plain Text)**
const postRedditWithoutUrl = async (subreddit, title, description) => {
    try {
        const text = `🔥 I found this useful SEO resource:\n\n📝 ${description}`;

        const post = await redditClient.getSubreddit(subreddit).submitSelfpost({
            title: title,
            text: text, // Plain text, no URL detection
        });

        console.log(`✅ Post Created Successfully in r/${subreddit}! Post ID: ${post.id}`);
    } catch (error) {
        console.error("❌ Error posting:", error.message);
    }
};

// **Run the Function with Example Data**
postRedditWithoutUrl(
    "SEO", // Subreddit Name
    "Boost Your SEO with this Guide!", // Post Title
    "This guide helped me a lot! Visit expo(dot)com for insights on optimizing search rankings." // Description without a direct link
);
