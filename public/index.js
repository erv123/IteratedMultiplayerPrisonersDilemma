
async function joinGame() {
  const gameId = document.getElementById("joinGameId").value.trim();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!gameId || !username || !password) {
    alert("All fields must be filled.");
    return;
  }

  const res = await fetch("/api/joinGame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, username, password })
  });

  const data = await res.json();

  if (data.success) {
    window.location.href = `/game.html?gameId=${gameId}&username=${username}`;
  } else {
    alert(data.message);
  }
}


async function fetchGameList() {
  const res = await fetch("/api/listGames");
  const data = await res.json();
  console.log(data);
  const listContainer = document.getElementById("gameList");
  listContainer.innerHTML = "";

  data.gameIds.forEach(id => {
    const div = document.createElement("div");
    div.textContent = id;
    listContainer.appendChild(div);
  });
}

async function joinGame() {
  console.log("Join button clicked");
  const gameId = document.getElementById("joinGameId").value.trim();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!gameId || !username || !password) {
    alert("All fields must be filled.");
    return;
  }

  const res = await fetch("/api/joinGame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, username, password })
  });
  console.log("Response status:", res.status);
  const data = await res.json();
  console.log("Response data:", data);

  if (data.success) {
    window.location.href = "/game";
  } else {
    alert(data.message);
  }
}

if (window.location.pathname.includes("game.html")) {
  setInterval(fetchState, 2000); // Poll every 2s
}