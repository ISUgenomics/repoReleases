# repoReleases
Grab all Bioinformatic software release notes.

You will need to generate an access token in Github. 

Full instructions on how to do this are located here: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token

Briefly,

0) Go to github.com/yourusername
1) Click on your Avatar and open github settings.
2) in the lower left bottom there is a link to Developer settings, click on this. 
3) Click on Personal Access Tokens
4) Click on Tokens classic and generate a token.
	a) Note you have to save the token somewhere safe like your password manager.  it acts like a password.
	b) If you need it again and haven't saved it, you will need to generate a new one.
5) Choose no expiration 
6) Scope should have repo (top one) selected.
7) generate token.
8) Save this token in Dashlane or your favorite password manager for easy reuse.

### Load the chrome extension
1) Git clone the repo.
2) Go to chrome://extensions
3) Toggle developer mode (upper right)
4) load unpacked (upper left), choose the kanban github repo you just downloaded.
5) Now that it is loaded you can select it in the chrome extensions toolbar in the upper right (kind of looks like a puzzle piece.

once you have entered your token and click `Save Token`, you should just be able to click on  `Fetch All Releases` the next time you open the window as your token is now saved locally.

**Note:** if you add an additional Category, you will need to reopen the extension(close any existing windows and click on the extension again) to see the new category in the dropdown.  This is because the categories are loaded when the extension is opened (popup.js). 

