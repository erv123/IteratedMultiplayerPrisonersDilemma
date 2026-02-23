Auth:
    -~~Password hashing~~
    -~~Admin account on server start~~
    -~~On icorrect password enter offer to reset password but only if the last password reset was more than 24h ago~~
    -~~Admin account can see all users and enable password reset on their accounts (in profile page)~~
    -~~Other logged in accounts can change their password without restrictions~~
    -~~On registering and password reset prompt to confirm password~~
Game ui
    -~~Add setting to limit how many max past turns to display where -1 is unlimited~~
    -Add score history tracking and plotting in game info
Polishing:
    -Complete code refactor up to industry best practices if possible
    -Dowload game button functionality
    -Ui update to lightweigt but modern


i have moved all existing files to src old foldes. do not edit those files going forwards in the refactor process. create a new db.js according to the schema.md in src/server folder