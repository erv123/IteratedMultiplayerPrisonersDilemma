// Generate temporary ID (not saved yet)
const gameId = Math.random().toString(36).substring(2, 8);
document.getElementById("gameIdDisplay").innerText = gameId;

async function registerGame() {
  const payoffMatrix = {
    peace_peace: Number(document.getElementById("pp").value),
    peace_war: Number(document.getElementById("pw").value),
    war_peace: Number(document.getElementById("wp").value),
    war_war: Number(document.getElementById("ww").value),
  };

  const errorChance = Number(document.getElementById("errorChance").value);
  const maxTurns = Number(document.getElementById("maxTurns").value);
  const maxPlayers = Number(document.getElementById("maxPlayers").value);
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  // Validate host credentials
  if (!username || !password) {
    alert("Host username and password are required to create a game.");
    return;
  }

  // Validation
  if (errorChance < 0 || errorChance > 100) {
    alert("Error chance must be between 0 and 100.");
    return;
  }

  if (maxTurns < 1) {
    alert("Max turns must be at least 1.");
    return;
  }

  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gameId,
      payoffMatrix,
      errorChance,
      maxTurns,
      maxPlayers,
      username,
      password
    }),
  });

  const data = await res.json();

  if (data.success) {
    alert("Game registered!");
    window.location.href = `/gameInfo?gameId=${encodeURIComponent(gameId)}`;
  } else {
    alert("Error creating game");
  }
}