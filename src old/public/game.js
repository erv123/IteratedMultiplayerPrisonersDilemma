let currentTurn = null;
let myChoices = {};
let myPlayerId = null;

/* ============================= */
/* SESSION LOAD                  */
/* ============================= */

async function loadSession() {
  const res = await fetch("/api/session");
  const data = await res.json();

  if (!data.loggedIn) {
    window.location.href = "/";
    return;
  }

  document.getElementById("gameId").innerText = data.user.gameId;
  document.getElementById("username").innerText = data.user.username;
  document.getElementById("logoutBtn").onclick = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  };
  const backBtn = document.getElementById('backToInfoBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      const gid = data.user.gameId;
      window.location.href = `/gameInfo?gameId=${encodeURIComponent(gid)}`;
    };
  }
 

  myPlayerId = data.user.playerId;

  await loadGameState();
  await checkGameState();
}

loadSession();

/* ============================= */
/* POLLING                       */
/* ============================= */

setInterval(checkGameState, 1000);

async function checkGameState() {
  const res = await fetch("/api/gameState");
  const data = await res.json();


  if (!data.loggedIn) {
    window.location.href = "/";
    return;
  }

  myPlayerId = data.myPlayerId;
    console.log("My ID:", data.myPlayerId);
  console.log("All players:", data.players.map(p => p.id));
  // New Turn Detection
  if (currentTurn === null) {
    currentTurn = data.currentTurn;
  }

  if (data.currentTurn !== currentTurn) {
    currentTurn = data.currentTurn;
    myChoices = {}; // reset local choices for new turn
  }

  // Always refresh choices from DB
  await loadMyChoices();

  renderPlayers(data.players);
  renderLeaderboard(data.players);
  renderTurnHistory();

  // Lock or unlock UI
  if (data.myReadyState === 1) {
    disableTurnUI();
  } else {
    enableTurnUI();
  }
  //update turn state display
  const actionHeader = document.getElementById("actionHeader");
  document.getElementById("turnDisplay").textContent = data.currentTurn;
  const totalPlayers = data.players.length;
  const readyPlayers = data.players.filter(p => p.ready_for_next_turn === 1).length;

  if (data.myReadyState === 1) {
    actionHeader.textContent = `Waiting for other players ${readyPlayers}/${totalPlayers}`;
  } else {
    actionHeader.textContent = "Choose Your Actions";
  }
}

/* ============================= */
/* LOAD GAME STATE               */
/* ============================= */

async function loadGameState() {
  const res = await fetch("/api/gameState");
  const data = await res.json();

  renderPlayers(data.players);
  renderLeaderboard(data.players);

  currentTurn = data.currentTurn;
}
async function loadMyChoices() {
  const res = await fetch("/api/myChoices");
  const data = await res.json();
  if (!data.success) return;

  myChoices = data.myChoices || {};
}

/* ============================= */
/* GAME FUNCTIONS                */
/* ============================= */

async function endTurn() {

  // Get current visible opponent rows
  const opponentRows = document.querySelectorAll(".player-row");

  // Extract opponent IDs from DOM
  const opponentIds = Array.from(opponentRows).map(
    row => row.dataset.playerId
  );

  // Clean stale choices (optional but recommended)
  Object.keys(myChoices).forEach(id => {
    if (!opponentIds.includes(id)) {
      delete myChoices[id];
    }
  });

  // Validate: every opponent must have a choice
  const missingChoice = opponentIds.find(id => !myChoices[id]);

  if (missingChoice) {
    alert("You must choose Peace or War for every player.");
    return;
  }

  // Submit choices
  await fetch("/api/submitChoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      choices: myChoices
    })
  });

  // Mark ready
  await fetch("/api/markReady", {
    method: "POST"
  });

  disableTurnUI();
}
async function selectChoice(targetId, choice) {
  myChoices[targetId] = choice;

  const row = document.querySelector(
    `.player-row[data-player-id="${targetId}"]`
  );

  if (!row) return;

  const peaceBtn = row.querySelector(".peace-btn");
  const warBtn = row.querySelector(".war-btn");

  // Remove previous selection
  peaceBtn.classList.remove("selected-peace");
  warBtn.classList.remove("selected-war");

  // Add new selection
  if (choice === "peace") {
    peaceBtn.classList.add("selected-peace");
  } else {
    warBtn.classList.add("selected-war");
  }

  // Persist immediately
  await fetch("/api/saveChoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, choice })
  });
}


