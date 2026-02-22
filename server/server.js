const express = require("express");
const path = require("path");
const session = require("express-session");
const { v4: uuidv4 } = require("uuid");

const gameRoutes = require("../routes/gameRoutes");

const app = express();
app.use(express.json());



/* ===============================
   SESSION SETUP
   =============================== */

  app.use(
    session({
      secret: "09c732c9-2dc9-4ba7-a58e-cff338a68f06",
      resave: false,
      saveUninitialized: false,
      // only set secure cookies in production (requires HTTPS). For local dev over HTTP keep false.
      cookie: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
    })
  );

/* ===============================
   ROUTES
   =============================== */
app.use(express.static("public"));
app.use("/api", gameRoutes);

app.get("/game", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, "..", "public", "game.html"));
});

// Serve game info page without requiring a session so users can view and log in from there
app.get("/gameInfo", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "gameInfo.html"));
});
/* ===============================
   SERVER START
   =============================== */
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});