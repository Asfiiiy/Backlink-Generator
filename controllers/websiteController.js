const db = require('../config/db');

// Fetch all available niches
const getNiches = (req, res) => {
    db.query('SELECT * FROM niches', (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Database error', error: err });
        }
        res.status(200).json(results);
    });
};

// Submit a website with niche selection
const submitWebsite = async (req, res) => {
    const { site_url, niche_id } = req.body;
    const user_id = req.user.id; // From JWT token

    try {
        // Validate user exists
        const [users] = await db.query("SELECT id FROM users WHERE id = ?", [user_id]);
        if (users.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        // Validate niche exists
        const [niches] = await db.query("SELECT id FROM niches WHERE id = ?", [niche_id]);
        if (niches.length === 0) {
            return res.status(400).json({ message: "Invalid niche selection" });
        }

        // Insert into submitted_sites
        const [result] = await db.query(
            "INSERT INTO submitted_sites (user_id, site_url, niche_id) VALUES (?, ?, ?)",
            [user_id, site_url, niche_id]
        );

        res.status(201).json({
            message: "Website submitted successfully",
            site_id: result.insertId
        });

    } catch (err) {
        console.error("❌ Submit Website Error:", err);
        
        // Handle foreign key constraint errors explicitly
        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(400).json({ message: "Invalid user or niche" });
        }
        
        res.status(500).json({ message: "Database error", error: err.message });
    }
};

// Get submitted websites for a user
const getUserWebsites = (req, res) => {
    const user_id = req.user.id;

    db.query(
        `SELECT submitted_sites.*, niches.name AS niche_name
        FROM submitted_sites 
        JOIN niches ON submitted_sites.niche_id = niches.id
        WHERE submitted_sites.user_id = ?`,
        [user_id],
        (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err });
            }
            res.status(200).json(results);
        }
    );
};

module.exports = { getNiches, submitWebsite, getUserWebsites };
