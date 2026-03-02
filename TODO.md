Auth:
    -~~Password hashing~~
    -~~Admin account on server start~~
    -~~On icorrect password enter offer to reset password but only if the last password reset was more than 24h ago~~
    -~~Admin account can see all users and enable password reset on their accounts (in profile page)~~
    -~~Other logged in accounts can change their password without restrictions~~
    -~~On registering and password reset prompt to confirm password~~
Game ui
    -~~Add setting to limit how many max past turns to display where -1 is unlimited~~
    -~~Add score history tracking and plotting in game info~~
Polishing:
    -~~Complete code refactor up to industry best practices if possible~~
    -~~Dowload game button functionality~~
    -~~Ui update to lightweigt but modern~~
    -~~Rules screen~~
    -~~game stettings can be updated by host in game info screen~~
    -~~profile page~~
    -~~extract a generic table renderer to be used across the page to align table structure and have a cell styles for each kind of cell to allow replicating functionality~~
    -~~update all tables to use the table renderer~~
    -redo all alerts
    -~~index page info block~
    -add dark mode toggle

Export and hosting
    -create a github action to release a new version




v2 feature update:

challenge mode
teams mode

challenge mode:

game goal:
    get max score per across all games

challenging 
participants can challenge players who have not joined a game. when initiating the challenge the player picks the game size (even)

the player who receives a challenge can decline it for a score penalty (maybe scaled to the players per turn) if the game is accepted they can then ask another to join. the newly challenged player can also decline for some penalty.

the game starts when max players reached or one player unsuccesfully tries to invite three players.

the game is started by using some global game settings. the payoff matrix should include negative numbers

the players play it out and at the end each players score is the average score per turn in that game

after each game the players see current leaderboard and who is playing agains whom currently and total game count for the challenge and get an option to stop playing in the challenge. they will then not be able to participate in any game but may receive some set amount of points for each next game that is created after they exit

each new challenge has a chance to be the last challenge. this chance maybe needs some function applied based on game turn count

teams mode: 
challenge mode but players are randomly assigned (or choose) their team. each game score is then scaled according to how many players from your team are in the game (less team mates = more points)

teams are ranked based on their player total scored scaled according to the player count in that team