/* ============================= */
/* UI CONTROL                    */
/* ============================= */

function disableTurnUI() {
  document.querySelectorAll(".choice-btn").forEach(btn => {
    btn.disabled = true;
  });

  const endBtn = document.getElementById("endTurnBtn");
  if (endBtn) endBtn.disabled = true;
}
function enableTurnUI() {
  document.querySelectorAll(".choice-btn").forEach(btn => {
    btn.disabled = false;
  });

  const endBtn = document.getElementById("endTurnBtn");
  if (endBtn) endBtn.disabled = false;
}
function renderLeaderboard(players) {
  const container = document.getElementById("leaderboard");
  container.innerHTML = "";

  players
    .sort((a, b) => b.total_score - a.total_score)
    .forEach(player => {
      const div = document.createElement("div");
      div.innerText = `${player.username}: ${player.total_score}`;
      container.appendChild(div);
    });
}
async function renderTurnHistory() {

  const res = await fetch("/api/turnHistory");
  const data = await res.json();

  if (!data.success) return;

  const container = document.getElementById("historyContainer");
  container.innerHTML = "";

  const history = data.history;

  if (history.length === 0) return;

  // Determine unique opponents
  const opponents = [...new Set(history.map(h => h.target_name))];

  const turns = [...new Set(history.map(h => h.turn_number))];

  const table = document.createElement("table");
  table.className = "history-table";

  // Header row
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th>Opponent</th>" +
    turns.map(t => `<th>Turn ${t}</th>`).join("");

  table.appendChild(headerRow);

  opponents.forEach(opponent => {

    const row = document.createElement("tr");
    row.innerHTML = `<td>${opponent}</td>`;

    turns.forEach(turn => {

      const entry = history.find(
        h => h.turn_number === turn && h.target_name === opponent
      );

      const cell = document.createElement("td");

      if (entry) {
        cell.textContent = `${entry.choice}/${entry.opponent_choice}`;

        // Color formatting based on performance
        if (entry.points_awarded >= 5) {
          cell.className = "good-turn";
        } else if (entry.points_awarded >= 3) {
          cell.className = "neutral-turn";
        } else {
          cell.className = "bad-turn";
        }
      }

      row.appendChild(cell);
    });

    table.appendChild(row);
  });

  container.appendChild(table);
}
function renderPlayers(players) {
  const container = document.getElementById("playerList");
  container.innerHTML = "";

  if (!myPlayerId) return; // safety guard

  players.forEach(player => {

    // HARD guard against self
    if (player.id === myPlayerId) return;

    const row = document.createElement("div");
    row.className = "player-row";
    row.dataset.playerId = player.id;

    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name";
    nameSpan.textContent = player.username;

    const peaceBtn = document.createElement("button");
    peaceBtn.textContent = "Peace";
    peaceBtn.className = "choice-btn peace-btn";

    const warBtn = document.createElement("button");
    warBtn.textContent = "War";
    warBtn.className = "choice-btn war-btn";

    const savedChoice = myChoices[player.id];

    if (savedChoice === "peace") {
      peaceBtn.classList.add("selected-peace");
    }

    if (savedChoice === "war") {
      warBtn.classList.add("selected-war");
    }

    peaceBtn.onclick = () => selectChoice(player.id, "peace");
    warBtn.onclick = () => selectChoice(player.id, "war");

    row.appendChild(nameSpan);
    row.appendChild(peaceBtn);
    row.appendChild(warBtn);

    container.appendChild(row);
  });
}
