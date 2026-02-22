const express = require("express");
const path = require("path");
const session = require("express-session");
const { v4: uuidv4 } = require("uuid");

const gameRoutes = require("./routes/gameRoutes");

const { TESTING } = require("./config");

const app = express();
app.use(express.json());



/* ===============================
   SESSION SETUP
   =============================== */
if (TESTING) {
  // Testing mode: session ID can be forced via ?sid
  app.use(
    session({
      secret: "07910b9a-2a1e-4a8e-84b0-f3843c8e86df",
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false }, // not HTTPS for testing
      genid: function (req) {
        return req.query.sid || uuidv4();
      },
    })
  );
} else {
  // Safe mode: standard sessions
  app.use(
    session({
      secret: "09c732c9-2dc9-4ba7-a58e-cff338a68f06",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: true },
    })
  );
}

/* ===============================
   ROUTES
   =============================== */
app.use(express.static("public"));
app.use("/api", gameRoutes);

app.get("/game", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, "public/game.html"));
});

/* ===============================
   SERVER START
   =============================== */
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});