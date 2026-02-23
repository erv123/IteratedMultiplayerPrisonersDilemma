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



add a setting to games that would be set during game creation and have a default value of 5. it should limit how many previous turns are displayed in the turn history table. set up an endpoint that retreives that many turns. -1 should mean an unlimited amount. make sure the endpoint does not return turns that are not finished. do not modify the table display yet. leave it broken if it breaks

add score history tracking to turn resolver and add a graph to the game info sreen to display the score history for all participants for the whole game so far

i want to completely refactor the entire codebase. do not make any actual code changes. for this process assume i have stong fundamental programming knowledge geared towards embedded programming but i lack specific web dev knowledge and make this a learning process. at the end i want to have a deep understanding of how the whole project works.
the overall process outline should include in this order:
1. Folder structure, project outline and file naming and other code strucure and formatting decisions
2. Database structure
3. Api structure
4. Server startup, game logic, ui logic and polling
5. ui functionality fixes to fit new backend with the expectation that a separate ui overhaul will happen
throughout the process indicate where decisions should be made and suggest an appropriate option for each of them
keep the process descripion as a clean but detailed outline and limit the explanations to the minimum and write it in a refactor checklist file to be used as a checklist by me
at the end the code should have consistent comments, allow future expansions withut major distruptions to core functionality and be ready to be tested in preperation for release and indclude testing functionality where possible. 