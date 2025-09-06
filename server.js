const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes"); // Ensure correct path

const db = require("./config/db"); // Ensure database connection

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json()); // ✅ Ensure this line exists to parse JSON requests

// **Define API routes**
app.use("/api", userRoutes);


// **Start the server**
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});