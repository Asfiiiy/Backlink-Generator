const db = require('../config/db');
require('dotenv').config();
const axios = require('axios');
const { generateBacklink } = require('../bots/backlinkBot'); // ✅ Import the correct function

const OPEN_PAGERANK_API_KEY = process.env.OPEN_PAGERANK_API_KEY;

// **Retry Mechanism for API Calls**
const fetchWithRetry = async (apiCall, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            console.error(`Attempt ${i + 1} failed: ${error.message}. Retrying...`);
        }
    }
    throw new Error("API failed after multiple retries");
};

// **Function to check Domain Authority (DA) using Open PageRank API**
const checkDomainAuthority = async (domain) => {
    return fetchWithRetry(async () => {
        const response = await axios.get(`https://openpagerank.com/api/v1.0/getPageRank`, {
            headers: { "API-OPR": OPEN_PAGERANK_API_KEY },
            params: { "domains[]": domain }
        });

        if (response.data.status_code === 200) {
            return response.data.response[0].rank; // DA score
        }
        return null;
    });
};

// **Generate Backlink (Redirect to Backlink Bot)**
const createBacklink = async (req, res) => {
    await generateBacklink(req, res);
};

// **Get all backlinks for a user**
const getBacklinks = (req, res) => {
    const user_id = req.user.id;

    db.query(
        `SELECT backlinks.*, submitted_sites.site_url, niches.name AS niche_name, 
                backlinks.source_site, backlinks.method, backlinks.anchor_text
         FROM backlinks 
         INNER JOIN submitted_sites ON backlinks.site_id = submitted_sites.id
         INNER JOIN niches ON submitted_sites.niche_id = niches.id
         WHERE submitted_sites.user_id = ?`,
        [user_id],
        (err, results) => {
            if (err) {
                console.error("❌ Database error fetching backlinks:", err);
                return res.status(500).json({ message: "Database error", error: err });
            }

            res.status(200).json(results);
        }
    );
};

// **Fetch Backlinks Indexing Status**
const getBacklinkIndexStatus = (req, res) => {
    db.query(
        `SELECT backlinks.*, submitted_sites.site_url, niches.name AS niche_name 
         FROM backlinks 
         INNER JOIN submitted_sites ON backlinks.site_id = submitted_sites.id
         INNER JOIN niches ON submitted_sites.niche_id = niches.id
         ORDER BY backlinks.created_at DESC`,
        (err, results) => {
            if (err) {
                console.error("❌ Database error fetching backlink index status:", err);
                return res.status(500).json({ message: "Database error", error: err });
            }

            res.status(200).json(results);
        }
    );
};

// **Export Functions**
module.exports = { createBacklink, getBacklinks, getBacklinkIndexStatus };
